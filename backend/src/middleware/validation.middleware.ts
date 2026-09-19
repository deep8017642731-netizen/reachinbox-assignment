/**
 * Validation middleware.
 *
 * Usage:
 *   router.post('/schedule', validate(scheduleEmailSchema), handler)
 *
 * The parsed result is stored on `req.validated.body` rather than reassigning
 * `req.body`. Why: Express 5 exposes `req.query` as a getter-only property, so
 * reassigning it throws in strict mode. Handling all three sources the same way
 * keeps the behaviour predictable.
 *
 * Because Zod *transforms* values (comma string -> number, ISO string -> Date),
 * controllers must read the parsed value, not the raw one. The typed helpers at
 * the bottom of this file make that ergonomic.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { ZodError } from 'zod';
import { AppError } from './error.middleware';

export type ValidationSource = 'body' | 'query' | 'params';

export function validate(schema: ZodType, source: ValidationSource = 'body'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: [source === 'body' ? '' : source, ...issue.path.map(String)]
          .filter(Boolean)
          .join('.') || '(root)',
        message: issue.message,
      }));
      next(AppError.badRequest('Validation failed', details));
      return;
    }

    req.validated = { ...req.validated, [source]: result.data };
    next();
  };
}

/**
 * Reads a value the validation middleware already parsed and type-checked.
 *
 * The cast is safe by construction: the only way `req.validated.query` gets
 * populated is by `validate(schema, 'query')` with that same schema — this
 * project never calls `validate` with a schema different from the one passed to
 * these helpers.
 */
export function validatedBody<T>(req: Request): T {
  if (req.validated?.body === undefined) {
    throw new Error('validatedBody() called without validate(schema, "body") on this route');
  }
  return req.validated.body as T;
}

export function validatedQuery<T>(req: Request): T {
  if (req.validated?.query === undefined) {
    throw new Error('validatedQuery() called without validate(schema, "query") on this route');
  }
  return req.validated.query as T;
}

export function validatedParams<T>(req: Request): T {
  if (req.validated?.params === undefined) {
    throw new Error('validatedParams() called without validate(schema, "params") on this route');
  }
  return req.validated.params as T;
}

/** Lets non-Express callers (services, tests) surface Zod errors as HTTP 400s. */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw AppError.badRequest(
        'Validation failed',
        error.issues.map((issue) => ({
          field: issue.path.map(String).join('.') || '(root)',
          message: issue.message,
        })),
      );
    }
    throw error;
  }
}
