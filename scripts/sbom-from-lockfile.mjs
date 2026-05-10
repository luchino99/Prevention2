/**
 * sbom-from-lockfile.mjs
 * ----------------------------------------------------------------------------
 * Build a CycloneDX 1.5 application SBOM directly from `package-lock.json`,
 * without invoking `npm sbom` and without walking `node_modules`.
 *
 * Sprint 5 task 5.2 (#53) — closes the "platform drift" class of issues:
 * `npm sbom` walks the local `node_modules`, so a Mac developer (darwin-
 * arm64) and a CI Linux runner (linux-x64) installed different platform-
 * conditional binaries (`@rollup/rollup-darwin-arm64` vs
 * `@rollup/rollup-linux-x64-gnu`, `fsevents` vs none, etc.). The pre-5.2
 * solution was to filter those out in `sbom-canonicalise.mjs`. The post-
 * 5.2 solution is structural: the lockfile is platform-neutral by design,
 * so building from it gives an SBOM that's byte-identical regardless of
 * whose machine generated it. The platform-binary filter remains as a
 * defence-in-depth no-op.
 *
 * Why not adopt a third-party generator?
 *   - `@cyclonedx/cyclonedx-npm` reads node_modules, same drift problem.
 *   - `cdxgen` reads the lockfile but pulls in 50+ MB of dependencies.
 *   - The CycloneDX format is small enough that a 200-line direct
 *     translation is auditable and zero-dependency.
 *
 * Output shape: matches what `npm sbom` produces post-canonicalisation,
 * so the existing `check-sbom.mjs` continues to compare the committed
 * SBOM against the live one without changes.
 *
 * Public API
 * ----------
 *   buildSbomFromLockfile(lockJson, packageJson) → CycloneDX 1.5 SBOM
 * ----------------------------------------------------------------------------
 */

/**
 * Convert a package-lock.json `packages` entry to a CycloneDX component.
 * Returns null when the entry should be skipped (root, link, or empty).
 *
 * @param {string} pathKey  e.g. "node_modules/zod" or ""
 * @param {Record<string, unknown>} entry
 * @returns {Record<string, unknown> | null}
 */
