/**
 * The single PrismaClient instance for the whole process.
 *
 * WHY A SINGLETON?
 * PrismaClient manages a connection pool. Creating one per request (or per
 * imported module) opens a new pool each time and quickly exhausts PostgreSQL's
 * connection limit — a classic beginner bug that only shows up under load.
 *
 * WHY THE `globalThis` CACHE?
 * `tsx watch` reloads modules on every file save. Without caching on
 * globalThis, each reload would create another client and leave the old pool
 * open, leaking connections while you develop.
 */
import { PrismaClient } from '@prisma/client';
import { env, isProduction } from '../config/env';
import { createLogger } from './logger';

const log = createLogger('Prisma');

const globalForPrisma = globalThis as unknown as { prismaClient?: PrismaClient };

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

  // Surface database-level problems through our structured logger (the default
  // Prisma output is unstructured and hard to grep during a demo).
  client.$on('error', (event) => {
    log.error('Database error', { message: event.message });
  });
  client.$on('warn', (event) => {
    log.warn('Database warning', { message: event.message });
  });

  return client;
}

export const prisma: PrismaClient = globalForPrisma.prismaClient ?? createPrismaClient();

if (!isProduction) {
  globalForPrisma.prismaClient = prisma;
}

/* -------------------------------------------------------------------------- */
/*  Health + lifecycle                                                        */
/* -------------------------------------------------------------------------- */

export interface DatabaseHealth {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/** Cheap liveness probe for GET /api/health — one round trip, no table scans. */
export async function checkDatabase(): Promise<DatabaseHealth> {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message.split('\n')[0] : 'unknown error',
    };
  }
}

/** Called from graceful shutdown so in-flight queries can finish. */
export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  log.info('Disconnected');
}

// Referenced by the integration-status banner so unused-import linting stays happy
// while keeping the module's configuration discoverable in one place.
export const databaseUrlConfigured = Boolean(env.DATABASE_URL);
