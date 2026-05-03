/**
 * GET /api/v1/patients/[id]/trends
 *
 * Longitudinal, per-domain time series for a patient. Powers the
 * "Progress" card on the patient detail page (ISSUE 4).
 *
 * Design
 * ------
 * Each point is a `{ assessmentId, date, value, category? }` tuple.
 * Series are grouped by clinical domain so the UI can render a small
 * sparkline per domain without guessing the shape of the data:
 *
 *   - cardiovascular : SCORE2 / SCORE2-Diabetes (10-yr CV risk %)
 *   - metabolic      : HbA1c, fasting glucose, MetS 0–5 criteria count
 *   - renal          : eGFR (mL/min/1.73m²), ACR (mg/g)
 *   - hepatic        : FIB-4, FLI
 *   - lifestyle      : PREDIMED 0–14, MET-min/week
 *   - composite      : aggregated composite numeric score
 *
 * Data is sourced from the already-persisted projections:
 *   assessments (timeline anchor) → risk_profiles, score_results,
 *   assessment_measurements, activity_snapshots, nutrition_snapshots.
 *
 * Tenant isolation is enforced at the application layer in addition to
 * RLS, and the endpoint is read-only.
 *
 * Response
 * --------
 *   200 OK
 *   {
 *     patientId: string,
 *     nowIso: string,
 *     timeline: Array<{ assessmentId, date, status }>,
 *     series: {
 *       cardiovascular: { score2: Point[], score2Diabetes: Point[] },
 *       metabolic:      { hba1c: Point[], glucose: Point[], metabolicSyndrome: Point[] },
 *       renal:          { egfr: Point[], acr: Point[] },
 *       hepatic:        { fib4: Point[], fli: Point[] },
 *       lifestyle:      { predimed: Point[], metMinutesPerWeek: Point[] },
 *       composite:      { composite: Point[] }
 *     }
 *   }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { withAuth } from '../../../../backend/src/middleware/auth-middleware.js';
import { requireTenantMember } from '../../../../backend/src/middleware/rbac.js';
import { applySecurityHeaders } from '../../../../backend/src/middleware/security-headers.js';
import {
  checkRateLimitAsync,
  RATE_LIMITS,
  applyRateLimitHeaders,
} from '../../../../backend/src/middleware/rate-limit.js';
import { supabaseAdmin } from '../../../../backend/src/config/supabase.js';
import { recordAudit, emitAccessDenialLog } from '../../../../backend/src/audit/audit-logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Point {
  assessmentId: string;
  date: string; // ISO date (YYYY-MM-DD)
  value: number;
  /** Optional qualitative band carried through from the score engine. */
  category?: string | null;
  /** Optional unit for UI axis labels. */
  unit?: string;
}

