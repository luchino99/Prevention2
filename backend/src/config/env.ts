/**
 * Environment variable validation and typed configuration
 * Validates required variables at startup and exports typed config
 */

const REQUIRED_VARS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
] as const;

const OPTIONAL_VARS = [
  'OPENAI_API_KEY',
  'NODE_ENV',
  'LOG_LEVEL',
] as const;

interface EnvConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  supabaseAnonKey: string;
  openaiApiKey?: string;
  nodeEnv: string;
  logLevel: string;
}

/**
 * Validates environment variables and returns typed config object
 * Throws if any required variables are missing
 */
export function validateEnv(): EnvConfig {
  const missingVars: string[] = [];

  // Check required variables
  for (const varName of REQUIRED_VARS) {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(', ')}`
    );
  }

  // Validate SUPABASE_URL format
  const supabaseUrl = process.env.SUPABASE_URL!;
  try {
    new URL(supabaseUrl);
  } catch {
    throw new Error(
      `Invalid SUPABASE_URL format: ${supabaseUrl}`
    );
  }

  return {
    supabaseUrl,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
    openaiApiKey: process.env.OPENAI_API_KEY,
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
  };
}

// Lazy module-level cache. The validator runs ONLY on the first call to
// `getEnvConfig()` — never at module-load — so importing this file from
// a unit test or a tool script does NOT require Supabase env vars to be
// set. This is the contract that makes `vi.mock('../../backend/src/config/supabase')`
// work without a parallel mock for env, and that lets `tools/*` scripts
// import config helpers safely.
//
// AUDIT: previously a `export default getEnvConfig();` line forced eager
// validation on every import. That caused `tests/unit/mfa-matrix.test.ts`
// and `tests/unit/middleware.test.ts` to fail with
// "Missing required environment variables: SUPABASE_URL, …" because they
// transitively import `auth-middleware → supabase → env` and the default
// export ran the validator before any test mock could intervene. The
// default export has been removed; production code uses the named
// `getEnvConfig()` export which is the canonical entry point.
let envConfig: EnvConfig | null = null;

export function getEnvConfig(): EnvConfig {
  if (!envConfig) {
    envConfig = validateEnv();
  }
  return envConfig;
}
