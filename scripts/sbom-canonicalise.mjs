/**
 * sbom-canonicalise.mjs
 * ----------------------------------------------------------------------------
 * Strip volatile fields, drop platform-conditional components, and sort
 * the components/dependencies arrays of a CycloneDX SBOM so that two
 * runs against the same lockfile — even on different operating systems
 * — produce a byte-equal file. Without this, the SBOM file would diff
 * every time `npm sbom` was invoked because of:
 *
 *   - `metadata.timestamp`              : changes on every run
 *   - `serialNumber`                    : random UUID per generation
 *   - `metadata.tools[i].version`       : may move when npm self-updates
 *   - `components[]` order              : not guaranteed stable across runs
 *   - platform-conditional components   : darwin-only fsevents, linux-only
 *                                         @esbuild/linux-x64, etc., differ
 *                                         between developer Mac and CI Linux
 *
 * Stripping or normalising these makes `git diff` show only meaningful
 * supply-chain changes (added/removed/upgraded core packages).
 *
 * Used by both `refresh-sbom.mjs` (to write the canonical file) and
 * `check-sbom.mjs` (to compare a freshly-generated SBOM against the
 * committed one).
 *
 * TODO (Sprint 2 / task 53): regenerate sbom.cyclonedx.json directly
 * from package-lock.json (which already lists every variant). At that
 * point the platform filter below becomes unnecessary and we can drop
 * it. Until then, the committed SBOM contains only cross-platform
 * components — the platform-specific binaries are tracked in
 * package-lock.json and `npm view <name> os cpu` for audit purposes.
 * ----------------------------------------------------------------------------
 */

// Platform-conditional package detection — see comment block above.
// Pattern A: native binary loaders shipped by bundlers / image libs.
// They follow a predictable @scope/<lib>-<os>-<arch> naming scheme.
const PLATFORM_BINARY_PATTERNS = [
  /^@esbuild\/[a-z0-9]+-[a-z0-9]+/,
  // Older esbuild ≤0.14 used a flat `esbuild-<os>-<arch>` naming. Modern
  // esbuild ≥0.15 moved to scoped `@esbuild/<os>-<arch>`. Keep both so a
  // transitive dep pinning the old layout (e.g. @vercel/node 3.x) is
  // also filtered.
  /^esbuild-(darwin|linux|win32|windows|freebsd|netbsd|openbsd|sunos|android)-/,
  // @rollup/rollup-<os>-<arch>(-<libc>)? — covers darwin, linux, win32,
  // freebsd, openbsd, android, openharmony, plus any future OS Rollup adds.
  // Using a permissive shape (just any `@rollup/rollup-…-…`) so a new
  // platform binary doesn't slip past the filter.
  /^@rollup\/rollup-[a-z0-9_]+-[a-z0-9_]+(-[a-z0-9_]+)?$/,
  /^@(swc|napi-rs|next|parcel)\/[a-z0-9-]+-(darwin|linux|win32|freebsd|openbsd|android|openharmony)-/,
  /^@(swc|napi-rs)\/core-(darwin|linux|win32)-/,
  /^lightningcss-(darwin|linux|win32|freebsd)-/,
  /^@img\/sharp-[a-z0-9-]+-/,
];
// Pattern B: standalone packages whose installation is gated by `os`
// or `cpu` in their own package.json. Plain names (no os-arch suffix).
// Verifiable via `npm view <name> os cpu`. Add entries as they surface.
const STANDALONE_PLATFORM_CONDITIONAL = new Set([
  'fsevents',                                // darwin-only file-system events
]);

/**
 * Test whether a CycloneDX component is platform-conditional and should
 * be excluded from the canonical (committed) SBOM. Exported so the
 * comparison logic in check-sbom.mjs can apply the same filter on the
 * live (npm sbom) side without re-implementing it.
 *
 * @param {Record<string, unknown>} component
 * @returns {boolean}
 */
