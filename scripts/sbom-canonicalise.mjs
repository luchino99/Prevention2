/**
 * sbom-canonicalise.mjs
 * ----------------------------------------------------------------------------
 * Strip volatile fields and sort the components array of a CycloneDX
 * SBOM so that two runs against the same lockfile produce a byte-equal
 * file. Without this, the SBOM file would diff every time `npm sbom`
 * was invoked because of:
 *
 *   - `metadata.timestamp`           : changes on every run
 *   - `serialNumber`                 : random UUID per generation
 *   - `metadata.tools[i].version`    : may move when npm self-updates
 *   - `components[]` order           : not guaranteed stable across runs
 *
 * Stripping or normalising these makes `git diff` show only meaningful
 * supply-chain changes (added/removed/upgraded packages).
 *
 * Used by both `refresh-sbom.mjs` (to write the canonical file) and
 * `check-sbom.mjs` (to compare a freshly-generated SBOM against the
 * committed one).
 * ----------------------------------------------------------------------------
 */

/**
 * @param {Record<string, unknown>} sbom
 * @returns {Record<string, unknown>}
 */
export function canonicaliseSbom(sbom) {
  if (!sbom || typeof sbom !== 'object') {
    throw new TypeError('canonicaliseSbom: expected an SBOM object');
  }

  // Shallow clone so we don't mutate the caller.
  const out = { ...sbom };

  // Drop volatile top-level fields.
  delete out.serialNumber;
  delete out.version; // serial / counter — useful in publishing pipelines, not in a frozen file

  // Normalise metadata.
  if (out.metadata && typeof out.metadata === 'object') {
    const meta = { ...out.metadata };
    delete meta.timestamp;
    // Keep tools but normalise — toolchain version drifts are part of
    // the audit trail; we only strip per-run noise.
    out.metadata = meta;
  }

  // Sort components by bom-ref (or purl as fallback) so the array is
  // deterministic across runs.
  if (Array.isArray(out.components)) {
    out.components = [...out.components].sort((a, b) => {
      const ka = (a && (a['bom-ref'] || a.purl || a.name)) ?? '';
      const kb = (b && (b['bom-ref'] || b.purl || b.name)) ?? '';
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return 0;
    });
  }

  // Sort dependencies similarly (CycloneDX 1.5 has dependencies[]).
  if (Array.isArray(out.dependencies)) {
    out.dependencies = [...out.dependencies]
      .map((d) => ({
        ...d,
        dependsOn: Array.isArray(d?.dependsOn) ? [...d.dependsOn].sort() : d?.dependsOn,
      }))
      .sort((a, b) => {
        const ka = a?.ref ?? '';
        const kb = b?.ref ?? '';
        if (ka < kb) return -1;
        if (ka > kb) return 1;
        return 0;
      });
  }

  return out;
}