function pkgEntryToComponent(pathKey, entry) {
  if (pathKey === '') return null;                     // root package handled separately
  if (entry?.link === true) return null;               // workspace symlinks
  // Extract the LEAF package name. Lockfile keys carry the install
  // path:
  //   "node_modules/zod"                                       → "zod"
  //   "node_modules/@types/node"                               → "@types/node"
  //   "node_modules/@vercel/node/node_modules/@types/node"     → "@types/node"
  //   "node_modules/foo/node_modules/bar/node_modules/baz"     → "baz"
  // We split on the last "/node_modules/" so a nested copy collapses to
  // the same leaf the committed SBOM uses; nested-dup detection then
  // happens via (name, version) deduplication downstream.
  const segments = pathKey.split('/node_modules/');
  const leaf = segments[segments.length - 1];
  const name = leaf.replace(/^node_modules\//, '');
  if (!name) return null;
  const version = typeof entry?.version === 'string' ? entry.version : null;
  if (!version) return null;
  if (entry?.dev === true && entry?.optional === true) {
    // Skip dev+optional combinations? No — dev-only deps are still part
    // of the build-time SBOM (typescript, vitest, etc.). Keep them.
    void 0;
  }

  const purl = `pkg:npm/${encodeURIComponent(name).replace(/%40/g, '@').replace(/%2F/g, '/')}@${version}`;
  const bomRef = `${name}@${version}`;

  /** @type {Record<string, unknown>} */
  const component = {
    'bom-ref': bomRef,
    type: 'library',
    name,
    version,
    purl,
  };

  if (typeof entry?.license === 'string') {
    component.licenses = [{ license: { id: entry.license } }];
  } else if (Array.isArray(entry?.license)) {
    component.licenses = entry.license
      .filter((l) => typeof l === 'string')
      .map((id) => ({ license: { id } }));
  }

  if (typeof entry?.resolved === 'string') {
    component.externalReferences = [
      { type: 'distribution', url: entry.resolved },
    ];
  }

  if (typeof entry?.integrity === 'string') {
    // Lockfile integrity uses SRI format ("sha512-…"). CycloneDX hashes
    // expect uppercase algo + hex value. We map sha512/sha384/sha256.
    const m = entry.integrity.match(/^(sha\d{3})-(.+)$/);
    if (m) {
      component.hashes = [{ alg: m[1].toUpperCase().replace('SHA', 'SHA-'), content: m[2] }];
    }
  }

  return component;
}

/**
 * Build a CycloneDX 1.5 application SBOM from a parsed `package-lock.json`
 * + `package.json`. Output is already canonical (sorted, no volatile
 * fields), so `canonicaliseSbom` becomes a no-op when called on it.
 *
 * @param {Record<string, unknown>} lockJson
 * @param {Record<string, unknown>} packageJson
 * @returns {Record<string, unknown>}
 */
export function buildSbomFromLockfile(lockJson, packageJson) {
  if (!lockJson || typeof lockJson !== 'object') {
    throw new TypeError('buildSbomFromLockfile: lockJson must be an object');
  }
  if (typeof lockJson.lockfileVersion !== 'number' || lockJson.lockfileVersion < 2) {
    throw new Error(
      `buildSbomFromLockfile: lockfileVersion ${lockJson.lockfileVersion} unsupported. `
        + 'Requires npm 7+ (lockfileVersion ≥ 2) where every dependency lives '
        + 'under packages{}.',
    );
  }

  const rootName = (typeof packageJson?.name === 'string' && packageJson.name)
    || (typeof lockJson.name === 'string' && lockJson.name)
    || 'root';
  const rootVersion = (typeof packageJson?.version === 'string' && packageJson.version)
    || (typeof lockJson.version === 'string' && lockJson.version)
    || '0.0.0';
  const rootRef = `${rootName}@${rootVersion}`;
  const rootPurl = `pkg:npm/${rootName}@${rootVersion}`;

  /** @type {Record<string, unknown>[]} */
  const components = [];
  /** @type {Set<string>} */
  const seenRefs = new Set();

  const pkgs = (lockJson.packages && typeof lockJson.packages === 'object')
    ? lockJson.packages
    : {};

  for (const [pathKey, entry] of Object.entries(pkgs)) {
    if (!entry || typeof entry !== 'object') continue;
    const c = pkgEntryToComponent(pathKey, /** @type {Record<string, unknown>} */ (entry));
    if (!c) continue;
    // Dedupe on (name, version): nested copies of the same dep at the
    // same version (common for hoisting splits) become a single
    // component, mirroring `npm sbom`'s output.
    const ref = String(c['bom-ref']);
    if (seenRefs.has(ref)) continue;
    seenRefs.add(ref);
    components.push(c);
  }

  // Stable sort — CycloneDX consumers don't require a specific order, but
  // the committed SBOM diff is meaningful only when ordering is fixed.
  components.sort((a, b) => {
    const ka = String(a['bom-ref'] ?? '');
    const kb = String(b['bom-ref'] ?? '');
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // Build the dependencies graph from the same lockfile entries. The
  // root depends on every direct dep declared in `packages[""].dependencies
  // | devDependencies | optionalDependencies | peerDependencies`. Each
  // non-root component depends on the union of its lockfile-declared
  // dependencies / optional / peer.
  /** @type {{ ref: string, dependsOn: string[] }[]} */
  const dependencies = [];

  function depsFromEntry(entry) {
    /** @type {Set<string>} */
    const out = new Set();
    for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const block = /** @type {Record<string, string> | undefined} */ (entry?.[k]);
      if (!block) continue;
      for (const name of Object.keys(block)) {
        // Find the first matching component; lockfile may resolve to a
        // hoisted version. We use the canonical bom-ref name@version so
        // callers can dedupe.
        const matching = components.find((c) => c.name === name);
        if (matching) out.add(String(matching['bom-ref']));
      }
    }
    return [...out].sort();
  }

  // Root entry
  const rootEntry = pkgs[''];
  dependencies.push({ ref: rootRef, dependsOn: depsFromEntry(rootEntry) });

  // Per-component entries
  for (const c of components) {
    const pathKey = `node_modules/${c.name}`;
    const entry = pkgs[pathKey];
    if (entry) {
      dependencies.push({
        ref: String(c['bom-ref']),
        dependsOn: depsFromEntry(entry),
      });
    }
  }
  dependencies.sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    metadata: {
      tools: [
        { vendor: 'uelfy', name: 'sbom-from-lockfile' },
      ],
      component: {
        'bom-ref': rootRef,
        type: 'application',
        name: rootName,
        version: rootVersion,
        purl: rootPurl,
      },
    },
    components,
    dependencies,
  };
}