export function isPlatformConditionalComponent(component) {
  if (!component || typeof component !== 'object') return false;
  const name = typeof component.name === 'string' ? component.name : '';
  const bomRef = typeof component['bom-ref'] === 'string' ? component['bom-ref'] : '';
  const purl = typeof component.purl === 'string' ? component.purl : '';
  // Test against several keys because CycloneDX consumers can format
  // identifiers differently (npm sbom uses bom-ref like "name@version",
  // standalone tools use purl like "pkg:npm/name@version").
  const candidates = [name, bomRef, purl];
  for (const k of candidates) {
    if (PLATFORM_BINARY_PATTERNS.some((re) => re.test(k))) return true;
    if (STANDALONE_PLATFORM_CONDITIONAL.has(k)) return true;
    // bomRef/purl variants like `fsevents@2.3.3` start with `<name>@`
    for (const standalone of STANDALONE_PLATFORM_CONDITIONAL) {
      if (k.startsWith(standalone + '@')) return true;
    }
  }
  return false;
}

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

    // Strip tools[*].version. The npm version that generated the SBOM
    // varies between developer machines (e.g. 10.8.2) and CI runners
    // (e.g. 10.9.4) and would otherwise cause a 2-line drift on every
    // npm self-update. The fact that npm produced the SBOM is preserved;
    // the exact version is recoverable from the build environment.
    if (Array.isArray(meta.tools)) {
      meta.tools = meta.tools.map((t) => {
        if (!t || typeof t !== 'object') return t;
        const { version, ...rest } = t; // eslint-disable-line no-unused-vars
        return rest;
      });
    }

    // Normalise root application component identity. `npm sbom` derives
    // metadata.component.name from the working directory (so a Mac
    // checkout in ~/Documents/GitHub/Prevention2 produces "Prevention2"
    // while a Cowork mount under ./Uelfy-claude produces "Uelfy-claude").
    // The canonical identity is the npm package name from package.json,
    // which is also embedded in the bom-ref / purl. We force name +
    // version from purl so the SBOM is stable across checkout paths.
    if (meta.component && typeof meta.component === 'object') {
      const comp = { ...meta.component };
      const purl = typeof comp.purl === 'string' ? comp.purl : '';
      // Expected purl format: "pkg:npm/<name>@<version>"
      const m = purl.match(/^pkg:npm\/(.+)@([^@]+)$/);
      if (m) {
        comp.name = m[1];
        comp.version = m[2];
      }
      // Drop properties that include a directory-relative path (volatile).
      if (Array.isArray(comp.properties)) {
        comp.properties = comp.properties.filter(
          (p) => p?.name !== 'cdx:npm:package:path',
        );
      }
      meta.component = comp;
    }

    out.metadata = meta;
  }

  // Filter out platform-conditional components (same logic exposed via
  // isPlatformConditionalComponent), then sort by bom-ref/purl/name.
  // Track the set of bom-refs that survive so we can keep dependencies[]
  // referentially consistent.
  const survivingRefs = new Set();
  if (Array.isArray(out.components)) {
    const kept = out.components.filter((c) => !isPlatformConditionalComponent(c));
    for (const c of kept) {
      const ref = (c && (c['bom-ref'] || c.purl || c.name)) ?? '';
      if (ref) survivingRefs.add(ref);
    }
    out.components = kept.sort((a, b) => {
      const ka = (a && (a['bom-ref'] || a.purl || a.name)) ?? '';
      const kb = (b && (b['bom-ref'] || b.purl || b.name)) ?? '';
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return 0;
    });
  }

  // Sort dependencies similarly (CycloneDX 1.5 has dependencies[]).
  // Drop entries whose ref points to a filtered component, and clean up
  // dependsOn[] entries that point to filtered components — keeps the
  // dependency graph internally consistent (no dangling refs).
  if (Array.isArray(out.dependencies)) {
    out.dependencies = [...out.dependencies]
      .filter((d) => survivingRefs.size === 0 || survivingRefs.has(d?.ref))
      .map((d) => ({
        ...d,
        dependsOn: Array.isArray(d?.dependsOn)
          ? [...d.dependsOn].filter((r) => survivingRefs.size === 0 || survivingRefs.has(r)).sort()
          : d?.dependsOn,
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
