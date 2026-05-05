#!/usr/bin/env node
/**
 * refresh-sbom.mjs
 * ----------------------------------------------------------------------------
 * Regenerate the project SBOM (Software Bill of Materials) at the repo
 * root as `sbom.cyclonedx.json` (CycloneDX 1.5 application BOM).
 *
 * Why a committed SBOM
 * --------------------
 * IEC 62304 §5.1 (SOUP — Software Of Unknown Provenance) requires an
 * inventory of every third-party component the device software relies
 * on. The SBOM is the modern machine-readable form of that inventory:
 * it can be loaded by Grype/Trivy for offline vulnerability scanning,
 * by GitHub Dependency Review for delta analysis, and by a notified
 * body during a CE audit.
 *
 * Committing the SBOM (rather than regenerating it on demand) gives:
 *   - Git history of every supply-chain change (`git log -- sbom.cyclonedx.json`)
 *   - A frozen artefact for any past commit (audit reproducibility)
 *   - A regression gate (`scripts/check-sbom.mjs`) that catches a
 *     dependency added without a paired SBOM refresh.
 *
 * How
 * ---
 *   `npm sbom --sbom-format=cyclonedx --sbom-type=application`
 *   produces a JSON document on stdout. We pipe it through the
 *   canonicaliser (sort components by `bom-ref`, drop volatile
 *   `metadata.timestamp` and `serialNumber`) so the file diffs cleanly
 *   between runs of the same lockfile.
 *
 * Run
 * ---
 *   npm run sbom:refresh
 *
 * Then commit the updated `sbom.cyclonedx.json`.
 *
 * Pre-conditions
 * --------------
 *   `npm install` MUST have been run first — `npm sbom` walks
 *   node_modules. The script exits non-zero with a hint if it isn't.
 * ----------------------------------------------------------------------------
 */

import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicaliseSbom } from './sbom-canonicalise.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const OUTPUT_PATH = join(REPO_ROOT, 'sbom.cyclonedx.json');

if (!existsSync(join(REPO_ROOT, 'node_modules'))) {
  console.error(
    '[refresh-sbom] FAIL node_modules is missing. Run `npm install` first ' +
    'so npm sbom can walk the resolved dependency graph.',
  );
  process.exit(2);
}

const r = spawnSync(
  'npm',
  ['sbom', '--sbom-format=cyclonedx', '--sbom-type=application'],
  { cwd: REPO_ROOT, encoding: 'utf8' },
);

if (r.status !== 0) {
  console.error(`[refresh-sbom] FAIL npm sbom exited ${r.status}`);
  if (r.stderr) console.error(r.stderr);
  process.exit(2);
}

let sbom;
try {
  sbom = JSON.parse(r.stdout);
} catch (e) {
  console.error('[refresh-sbom] FAIL npm sbom output is not valid JSON');
  console.error(e);
  process.exit(2);
}

const canonical = canonicaliseSbom(sbom);
writeFileSync(OUTPUT_PATH, JSON.stringify(canonical, null, 2) + '\n', 'utf8');

const components = (canonical.components ?? []).length;
console.log(
  `[refresh-sbom] OK  wrote ${OUTPUT_PATH.replace(REPO_ROOT + '/', '')} ` +
  `(${components} component${components === 1 ? '' : 's'})`,
);
