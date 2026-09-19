/**
 * Centralised HTTP error handling.
 *
 * Two rules keep error handling sane across the codebase:
 *
 *  1. Throw `AppError` for anything the caller should know about (400, 401, 403,
 *     404, 409...). It is the only error type that carries a status code.
 *
 *  2. Every response that fails looks like `{ success: false, message, details? }`
 *     — the exact shape the React app expects. Unexpected errors become a generic
 *     500 with no internal detail leaked (stack traces and SQL errors are logged
 *     server-side, never returned).
 */
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import type { ApiErrorBody, ApiErrorDetail } from '../types';
import { createLogger } from '../lib/logger';
import { isProduction } from '../config/env';

const log = createLogger('HTTP');

export class AppError extends Error {
  readonly statusCode: number;
  readonly details?: ApiErrorDetail[];
  // `override` because ES2022's Error already declares `cause`, and
  // noImplicitOverride requires us to say so explicitly.
  override readonly cause?: unknown;

  constructor(statusCode: number, message: string, details?: ApiErrorDetail[], cause?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    this.cause = cause;
    // Keeps `instanceof AppError` working when TypeScript targets older JS.
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string, details?: ApiErrorDetail[]): AppError {
    return new AppError(400, message, details);
  }
  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError(401, message);
  }
  static forbidden(message = 'You do not have access to this resource'): AppError {
    return new AppError(403, message);
  }
  static notFound(message = 'Resource not found'): AppError {
    return new AppError(404, message);
  }
  static conflict(message: string): AppError {
    return new AppError(409, message);
  }
  static notConfigured(message: string): AppError {
    // 503: the service exists but a dependency it needs is not configured.
    // Used by OAuth/Slack endpoints when credentials are absent.
    return new AppError(503, message);
  }
}

/** Anything hitting an unmatched route. */
export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    success: false,
    message: `Route not found: ${req.method} ${req.path}`,
  };
  res.status(404).json(body);
}

/** Maps known error types onto HTTP responses. */
function toHttpError(error: unknown): { statusCode: number; body: ApiErrorBody } {
  // --- errors we raised ourselves -----------------------------------------
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: { success: false, message: error.message, details: error.details },
    };
  }

  // --- Zod validation failures (normally caught by the validation middleware,
  //     but a schema used directly inside a service lands here) -------------
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      body: {
        success: false,
        message: 'Validation failed',
        details: error.issues.map((issue) => ({
          field: issue.path.join('.') || '(root)',
          message: issue.message,
        })),
      },
    };
  }

  // --- Prisma: translate database errors into meaningful HTTP errors -------
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        // Unique constraint violation. `meta.target` names the column(s).
        const target = Array.isArray(error.meta?.target)
          ? (error.meta.target as string[]).join(', ')
          : String(error.meta?.target ?? 'value');
        return {
          statusCode: 409,
          body: { success: false, message: `That ${target} already exists.` },
        };
      }
      case 'P2025':
        return { statusCode: 404, body: { success: false, message: 'Resource not found' } };
      case 'P2003':
        return {
          statusCode: 400,
          body: { success: false, message: 'Referenced record does not exist' },
        };
      default:
        log.error('Unhandled Prisma error', { code: error.code, message: error.message });
        return { statusCode: 500, body: { success: false, message: 'Database error' } };
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    log.error('Database unreachable', { message: error.message });
    return {
      statusCode: 503,
      body: { success: false, message: 'Database unavailable. Is PostgreSQL running?' },
    };
  }

  // --- body-parser rejects malformed JSON with a SyntaxError carrying `status`
  if (error instanceof SyntaxError && 'status' in error && 'body' in error) {
    return { statusCode: 400, body: { success: false, message: 'Malformed JSON body' } };
  }

  // --- Multer (file upload) -------------------------------------------------
  if (error instanceof Error && error.name === 'MulterError') {
    return { statusCode: 400, body: { success: false, message: `Upload rejected: ${error.message}` } };
  }

  return { statusCode: 500, body: { success: false, message: 'Something went wrong' } };
}

/**
 * Express error handler. MUST have exactly four parameters — Express detects
 * error middleware by arity, so dropping `next` silently turns this into a
 * normal middleware that never runs on errors.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const { statusCode, body } = toHttpError(error);

  // 5xx is our bug -> full detail server-side. 4xx is the caller's problem ->
  // one concise line, because noisy logs hide real incidents.
  if (statusCode >= 500) {
    log.error('Request failed', {
      method: req.method,
      path: req.path,
      statusCode,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  } else {
    log.warn('Request rejected', {
      method: req.method,
      path: req.path,
      statusCode,
      reason: body.message,
    });
  }

  // Never leak internals to the client in production.
  if (isProduction && statusCode >= 500) {
    body.message = 'Something went wrong';
  }

  res.status(statusCode).json(body);
}
