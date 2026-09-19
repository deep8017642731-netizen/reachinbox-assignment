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
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import { RedisStore } from 'connect-redis';

import { env, isProduction } from './config/env';
import { getRedis } from './lib/redis';
import { createLogger } from './lib/logger';
import { notFoundHandler, errorHandler } from './middleware/error.middleware';
import emailRoutes from './routes/email.routes';
import senderRoutes from './routes/sender.routes';
import healthRoutes from './routes/health.routes';
import authRoutes from './routes/auth.routes';

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

    if (res.statusCode >= 500) log.error('Request', fields);
    else if (res.statusCode >= 400) log.warn('Request', fields);
    else log.info('Request', fields);
  });

  next();
}

/**
 * Session middleware backed by Redis.
 *
 * Why Redis and not the default MemoryStore: MemoryStore is explicitly documented
 * as unsuitable for production (it leaks, and it loses every session on restart —
 * so every restart would silently sign users out). Storing sessions in Redis also
 * means multiple API instances share them.
 */
function sessionMiddleware() {
  return session({
    name: 'reachinbox.sid',
    store: new RedisStore({ client: getRedis(), prefix: 'sess:' }),
    secret: env.SESSION_SECRET,
    resave: false, // do not re-save an unchanged session on every request
    saveUninitialized: false, // no cookie for visitors who have not signed in
    rolling: true, // refresh expiry on activity, so an active user is not logged out
    cookie: {
      httpOnly: true, // JavaScript cannot read the cookie (limits XSS impact)
      sameSite: 'lax', // blocks the cookie on cross-site POSTs (CSRF mitigation)
      secure: isProduction, // HTTPS-only in production; must be false on local http
      maxAge: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
      path: '/',
    },
  });
}

export function createApp(): Express {
  const app = express();

  // Do not advertise the framework version.
  app.disable('x-powered-by');
  // Behind the Vite dev proxy / any reverse proxy: needed so req.protocol and
  // req.ip reflect the client rather than the proxy.
  app.set('trust proxy', 1);

  // Sensible security headers (CSP, noSniff, frameguard, HSTS in production...).
  // crossOriginResourcePolicy is relaxed so the React dev server on another port
  // (and the sandbox preview host) can load API responses.
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // The API returns JSON only, so a strict CSP costs nothing here.
      contentSecurityPolicy: isProduction ? undefined : false,
    }),
  );

  /**
   * CORS. Credentials are enabled because the session cookie must travel with
   * requests. `origin` is an explicit list — never `*`, which is rejected by
   * browsers whenever credentials are involved (and would be a security hole).
   */
  const allowedOrigins = [env.FRONTEND_URL, env.BACKEND_URL];
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin requests, curl, and server-to-server calls have no Origin.
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        // In development also accept any localhost port: Vite picks a new port
        // when 5173 is busy, and rejecting it produces a confusing CORS error.
        if (!isProduction && /^https?:\/\/localhost:\d+$/.test(origin)) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  // Body parsing with explicit limits: an unbounded JSON body is a trivial DoS.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));

  app.use(sessionMiddleware());
  app.use(requestLogger);

  // ---- routes --------------------------------------------------------------
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/emails', emailRoutes);
  app.use('/api/senders', senderRoutes);

  // Tiny root endpoint so hitting the bare host is not a 404 mystery.
  app.get('/', (_req, res) => {
    res.json({
      success: true,
      service: 'ReachInbox Email Scheduler API',
      docs: 'See README.md for the full API reference',
      health: '/api/health',
    });
  });

  // ---- terminal middleware -------------------------------------------------
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
