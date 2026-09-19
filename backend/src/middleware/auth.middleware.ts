/**
 * Authentication guard.
 *
 * Every email/sender/Slack route goes through `requireAuth`. The guard answers
 * exactly one question — "who is making this request?" — and puts the answer on
 * `req.authUser`. Authorisation (can this user touch this row?) is enforced in
 * the services, always by filtering on `userId`.
 *
 * Order of resolution:
 *   1. An existing session (set by Google OAuth login).
 *   2. The development bypass user, if DEV_AUTH_BYPASS=true and not production.
 *   3. Otherwise 401 — the frontend redirects to /login.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env, isProduction } from '../config/env';
import { AppError } from './error.middleware';
import { getDevUser } from '../auth/dev-auth';

function devBypassEnabled(): boolean {
  return env.DEV_AUTH_BYPASS && !isProduction;
}

export const requireAuth: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (req.session?.user) {
      req.authUser = req.session.user;
      next();
      return;
    }

    if (devBypassEnabled()) {
      req.authUser = await getDevUser();
      next();
      return;
    }

    next(AppError.unauthorized('Sign in with Google to access this resource'));
  } catch (error) {
    next(error);
  }
};

/**
 * For routes that behave differently when signed in but do not require it
 * (e.g. GET /api/auth/me returning `{ user: null }` instead of a 401, so the
 * frontend can render the login page without an error state).
 */
export const optionalAuth: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    if (req.session?.user) {
      req.authUser = req.session.user;
    } else if (devBypassEnabled()) {
      req.authUser = await getDevUser();
    }
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Restricts a route to administrators. Used by Bull Board.
 *
 * Always mounted AFTER `requireAuth`, so identity is already resolved:
 *   router.use('/admin/queues', requireAuth, requireAdmin(adminEmails), handler)
 *
 * Security model (documented in the README): the queue dashboard is a local
 * operations tool. When ADMIN_EMAILS is empty we allow it in development only —
 * in production an empty allow-list denies everyone, rather than accidentally
 * exposing queue internals (including job payloads) to the public internet.
 */
export function requireAdmin(adminEmails: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.authUser;
    if (!user) {
      // Defensive: means the route was mounted without requireAuth.
      next(AppError.unauthorized());
      return;
    }

    if (adminEmails.length === 0) {
      if (!isProduction) {
        next();
        return;
      }
      next(AppError.forbidden('Queue dashboard is disabled: no ADMIN_EMAILS configured'));
      return;
    }

    if (!adminEmails.includes(user.email.toLowerCase())) {
      next(AppError.forbidden('Queue dashboard is restricted to administrators'));
      return;
    }

    next();
  };
}
