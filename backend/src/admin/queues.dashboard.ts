/**
 * Bull Board — the real BullMQ queue dashboard, mounted at /admin/queues.
 *
 * WHAT IT SHOWS: live counts and the actual jobs in every state — waiting, active,
 * delayed, completed and failed — plus each job's payload, attempts, timestamps and
 * stack trace. It reads the queue directly from Redis, so it is the same data the
 * worker sees; nothing here is synthesised for the UI.
 *
 * WHY IT IS ALSO A DEMO TOOL: during the restart demonstration you can watch the
 * "Delayed" count stay at 2 while the API is stopped, then fall to 0 once the
 * worker starts again. That is the persistence claim, visible on screen.
 *
 * SECURITY MODEL (documented in the README):
 *   - The route is ALWAYS behind requireAuth (no anonymous access).
 *   - It is also behind requireAdmin, which allows access in development when
 *     ADMIN_EMAILS is empty, and DENIES everyone in production unless their email
 *     is explicitly listed. Job payloads are sensitive (recipient addresses), so an
 *     accidentally public dashboard would be a data leak.
 */
import type { RequestHandler } from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { emailQueue } from '../queues/email.queue';
import { createLogger } from '../lib/logger';

const log = createLogger('BullBoard');

export const BULL_BOARD_PATH = '/admin/queues';

/**
 * Builds the dashboard router.
 *
 * `setBasePath` must be called BEFORE registering the queues so the UI's asset and
 * API links are generated with the right prefix; getting this wrong produces a
 * dashboard that loads but renders an empty table.
 */
export function createQueueDashboardRouter(): RequestHandler {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);

  createBullBoard({
    queues: [new BullMQAdapter(emailQueue)],
    serverAdapter,
  });

  log.info('Queue dashboard mounted', { path: BULL_BOARD_PATH, queue: emailQueue.name });

  // getRouter() is typed as `any` by the library; narrowing it here keeps the rest
  // of the codebase free of `any`.
  return serverAdapter.getRouter() as RequestHandler;
}
