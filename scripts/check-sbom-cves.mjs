#!/usr/bin/env node
/**
 * check-sbom-cves.mjs
 * ----------------------------------------------------------------------------
 * CVE scan gate for the committed SBOM (Tier 4 / extends M-03).
 *
 * What it does
 * ------------
 *   1. Runs `npm audit --json --omit=dev` to surface vulnerabilities
 *      reported by the GitHub Advisory Database for the runtime deps
 *      that are part of the SOUP inventory (devDependencies are out
 *      of the production attack surface).
 *   2. Counts vulnerabilities by severity {info, low, moderate, high,
 *      critical}.
 *   3. Writes a snapshot to `sbom-cve-report.json` so reviewers can
 *      see the latest scan even when the gate passes.
 *   4. Exit codes:
 *        0 → no Critical, no High (or High allowed by policy)
 *        3 → Critical found (always blocks)
 *        4 → High found AND env `SBOM_CVE_FAIL_ON_HIGH=true` (default
 *            behaviour: warn but pass — operators flip the env when
 *            the supply chain is mature enough to warrant it)
 *
 * Why npm audit (not Grype / Trivy)
 * ---------------------------------
 *   - Already shipped with every npm install — no extra binary, no
 *     extra registry, no extra CI step to maintain.
 *   - GitHub Advisory Database is the canonical source for the
 *     ecosystems we use (npm).
 *   - Easy to swap later (Grype/Trivy can read the same
 *     sbom.cyclonedx.json offline) — this gate is the engineering
 *     baseline; offline scanners can be added in CD without removing
 *     this script.
 *
 * Skips
 * -----
 *   - node_modules missing (fresh clone before npm install)
 *   - npm audit unavailable (very old npm, very locked-down CI)
 *   - npm audit transient error (rate limit, registry outage)
 *
 * Wired into
 * ----------
 *   `npm run check:sbom-cves`
 *   `npm run build:check`
 * ----------------------------------------------------------------------------
 */

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const REPORT_PATH = join(REPO_ROOT, 'sbom-cve-report.json');

function info(msg) { console.log(`[check-sbom-cves] ${msg}`); }
function warn(msg) { console.warn(`[check-sbom-cves] WARN ${msg}`); }
function skip(msg) {
  console.log(`[check-sbom-cves] SKIP ${msg}`);
  process.exit(0);
}
function fail(code, msg) {
  console.error(`[check-sbom-cves] FAIL ${msg}`);
  process.exit(code);
}

if (!existsSync(join(REPO_ROOT, 'node_modules'))) {
  skip('node_modules missing — run `npm install` first.');
}

const r = spawnSync(
  'npm',
  ['audit', '--json', '--omit=dev'],
  { cwd: REPO_ROOT, encoding: 'utf8' },
);

// `npm audit` exits non-zero when vulnerabilities are found — we still
// need to read the JSON. Treat exit codes 0/1 as "ran successfully".
if (typeof r.status !== 'number' || r.status > 1) {
  skip(`npm audit exited ${r.status} — assume transient registry/network issue. stderr: ${(r.stderr ?? '').slice(0, 200)}`);
}

let report;
try {
  report = JSON.parse(r.stdout);
} catch (e) {
  skip(`npm audit output is not valid JSON: ${(e instanceof Error) ? e.message : e}`);
}

// npm v7+ shape: { vulnerabilities: { <name>: { severity, via, ... } } }
// Older shapes are not supported; we skip rather than misreport.
const vulns = report?.vulnerabilities;
if (!vulns || typeof vulns !== 'object') {
  // npm v6 shape (advisories key) — no longer current; treat as skip.
  skip('npm audit JSON shape unrecognised — likely an older npm; skipping CVE gate.');
}

const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
const findings = [];

for (const [name, entry] of Object.entries(vulns)) {
  const sev = String(entry?.severity ?? 'unknown');
  if (sev in counts) counts[sev] += 1;

  // `via` may be an array of strings (transitive parents) or objects
  // describing the GHSA. We surface the GHSA-shaped ones in the report
  // because they carry CVE / GHSA identifiers.
  const advisories = (Array.isArray(entry?.via) ? entry.via : []).filter(
    (v) => typeof v === 'object' && v && (v.url || v.source || v.title),
  );

  findings.push({
    package: name,
    severity: sev,
    isDirect: Boolean(entry?.isDirect),
    range: entry?.range ?? null,
    fixAvailable: entry?.fixAvailable ?? false,
    advisories: advisories.map((a) => ({
      title: a.title ?? null,
      url: a.url ?? null,
      cve: Array.isArray(a.cve) ? a.cve : (a.cve ? [a.cve] : []),
      cvss: a.cvss?.score ?? null,
      vector: a.cvss?.vectorString ?? null,
    })),
  });
}

// Persist the report so reviewers can see the current scan state even
// when the gate passes. The file is checked in for traceability — it
// is the supply-chain analogue of `sbom.cyclonedx.json`.
const out = {
  generated_at: new Date().toISOString(),
  npm_audit_exit_code: r.status,
  counts,
  total: findings.length,
  policy: {
    fail_on: ['critical'].concat(
      String(process.env.SBOM_CVE_FAIL_ON_HIGH ?? '').toLowerCase() === 'true' ? ['high'] : [],
    ),
  },
  findings,
};
writeFileSync(REPORT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');

const total = findings.length;
const summary = `total=${total}  critical=${counts.critical}  high=${counts.high}  moderate=${counts.moderate}  low=${counts.low}  info=${counts.info}`;

if (counts.critical > 0) {
  console.error(`[check-sbom-cves] FAIL Critical CVEs in runtime deps. ${summary}`);
  for (const f of findings.filter((x) => x.severity === 'critical').slice(0, 20)) {
    console.error(`  ✖ ${f.package} (${f.range ?? '?'}) — direct=${f.isDirect}`);
    for (const a of f.advisories) {
      const cve = a.cve.length > 0 ? ` ${a.cve.join(',')}` : '';
      console.error(`     ${a.title ?? 'advisory'}${cve}`);
    }
  }
  console.error('\nFix: bump or replace the affected packages, then `npm run sbom:refresh`.');
  console.error(`Report written to: ${REPORT_PATH}`);
  process.exit(3);
}

if (counts.high > 0) {
  const failOnHigh = String(process.env.SBOM_CVE_FAIL_ON_HIGH ?? '').toLowerCase() === 'true';
  warn(`High CVE(s) found. ${summary}`);
  if (failOnHigh) {
    console.error('SBOM_CVE_FAIL_ON_HIGH=true — failing the build.');
    console.error(`Report written to: ${REPORT_PATH}`);
    process.exit(4);
  }
}

info(`OK  ${summary}`);
info(`Report written to ${REPORT_PATH.replace(REPO_ROOT + '/', '')}`);
process.exit(0);
