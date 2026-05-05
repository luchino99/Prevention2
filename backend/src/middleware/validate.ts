/**
 * Zod-based request body / query validator.
 *
 * Uniform error envelope:
 *   { error: { code: 'VALIDATION_FAILED', message: string, details: ZodIssue[] } }
 *
 * Never trust unvalidated input. Every mutation endpoint MUST parse its body
 * through a Zod schema declared in /shared/schemas/.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { ZodTypeAny, z, ZodError } from 'zod';

export interface ValidatedRequest<TBody, TQuery = unknown> extends VercelRequest {
  validatedBody: TBody;
  validatedQuery: TQuery;
}

function sendValidationError(res: VercelResponse, err: ZodError, source: 'body' | 'query'): void {
  res.status(422).json({
    error: {
      code: 'VALIDATION_FAILED',
      message: `Invalid request ${source}`,
      details: err.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
        code: i.code,
      })),
    },
  });
}

/** Parse and validate request JSON body. */
export function validateBody<S extends ZodTypeAny>(
  schema: S,
  handler: (
    req: VercelRequest & { validatedBody: z.infer<S> },
    res: VercelResponse
  ) => Promise<void> | void
) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    const result = schema.safeParse(req.body);
    if (!result.success) return sendValidationError(res, result.error, 'body');
    (req as any).validatedBody = result.data;
    await handler(req as any, res);
  };
}

/** Parse and validate query-string parameters. */
export function validateQuery<S extends ZodTypeAny>(
  schema: S,
  handler: (
    req: VercelRequest & { validatedQuery: z.infer<S> },
    res: VercelResponse
  ) => Promise<void> | void
) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    const result = schema.safeParse(req.query);
    if (!result.success) return sendValidationError(res, result.error, 'query');
    (req as any).validatedQuery = result.data;
    await handler(req as any, res);
  };
}

/** Combined: validate body and query together. */
export function validate<B extends ZodTypeAny, Q extends ZodTypeAny>(
  schemas: { body?: B; query?: Q },
  handler: (
    req: VercelRequest & {
      validatedBody: B extends ZodTypeAny ? z.infer<B> : undefined;
      validatedQuery: Q extends ZodTypeAny ? z.infer<Q> : undefined;
    },
    res: VercelResponse
  ) => Promise<void> | void
) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    if (schemas.body) {
      const r = schemas.body.safeParse(req.body);
      if (!r.success) return sendValidationError(res, r.error, 'body');
      (req as any).validatedBody = r.data;
    }
    if (schemas.query) {
      const r = schemas.query.safeParse(req.query);
      if (!r.success) return sendValidationError(res, r.error, 'query');
      (req as any).validatedQuery = r.data;
    }
    await handler(req as any, res);
  };
}

/** Assert the HTTP method matches; respond 405 otherwise. */
export function requireMethod(allowed: string | string[]) {
  const allowedList = Array.isArray(allowed) ? allowed : [allowed];
  return <Req extends VercelRequest, Res extends VercelResponse>(
    handler: (req: Req, res: Res) => Promise<void> | void
  ) => {
    return async (req: Req, res: Res): Promise<void> => {
      if (!req.method || !allowedList.includes(req.method)) {
        res.setHeader('Allow', allowedList.join(', '));
        res.status(405).json({
          error: { code: 'METHOD_NOT_ALLOWED', message: `Method ${req.method} not allowed` },
        });
        return;
      }
      await handler(req, res);
    };
  };
}
