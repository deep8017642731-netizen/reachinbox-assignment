/**
 * Redis connections.
 *
 * We use TWO DIFFERENT connection strategies on purpose:
 *
 * 1. `getRedis()` — one shared client for our own commands (rate-limit counters,
 *    delay gates, notification dedupe keys). It fails fast if Redis is down,
 *    because our API should return a clear error rather than hang forever.
 *
 * 2. `bullConnection` — plain connection *options* handed to BullMQ. BullMQ
 *    creates (and owns) its own connections, because a Worker needs at least one
 *    dedicated blocking connection for `BRPOPLPUSH`-style commands. A blocking
 *    connection that is also used for normal commands would stall the app, so
 *    BullMQ manages them; we must not share our client with it.
 *
 * The `maxRetriesPerRequest: null` setting is REQUIRED by BullMQ on the
 * connections it uses. With a non-null value, ioredis throws after N failed
 * retries, and a Worker that throws mid-block can end up in a broken state.
 */
import Redis, { type RedisOptions } from 'ioredis';
// BullMQ declares its own (slightly different) RedisOptions. Using the ioredis
// type here fails to compile because ioredis allows `retryStrategy: null`,
// which BullMQ's type does not accept.
import type { RedisOptions as BullRedisOptions } from 'bullmq';
import { env } from '../config/env';
import { createLogger } from './logger';

const log = createLogger('Redis');

/** Options for BullMQ-controlled connections (Queue and Worker). */
export const bullConnection: BullRedisOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  // Required by BullMQ: never give up retrying a blocking command.
  maxRetriesPerRequest: null,
  // BullMQ recommends skipping the ready check to avoid a slow first connect.
  enableReadyCheck: false,
};

/** Options for the application's own commands. */
function appRedisOptions(): RedisOptions {
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD,
    // Our commands should fail with an error instead of retrying indefinitely.
    maxRetriesPerRequest: 3,
    // Reconnect with a small backoff if Redis restarts under us.
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
  };
}

const globalForRedis = globalThis as unknown as { appRedisClient?: Redis };

/**
 * Lazily-created shared client. Lazy (not created at import time) so that unit
 * tests importing a service module do not open a socket to Redis.
 */
export function getRedis(): Redis {
  if (!globalForRedis.appRedisClient) {
    const client = new Redis(appRedisOptions());

    client.on('error', (error: Error) => {
      log.error('Connection error', { message: error.message });
    });
    client.on('connect', () => log.info('Connected', { host: env.REDIS_HOST, port: env.REDIS_PORT }));
    client.on('reconnecting', () => log.warn('Reconnecting'));

    // Keep the handle off globalThis in production, where hot reload never happens.
    if (env.NODE_ENV !== 'production') {
      globalForRedis.appRedisClient = client;
    }
    return client;
  }
  return globalForRedis.appRedisClient;
}

export interface RedisHealth {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

export async function checkRedis(): Promise<RedisHealth> {
  const startedAt = Date.now();
  try {
    const pong = await getRedis().ping();
    return { ok: pong === 'PONG', latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message.split('\n')[0] : 'unknown error',
    };
  }
}

export async function disconnectRedis(): Promise<void> {
  const client = globalForRedis.appRedisClient;
  if (!client) return;
  // `quit` sends QUIT and waits for a clean close; `disconnect` would cut the
  // socket and can lose the last commands in flight.
  await client.quit().catch(() => client.disconnect());
  globalForRedis.appRedisClient = undefined;
  log.info('Disconnected');
}