interface TrendsResponse {
  patientId: string;
  nowIso: string;
  timeline: Array<{ assessmentId: string; date: string; status: string | null }>;
  series: {
    cardiovascular: { score2: Point[]; score2Diabetes: Point[] };
    metabolic: { hba1c: Point[]; glucose: Point[]; metabolicSyndrome: Point[] };
    renal: { egfr: Point[]; acr: Point[] };
    hepatic: { fib4: Point[]; fli: Point[] };
    lifestyle: { predimed: Point[]; metMinutesPerWeek: Point[] };
    composite: { composite: Point[] };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPatientId(req: VercelRequest): string | null {
  const id = req.query.id;
  if (typeof id !== 'string') return null;
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) return null;
  return id;
}

function toDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

function pickNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default withAuth(async (req, res: VercelResponse) => {
  applySecurityHeaders(res);

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET is supported.' },
    });
    return;
  }

  const patientId = getPatientId(req);
  if (!patientId) {
    res.status(400).json({
      error: { code: 'INVALID_ID', message: 'Invalid patient id.' },
    });
    return;
  }

  const rl = await checkRateLimitAsync(req, {
    routeId: 'patients.trends',
    ...RATE_LIMITS.read,
  });
  applyRateLimitHeaders(res, rl);
  if (!rl.allowed) {
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests.' },
    });
    return;
  }

  await requireTenantMember(async (r: any, s: VercelResponse) => {
    // ---- 1. Verify tenant ownership of patient (defence-in-depth) ----
    const { data: patient, error: pErr } = await supabaseAdmin
      .from('patients')
      .select('id, tenant_id')
      .eq('id', patientId)
      .maybeSingle();
    if (pErr) {
      s.status(500).json({ error: { code: 'DB_ERROR', message: pErr.message } });
      return;
    }
    if (!patient) {
      s.status(404).json({ error: { code: 'PATIENT_NOT_FOUND', message: '' } });
      return;
    }
    if (r.auth.role !== 'platform_admin' && patient.tenant_id !== r.auth.tenantId) {
      emitAccessDenialLog({
        reason: 'cross_tenant',
        actorUserId: r.auth.userId,
        actorRole: r.auth.role,
        actorTenantId: r.auth.tenantId,
        ipHash: r.auth.ipHash ?? null,
        route: 'GET /api/v1/patients/[id]/trends',
        targetResourceId: patientId,
        targetTenantId: patient.tenant_id as string,
      });
      s.status(403).json({
        error: { code: 'CROSS_TENANT_FORBIDDEN', message: '' },
      });
      return;
    }

    // ---- 2. Load assessments timeline (completed only, ascending for charts) ----
    const { data: assessments, error: aErr } = await supabaseAdmin
      .from('assessments')
      .select('id, created_at, assessment_date, status')
      .eq('patient_id', patientId)
      .eq('status', 'completed')
      .order('created_at', { ascending: true })
      .limit(60);
    if (aErr) {
      s.status(500).json({ error: { code: 'DB_ERROR', message: aErr.message } });
      return;
    }
    const rows = assessments ?? [];
    const ids = rows.map((a: any) => a.id);

    // Map assessmentId → ISO date for quick lookup during point assembly.
    const dateById = new Map<string, string>();
    for (const a of rows) {
      dateById.set(
        a.id as string,
        toDate((a.assessment_date as string) ?? (a.created_at as string)),
      );
    }

    // ---- 3. Fan-out loads in parallel (each is scoped to `ids`) ----
    const empty = { data: [] as any[], error: null as unknown };
    const [
      { data: scores, error: sErr },
      { data: measurements, error: mErr },
      { data: activities, error: actErr },
      { data: nutrition, error: nErr },
      { data: risks, error: rErr },
    ] = ids.length === 0
      ? [empty, empty, empty, empty, empty]
      : await Promise.all([
          supabaseAdmin
            .from('score_results')
            .select('assessment_id, score_code, value_numeric, category')
            .in('assessment_id', ids),
          supabaseAdmin
            .from('assessment_measurements')
            .select('assessment_id, hba1c_pct, glucose_mgdl, egfr, albumin_creatinine_ratio')
            .in('assessment_id', ids),
          supabaseAdmin
            .from('activity_snapshots')
            .select('assessment_id, met_minutes_per_week, minutes_per_week, moderate_minutes_per_week, vigorous_minutes_per_week, sedentary_hours_per_day')
            .in('assessment_id', ids),
          supabaseAdmin
            .from('nutrition_snapshots')
            .select('assessment_id, predimed_score, adherence_band')
            .in('assessment_id', ids),
          supabaseAdmin
            .from('risk_profiles')
            .select('assessment_id, composite_score, composite_risk_level')
            .in('assessment_id', ids),
        ]);

    // Any DB error here is surfaced — the trends endpoint must fail loudly
    // rather than return a truncated series that a clinician could mistake
    // for a flat line.
    const firstErr = [sErr, mErr, actErr, nErr, rErr].find(Boolean) as { message?: string } | undefined;
    if (firstErr) {
      s.status(500).json({
        error: { code: 'DB_ERROR', message: firstErr.message ?? 'Failed to load trends' },
      });
      return;
    }

    // ---- 4. Bucket by score_code / table ----
    const byScore = new Map<string, Map<string, { value: number; category?: string | null }>>();
    for (const row of scores ?? []) {
      const code = String(row.score_code ?? '').toLowerCase();
      if (!byScore.has(code)) byScore.set(code, new Map());
      const v = pickNum(row.value_numeric);
      if (v === null) continue;
      byScore.get(code)!.set(String(row.assessment_id), {
        value: v,
        category: row.category ?? null,
      });
    }

    const mByAssessment = new Map<string, any>();
    for (const row of measurements ?? []) {
      mByAssessment.set(String(row.assessment_id), row);
    }
    const actByAssessment = new Map<string, any>();
    for (const row of activities ?? []) {
      actByAssessment.set(String(row.assessment_id), row);
    }
    const nByAssessment = new Map<string, any>();
    for (const row of nutrition ?? []) {
      nByAssessment.set(String(row.assessment_id), row);
    }
    const rByAssessment = new Map<string, any>();
    for (const row of risks ?? []) {
      rByAssessment.set(String(row.assessment_id), row);
    }

    // ---- 5. Build per-domain series in timeline order ----
    const mkSeriesFromScore = (code: string, unit?: string): Point[] => {
      const bag = byScore.get(code);
      if (!bag) return [];
      const out: Point[] = [];
      for (const id of ids) {
        const hit = bag.get(id);
        if (!hit) continue;
        out.push({
          assessmentId: id,
          date: dateById.get(id) ?? '',
          value: hit.value,
          category: hit.category ?? null,
          unit,
        });
      }
      return out;
    };

    const mkSeriesFromTable = <T>(
      source: Map<string, any>,
      accessor: (row: any) => number | null,
      unit?: string,
    ): Point[] => {
      const out: Point[] = [];
      for (const id of ids) {
        const row = source.get(id);
        if (!row) continue;
        const v = accessor(row);
        if (v === null) continue;
        out.push({
          assessmentId: id,
          date: dateById.get(id) ?? '',
          value: v,
          unit,
        });
      }
      return out;
    };

    const series: TrendsResponse['series'] = {
      cardiovascular: {
        score2: mkSeriesFromScore('score2', '% 10-yr'),
        score2Diabetes: mkSeriesFromScore('score2_diabetes', '% 10-yr'),
      },
      metabolic: {
        hba1c: mkSeriesFromTable(mByAssessment, (r) => pickNum(r.hba1c_pct), '%'),
        glucose: mkSeriesFromTable(mByAssessment, (r) => pickNum(r.glucose_mgdl), 'mg/dL'),
        // MetS score is emitted as value_numeric by the score engine (0–5 criteria).
        metabolicSyndrome: mkSeriesFromScore('metabolic_syndrome', 'criteria'),
      },
      renal: {
        egfr: mkSeriesFromTable(
          mByAssessment,
          (r) => pickNum(r.egfr),
          'mL/min/1.73m²',
        ),
        acr: mkSeriesFromTable(
          mByAssessment,
          (r) => pickNum(r.albumin_creatinine_ratio),
          'mg/g',
        ),
      },
      hepatic: {
        fib4: mkSeriesFromScore('fib4'),
        fli: mkSeriesFromScore('fli'),
      },
      lifestyle: {
        predimed: mkSeriesFromTable(
          nByAssessment,
          (r) => pickNum(r.predimed_score),
          '/14',
        ),
        metMinutesPerWeek: mkSeriesFromTable(
          actByAssessment,
          (r) => pickNum(r.met_minutes_per_week),
          'MET-min/wk',
        ),
      },
      composite: {
        composite: mkSeriesFromTable(
          rByAssessment,
          (r) => pickNum(r.composite_score),
        ),
      },
    };

    // ---- 6. Record audit + respond ----
    await recordAudit(r.auth, {
      action: 'assessment.read',
      resourceType: 'patient',
      resourceId: patientId,
      metadata: { kind: 'trends', assessment_count: rows.length },
    });

    const payload: TrendsResponse = {
      patientId,
      nowIso: new Date().toISOString(),
      timeline: rows.map((a: any) => ({
        assessmentId: a.id,
        date: toDate((a.assessment_date as string) ?? (a.created_at as string)),
        status: (a.status as string) ?? null,
      })),
      series,
    };
    s.status(200).json(payload);
  })(req as any, res);
});
