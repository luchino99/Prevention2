/**
 * public-config.js
 * ---------------------------------------------------------------------------
 * Shared bootstrap that initialises `window.__UELFY_CONFIG__` for every
 * frontend page.
 *
 * Why this file exists
 * --------------------
 * The CSP shipped by `vercel.json` (`script-src 'self'`) forbids inline
 * `<script>` blocks — a deliberate hardening (audit blocker B-13) so a
 * stored-XSS or a third-party tag injection cannot execute arbitrary JS.
 *
 * Every page used to declare an inline `<script>` initialiser like:
 *
 *     <script>
 *       window.__UELFY_CONFIG__ = {
 *         supabaseUrl: '__PUBLIC_SUPABASE_URL__',
 *         supabaseAnonKey: '__PUBLIC_SUPABASE_ANON_KEY__'
 *       };
 *     </script>
 *
 * That is now centralised here. The two `__PUBLIC_…__` placeholders are
 * substituted at build time by `scripts/inject-public-config.mjs`, which
 * was extended to walk both `.html` and `.js` files in `frontend-dist/`.
 *
 * Load order
 * ----------
 * Pages MUST include this file BEFORE any `type="module"` page script
 * that calls into the Supabase SDK or the api-client, because the
 * client reads `window.__UELFY_CONFIG__` at module-init time. The
 * canonical pattern is:
 *
 *     <script src="../assets/js/public-config.js"></script>
 *     <script type="module" src="./<page>.js"></script>
 *
 * The non-module first script blocks until executed, so the module
 * script (which is implicitly deferred) sees the populated config.
 *
 * Local development
 * -----------------
 * When the page is opened from `http://localhost:*`, we keep the legacy
 * fallback to a local Supabase emulator (`http://localhost:54321`). The
 * placeholder is only honoured for production-built bundles.
 *
 * Security
 * --------
 * Both values exposed here are PUBLIC by design in Supabase (project
 * URL + anon JWT). The build script defensively refuses to embed any
 * value whose JWT `role` claim is not `anon`, so a service-role key
 * cannot accidentally land in the public bundle.
 * ---------------------------------------------------------------------------
 */

(function bootstrapPublicConfig() {
  var isLocal =
    typeof window !== 'undefined' &&
    window.location &&
    typeof window.location.origin === 'string' &&
    window.location.origin.indexOf('localhost') !== -1;

  window.__UELFY_CONFIG__ = {
    supabaseUrl: isLocal
      ? 'http://localhost:54321'
      : '__PUBLIC_SUPABASE_URL__',
    supabaseAnonKey: '__PUBLIC_SUPABASE_ANON_KEY__'
  };
})();
