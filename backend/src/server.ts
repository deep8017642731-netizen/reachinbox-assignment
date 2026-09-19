/**
 * API entry point: validate configuration, prove dependencies are reachable,
 * print a useful banner, start listening, and shut down cleanly.
 *
 * NOTE: this process does NOT send emails. Email sending lives in
 * `src/workers/email.worker.ts`, started separately (`npm run worker:dev`), so the
 * API stays responsive and the worker can be restarted, scaled or debugged on
 * its own. See README "Running Backend" / "Running Worker".
 */
import type { Server } from 'node:http';

import { createApp } from './app';

import {
  assertDevAuthBypassAllowed,
  describeIntegrations,
  env,
} from './config/env';

import { createLogger } from './lib/logger';

import { checkDatabase, disconnectDatabase } from './lib/prisma';

import {
  checkRedis,
  disconnectRedis,
  connectSessionRedis,
  disconnectSessionRedis,
} from './lib/redis';

import { closeQueue } from './queues/email.queue';

import { closeElasticsearch } from './services/elasticsearch.service';

const log = createLogger('Server');

function printBanner(): void {
  const line = '─'.repeat(64);

  console.log(`\n${line}`);
  console.log('  ReachInbox Email Scheduler — API');
  console.log(`  environment : ${env.NODE_ENV}`);
  console.log(`  port        : ${env.PORT}`);
  console.log(`  concurrency : ${env.WORKER_CONCURRENCY} (worker)`);
  console.log(`  min delay   : ${env.MIN_EMAIL_DELAY_MS}ms between sends (per sender)`);
  console.log(`  hourly limit: ${env.EMAILS_PER_HOUR} emails per sender`);
  console.log(line);

  for (const integration of describeIntegrations()) {
    const mark = integration.ok ? '✔' : '•';

    console.log(
      `  ${mark} ${integration.name.padEnd(16)} ${integration.status}`,
    );
  }

  console.log(line);
  console.log(`  API          http://localhost:${env.PORT}/api`);
  console.log(`  Health       http://localhost:${env.PORT}/api/health`);
  console.log(`  Bull Board   http://localhost:${env.PORT}/admin/queues`);
  console.log(`${line}\n`);
}

async function bootstrap(): Promise<void> {
  assertDevAuthBypassAllowed();

  printBanner();

  // ---------------------------------------------------------------------------
  // DATABASE PREFLIGHT
  // ---------------------------------------------------------------------------

  // Fail fast and loudly on the database.
  const database = await checkDatabase();

  if (!database.ok) {
    log.error('PostgreSQL is not reachable — cannot start', {
      error: database.error,
      hint: 'Is it running? docker compose up -d  (or check DATABASE_URL in backend/.env)',
    });

    process.exit(1);
  }

  log.info('PostgreSQL reachable', {
    latencyMs: database.latencyMs,
  });

  // ---------------------------------------------------------------------------
  // REDIS PREFLIGHT
  // ---------------------------------------------------------------------------

  // Redis being down is survivable for read endpoints, so warn instead of
  // exiting. Anything that needs the queue will return a clear 503.
  const redis = await checkRedis();

  if (redis.ok) {
    log.info('Redis reachable', {
      latencyMs: redis.latencyMs,
    });
  } else {
    log.warn(
      'Redis is NOT reachable — scheduling and sending will fail until it is up',
      {
        error: redis.error,
        hint: 'docker compose up -d redis',
      },
    );
  }

  // ---------------------------------------------------------------------------
  // SESSION REDIS
  // ---------------------------------------------------------------------------

  /**
   * connect-redis@9 expects the official `redis` package client.
   *
   * Our BullMQ/rate-limit code continues using ioredis separately.
   *
   * We connect the session client before createApp() so that
   * sessionMiddleware() can remain synchronous and Express-compatible.
   */
  if (redis.ok) {
    try {
      await connectSessionRedis();

      log.info('Session Redis connected');
    } catch (error) {
      log.error('Session Redis connection failed — cannot start', {
        error: error instanceof Error ? error.message : String(error),
      });

      process.exit(1);
    }
  }

  // ---------------------------------------------------------------------------
  // START API
  // ---------------------------------------------------------------------------

  const app = createApp();

  const server: Server = app.listen(
    env.PORT,
    '0.0.0.0',
    () => {
      log.info(`API listening on http://localhost:${env.PORT}`);
    },
  );

  // ---------------------------------------------------------------------------
  // GRACEFUL SHUTDOWN
  // ---------------------------------------------------------------------------

  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;

    shuttingDown = true;

    log.info(`${signal} received — shutting down gracefully`);

    // Stop accepting new connections, then wait for in-flight requests.
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    await Promise.allSettled([
      closeQueue(),
      disconnectRedis(),
      disconnectSessionRedis(),
      closeElasticsearch(),
      disconnectDatabase(),
    ]);

    log.info('Shutdown complete');

    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  // ---------------------------------------------------------------------------
  // PROCESS ERROR HANDLERS
  // ---------------------------------------------------------------------------

  // A crash should be loud and visible, not a silent process that stops working.
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', {
      reason: reason instanceof Error
        ? reason.message
        : String(reason),
    });
  });

  process.on('uncaughtException', (error) => {
    log.error('Uncaught exception — exiting', {
      message: error.message,
      stack: error.stack,
    });

    process.exit(1);
  });
}

void bootstrap();