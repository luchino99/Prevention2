/**
 * Security headers middleware.
 *
 * Applies defence-in-depth HTTP response headers aligned with OWASP ASVS and
 * the GDPR-aware B2B clinical posture described in the blueprint.
 *
 * All handlers SHOULD wrap their response with `applySecurityHeaders(res)` or
 * via the `withSecurityHeaders()` HOF.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

export interface SecurityHeaderOptions {
  /** When true, enable strict CSP suitable for HTML responses. */
  isHtmlResponse?: boolean;
  /** Allow an optional list of extra script-src origins (used sparingly). */
  extraScriptSrc?: string[];
  /** Allow connect-src (e.g. Supabase project URL). Defaults to 'self'. */
  connectSrc?: string[];
}

const DEFAULT_CSP_DIRECTIVES = (opts: SecurityHeaderOptions = {}): string => {
  const scriptSrc = ["'self'", ...(opts.extraScriptSrc ?? [])].join(' ');
  const connectSrc = ["'self'", ...(opts.connectSrc ?? [])].join(' ');
  const directives = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`, // inline styles used by current UI; tightening tracked in refactor plan
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src ${connectSrc}`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ];
  return directives.join('; ');
};

export function applySecurityHeaders(
  res: VercelResponse,
  opts: SecurityHeaderOptions = {}
): void {
  // Transport
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

  // Clickjacking / framing
  res.setHeader('X-Frame-Options', 'DENY');

  // MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Referrer privacy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Disable powerful browser features we never use
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=(), usb=()'
  );

  // Cache control — clinical endpoints must not be cached by intermediaries
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');

  // Cross-origin isolation
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

  // Content-Security-Policy (only on HTML responses by default; safe for JSON too)
  res.setHeader('Content-Security-Policy', DEFAULT_CSP_DIRECTIVES(opts));
}

/**
 * Higher-order wrapper: applies security headers before handing off to the handler.
 */
export function withSecurityHeaders<Req extends VercelRequest, Res extends VercelResponse>(
  handler: (req: Req, res: Res) => Promise<void> | void,
  opts: SecurityHeaderOptions = {}
) {
  return async (req: Req, res: Res): Promise<void> => {
    applySecurityHeaders(res, opts);
    await handler(req, res);
  };
}

/**
 * CORS helper. This API is first-party only (same-origin), so CORS is restrictive.
 * Allow only the configured origin(s) via env; otherwise reject preflight.
 */
export function applyStrictCors(
  req: VercelRequest,
  res: VercelResponse,
  allowedOrigins: string[]
): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== 'string') return true; // same-origin request, no CORS needed
  if (!allowedOrigins.includes(origin)) {
    res.status(403).json({ error: { code: 'CORS_BLOCKED', message: 'Origin not allowed' } });
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  return true;
}
