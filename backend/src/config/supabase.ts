/**
 * Supabase client configuration
 * Exports both admin client (bypasses RLS) and user client factory (RLS-aware)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getEnvConfig } from './env.js';

const config = getEnvConfig();

/**
 * Admin client - uses SERVICE_ROLE_KEY to bypass RLS
 * Used for server-side operations that need to operate outside of RLS policies
 * IMPORTANT: Only use on the server, never expose to client
 */
export const supabaseAdmin: SupabaseClient = createClient(
  config.supabaseUrl,
  config.supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
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
    }
  );
}

/**
 * Helper to set auth session on user client after creation
 * @param client The user client to set session on
 * @param accessToken The JWT access token
 * @param refreshToken Optional refresh token
 */
export function setClientSession(
  client: SupabaseClient,
  accessToken: string,
  refreshToken?: string
): void {
  // supabase-js v2 `setSession()` accepts only `{ access_token, refresh_token }`.
  // All other fields (token_type, expires_in/at, user) are derived server-side
  // by GoTrue from the JWT itself — passing them here is rejected by the
  // compiler in recent @supabase/supabase-js releases.
  client.auth
    .setSession({
      access_token: accessToken,
      refresh_token: refreshToken ?? '',
    })
    .catch(async (error: unknown) => {
      // C-02: structured emit so the auth-bootstrap failure is greppable
      // alongside other observability events. We import lazily to avoid
      // a top-level import cycle (supabase.ts is also imported by the
      // logger's own dependency chain at boot).
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
