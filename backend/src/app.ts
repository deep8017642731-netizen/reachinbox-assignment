/**
 * Express application assembly.
 *
 * `createApp()` returns a configured app WITHOUT starting a listener. That
 * separation is what lets integration tests run the real app in-process (via
 * supertest) without binding a port.
 *
 * MIDDLEWARE ORDER MATTERS — each layer below depends on the previous one:
 *   security headers -> CORS -> body parsing -> session -> logging -> routes
 *   -> 404 -> error handler (always last, and always with 4 parameters)
 */
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import { RedisStore } from 'connect-redis';

import { adminEmails, env, isProduction } from './config/env';
import { getSessionRedis } from './lib/redis';
import { createLogger } from './lib/logger';
import { notFoundHandler, errorHandler } from './middleware/error.middleware';
import { requireAdmin, requireAuth } from './middleware/auth.middleware';
import { BULL_BOARD_PATH, createQueueDashboardRouter } from './admin/queues.dashboard';
import emailRoutes from './routes/email.routes';
import senderRoutes from './routes/sender.routes';
import healthRoutes from './routes/health.routes';
import authRoutes from './routes/auth.routes';
import slackRoutes from './routes/slack.routes';
import oauthRoutes from './routes/oauth.routes';

const log = createLogger('HTTP');

/** One line per request: method, path, status and duration. */
function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    // Health checks run every few seconds; logging them buries everything else.
    if (req.path === '/api/health') return;

    const fields = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Number(durationMs.toFixed(1)),
      userId: req.authUser?.id,
    };

    if (res.statusCode >= 500) {
      log.error('Request', fields);
    } else if (res.statusCode >= 400) {
      log.warn('Request', fields);
    } else {
      log.info('Request', fields);
    }
  });

  next();
}

/**
 * Session middleware backed by Redis.
 *
 * IMPORTANT:
 * `getSessionRedis()` returns the official `redis` client used by
 * connect-redis@9.
 *
 * The connection itself is established during server bootstrap in
 * `src/server.ts` BEFORE `createApp()` is called.
 *
 * This function therefore remains synchronous, which is important because
 * Express expects `app.use()` to receive a middleware function rather than
 * a Promise.
 */
function sessionMiddleware() {
  const redisClient = getSessionRedis();

  return session({
    name: 'reachinbox.sid',

    store: new RedisStore({
      client: redisClient,
      prefix: 'sess:',
    }),

    secret: env.SESSION_SECRET,

    // Do not re-save an unchanged session on every request.
    resave: false,

    // Do not create sessions for unauthenticated visitors automatically.
    saveUninitialized: false,

    // Refresh session expiry while the user is active.
    rolling: true,

    cookie: {
      // JavaScript cannot read the cookie.
      httpOnly: true,

      // Allows the OAuth redirect flow while providing CSRF protection.
      sameSite: 'lax',

      // HTTPS-only in production; false for local HTTP development.
      secure: isProduction,

      // Session lifetime.
      maxAge: env.SESSION_TTL_HOURS * 60 * 60 * 1000,

      path: '/',
    },
  });
}

export function createApp(): Express {
  const app = express();

  // Do not advertise the framework version.
  app.disable('x-powered-by');

  // Behind the Vite dev proxy / any reverse proxy: needed so req.protocol
  // and req.ip reflect the client rather than the proxy.
  app.set('trust proxy', 1);

  // ---------------------------------------------------------------------------
  // SECURITY HEADERS
  // ---------------------------------------------------------------------------

  app.use(
    helmet({
      crossOriginResourcePolicy: {
        policy: 'cross-origin',
      },

      // The API returns JSON only, so a strict CSP costs nothing here.
      contentSecurityPolicy: isProduction ? undefined : false,
    }),
  );

  // ---------------------------------------------------------------------------
  // CORS
  // ---------------------------------------------------------------------------

  /**
   * Credentials are enabled because the session cookie must travel with
   * requests.
   *
   * `origin` is an explicit list — never `*`, which is rejected by browsers
   * whenever credentials are involved.
   */
  const allowedOrigins = [env.FRONTEND_URL, env.BACKEND_URL];

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin requests, curl, and server-to-server calls have no Origin.
        if (!origin) {
          return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }

        // In development also accept any localhost port.
        // Vite picks a new port when 5173 is busy.
        if (!isProduction && /^https?:\/\/localhost:\d+$/.test(origin)) {
          return callback(null, true);
        }

        return callback(null, false);
      },

      credentials: true,

      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  // ---------------------------------------------------------------------------
  // BODY PARSING
  // ---------------------------------------------------------------------------

  // Explicit limits prevent unbounded request bodies.
  app.use(
    express.json({
      limit: '1mb',
    }),
  );

  app.use(
    express.urlencoded({
      extended: false,
      limit: '256kb',
    }),
  );

  // ---------------------------------------------------------------------------
  // SESSION
  // ---------------------------------------------------------------------------

  app.use(sessionMiddleware());

  // ---------------------------------------------------------------------------
  // REQUEST LOGGER
  // ---------------------------------------------------------------------------

  app.use(requestLogger);

  // ---------------------------------------------------------------------------
  // API ROUTES
  // ---------------------------------------------------------------------------

  app.use('/api/health', healthRoutes);

  app.use('/api/auth', authRoutes);

  app.use('/api/emails', emailRoutes);

  app.use('/api/senders', senderRoutes);

  app.use('/api/slack', slackRoutes);

  // ---------------------------------------------------------------------------
  // OAUTH ROUTES
  // ---------------------------------------------------------------------------

  /**
   * Browser-facing OAuth.
   *
   * Google and Slack redirect back to these routes.
   */
  app.use('/auth', oauthRoutes);

  // ---------------------------------------------------------------------------
  // BULL BOARD
  // ---------------------------------------------------------------------------

  /**
   * Bull Board — the real queue dashboard.
   *
   * Layered protection:
   *
   * 1. requireAuth resolves the identity.
   * 2. requireAdmin decides whether that identity may see queue internals.
   *
   * Job payloads can contain recipient addresses, so this endpoint must not
   * be publicly accessible.
   */
  app.use(
    BULL_BOARD_PATH,
    requireAuth,
    requireAdmin(adminEmails),
    createQueueDashboardRouter(),
  );

  // ---------------------------------------------------------------------------
  // ROOT ENDPOINT
  // ---------------------------------------------------------------------------

  // Tiny root endpoint so hitting the bare host is not a 404 mystery.
  app.get('/', (_req, res) => {
    res.json({
      success: true,
      service: 'ReachInbox Email Scheduler API',
      docs: 'See README.md for the full API reference',
      health: '/api/health',
    });
  });

  // ---------------------------------------------------------------------------
  // TERMINAL MIDDLEWARE
  // ---------------------------------------------------------------------------

  // Must remain last.
  app.use(notFoundHandler);

  // Error handler must be the final middleware.
  app.use(errorHandler);

  return app;
}