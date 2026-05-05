/**
 * Supabase client configuration.
 *
 * Lazy initialisation
 * -------------------
 * The exported `supabaseAdmin` is a `Proxy` that defers env-var lookup
 * + client construction until the FIRST property access (e.g.
 * `supabaseAdmin.from('patients')`). This matters because:
 *
 *   - Importing `auth-middleware.ts` from a unit test pulls in this
 *     module, but unit tests rarely touch a Supabase chain — they
 *     stub or simply test pure logic. Eager construction would force
 *     every test runner to set fake `SUPABASE_URL` / `*_KEY` env
 *     vars, which is a footgun (real keys leak into CI envs, fake
 *     keys hide configuration drift in production).
 *
 *   - Production code paths always hit a method (`.from`, `.auth`,
 *     `.storage`, …) on the first request, so the lazy hop is a
 *     one-time micro-cost amortised across the function lifetime.
 *
 * `createUserClient(...)` and `getUserFromToken(...)` continue to
 * construct the client on call (each invocation produces a fresh
 * RLS-aware client), so they are unaffected.
 *
 * NEVER expose the service-role client to a browser — `supabaseAdmin`
 * bypasses RLS by design.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getEnvConfig } from './env.js';

let _adminInstance: SupabaseClient | undefined;

function getOrCreateAdminClient(): SupabaseClient {
  if (!_adminInstance) {
    const config = getEnvConfig();
    _adminInstance = createClient(
      config.supabaseUrl,
      config.supabaseServiceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }
  return _adminInstance;
}

/**
 * Service-role admin client (bypasses RLS). Lazily constructed on
 * first property access — the underlying object is the real
 * SupabaseClient instance.
 *
 * Tests that don't exercise a Supabase chain can import this module
 * without setting any env vars; the proxy simply never resolves.
 */
export const supabaseAdmin: SupabaseClient = new Proxy(
  {} as SupabaseClient,
  {
    get(_target, prop, receiver) {
      const client = getOrCreateAdminClient();
      // Bind methods so `this` resolves correctly when downstream
      // code does `const { from } = supabaseAdmin` style destructuring.
      const value = Reflect.get(client, prop, receiver);
      return typeof value === 'function' ? value.bind(client) : value;
    },
  },
);

/**
 * Factory function to create a user-specific Supabase client
 * Uses the user's JWT token for RLS-aware operations
 * Each user request should get their own client instance with their access token
 *
 * @param accessToken The user's JWT access token from Supabase auth
 * @returns SupabaseClient configured with the user's token
 */
export function createUserClient(accessToken: string): SupabaseClient {
  const config = getEnvConfig();
  return createClient(
    config.supabaseUrl,
    config.supabaseAnonKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    },
  );
}

/**
 * Helper to set auth session on user client after creation.
 */
export function setClientSession(
  client: SupabaseClient,
  accessToken: string,
  refreshToken?: string,
): void {
  client.auth
    .setSession({
      access_token: accessToken,
      refresh_token: refreshToken ?? '',
    })
    .catch(async (error: unknown) => {
      const { logStructured, tagFromError } = await import('../observability/structured-log.js');
      logStructured('error', 'SUPABASE_SET_SESSION_FAILED', {
        errorTag: tagFromError(error) ?? 'unknown',
      });
    });
}

/**
 * Extract user from JWT without making API call
 * Useful for quick authorization checks without round-trips
 */
export async function getUserFromToken(accessToken: string): Promise<any> {
  const client = createUserClient(accessToken);
  const { data, error } = await client.auth.getUser(accessToken);

  if (error || !data.user) {
    return null;
  }

  return data.user;
}

export default supabaseAdmin;
