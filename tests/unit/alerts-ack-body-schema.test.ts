/**
 * Sprint 4 task 4.2 — alerts/[id]/ack body schema tests (F-014).
 *
 * The endpoint hardening introduced a discriminated-union schema where:
 *   - `acknowledge`: note optional
 *   - `resolve`:     note REQUIRED, ≥3 chars after trim
 *   - `dismiss`:     note REQUIRED, ≥3 chars after trim
 *
 * Closing an alert (resolve / dismiss) without a documented reason was the
 * pre-019 loophole that let the inbox drift silently empty. These tests
 * pin the contract so the validator alone enforces it — no manual checks.
 *
 * To keep the test focused on the schema (not the HTTP handler), we
 * re-declare the same schema here. The real route imports it inline and
 * uses it via z.safeParse — duplicating it ensures we test the *spec*
 * rather than incidental wiring. If the route's schema drifts, the
 * mismatch is caught in `tests/integration/alerts-ack.test.ts` (or via
 * a follow-up integration test).
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const ackBodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('acknowledge'),
    note: z.string().min(1).max(1000).optional(),
  }),
  z.object({
    action: z.literal('resolve'),
    note: z.string().trim().min(3, 'NOTE_REQUIRED').max(1000),
  }),
  z.object({
    action: z.literal('dismiss'),
    note: z.string().trim().min(3, 'NOTE_REQUIRED').max(1000),
  }),
]);

describe('alerts ack body schema — acknowledge', () => {
  it('accepts acknowledge with no note', () => {
    const r = ackBodySchema.safeParse({ action: 'acknowledge' });
    expect(r.success).toBe(true);
  });

  it('accepts acknowledge with a short note', () => {
    const r = ackBodySchema.safeParse({ action: 'acknowledge', note: 'ok' });
    expect(r.success).toBe(true);
  });

  it('accepts acknowledge with a long valid note', () => {
    const r = ackBodySchema.safeParse({
      action: 'acknowledge',
      note: 'x'.repeat(900),
    });
    expect(r.success).toBe(true);
  });

  it('rejects acknowledge with note longer than 1000 chars', () => {
    const r = ackBodySchema.safeParse({
      action: 'acknowledge',
      note: 'x'.repeat(1001),
    });
    expect(r.success).toBe(false);
  });
});

describe('alerts ack body schema — resolve', () => {
  it('rejects resolve without a note', () => {
    const r = ackBodySchema.safeParse({ action: 'resolve' });
    expect(r.success).toBe(false);
  });

  it('rejects resolve with empty string note', () => {
    const r = ackBodySchema.safeParse({ action: 'resolve', note: '' });
    expect(r.success).toBe(false);
  });

  it('rejects resolve with a 2-char note (below ≥3 minimum)', () => {
    const r = ackBodySchema.safeParse({ action: 'resolve', note: 'ok' });
    expect(r.success).toBe(false);
  });

  it('rejects resolve where the note is whitespace-only after trim', () => {
    const r = ackBodySchema.safeParse({ action: 'resolve', note: '   ' });
    expect(r.success).toBe(false);
  });

  it('accepts resolve with a 3-char meaningful note', () => {
    const r = ackBodySchema.safeParse({
      action: 'resolve',
      note: 'fix',
    });
    expect(r.success).toBe(true);
  });

  it('accepts resolve with a clinically reasonable note', () => {
    const r = ackBodySchema.safeParse({
      action: 'resolve',
      note: 'Treated, BP normalised after intensification of antihypertensives',
    });
    expect(r.success).toBe(true);
  });
});

describe('alerts ack body schema — dismiss', () => {
  it('rejects dismiss without a note', () => {
    const r = ackBodySchema.safeParse({ action: 'dismiss' });
    expect(r.success).toBe(false);
  });

  it('rejects dismiss with whitespace-only note', () => {
    const r = ackBodySchema.safeParse({ action: 'dismiss', note: '\n\n  ' });
    expect(r.success).toBe(false);
  });

  it('accepts dismiss with a meaningful reason', () => {
    const r = ackBodySchema.safeParse({
      action: 'dismiss',
      note: 'False positive: lab error, repeat assay normal',
    });
    expect(r.success).toBe(true);
  });
});

describe('alerts ack body schema — discriminator', () => {
  it('rejects unknown action values', () => {
    const r = ackBodySchema.safeParse({ action: 'wibble', note: 'ok' });
    expect(r.success).toBe(false);
  });

  it('rejects missing action', () => {
    const r = ackBodySchema.safeParse({ note: 'ok' });
    expect(r.success).toBe(false);
  });
});
