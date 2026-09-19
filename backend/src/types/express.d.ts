/**
 * Express type augmentation.
 *
 * We add two properties to Express's Request:
 *
 *  - `authUser`: the authenticated user for this request. We deliberately do NOT
 *    reuse the name `user`, because Passport (used for Google OAuth) already
 *    augments `Request` with its own `user?: Express.User`. Two declarations of
 *    the same property with different types is a TypeScript error, and shadowing
 *    one with the other is exactly the kind of confusion that causes bugs.
 *
 *  - `validated`: schemas parsed by the validation middleware. Express 5 defines
 *    `req.query` as a getter-only property, so a middleware cannot simply
 *    reassign it (that throws in strict mode). Storing parsed values in a side
 *    object keeps the parsed, fully-typed data available to controllers without
 *    fighting the framework.
 */
import type { SessionUser } from './index';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: SessionUser;
      validated?: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

/**
 * Session payload shape. Declared here so `req.session.user` is typed
 * everywhere without importing anything.
 */
declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
    /** CSRF-ish state nonce for OAuth round trips (Google + Slack). */
    oauthState?: string;
    /** Where to send the browser after a successful OAuth callback. */
    oauthReturnTo?: string;
  }
}

export {};
