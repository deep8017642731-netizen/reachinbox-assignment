/**
 * The BullMQ queue: how emails get scheduled.
 *
 * WHAT BULLMQ ACTUALLY IS
 * A job queue library backed by Redis. You hand it a job ("send email X") and
 * optionally a delay ("in 120 seconds"). Redis persists both. A separate worker
 * process asks Redis for work and executes it.
 *
 * WHY THIS REPLACES A CRON JOB
 * A cron approach is "wake up every minute and ask the database what is due".
 * That is a polling loop: it wastes queries when nothing is due, and its accuracy
 * is limited by the polling interval — an email scheduled for 15:00:05 either
 * goes at 15:01 (late) or requires a faster loop (more waste). BullMQ delayed
 * jobs are event-driven: Redis itself knows when the delay expires and notifies a
 * worker. No polling, second-level accuracy, and jobs survive a restart because
 * they are stored in Redis rather than in Node's memory.
 *
 * WHY THE JOB PAYLOAD IS ONLY IDS
 * The payload is `{ emailId, senderId }` — never the subject or body. Business
 * state belongs in PostgreSQL; Redis holds only *when* to work. If a job payload
 * carried the message body, a worker running after a restart could send stale
 * content that disagrees with the database.
 */
import { Queue, type JobsOptions } from 'bullmq';
import { bullConnection } from '../lib/redis';
import { EMAIL_JOB_NAME, EMAIL_QUEUE_NAME, buildEmailJobId, type EmailJobData } from '../types';
import { createLogger } from '../lib/logger';

const log = createLogger('Queue');

/**
 * Retry policy.
 *  - 3 attempts with exponential backoff (5s, 10s, 20s) rides out transient
 *    SMTP/network blips without hammering a struggling server.
 *  - Duplicate sends are prevented by the DB status check, not by hoping the
 *    first attempt succeeded (see utils/idempotency.ts).
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  // Keep recent completed jobs so Bull Board can show the demo evidence...
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  // ...and keep failures longer, because they are the ones worth investigating.
  removeOnFail: { count: 5_000 },
};

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE_NAME, {
  connection: bullConnection,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

emailQueue.on('error', (error: Error) => {
  log.error('Queue error', { message: error.message });
});

export interface EnqueueItem {
  emailId: string;
  senderId: string;
  /** Milliseconds from now until this job should run. */
  delayMs: number;
}

export interface EnqueueResult {
  enqueued: number;
  duplicateSkipped: number;
}

/**
 * Adds many delayed jobs in ONE Redis round trip.
 *
 * addBulk matters for the 1000-email scenario: 1000 individual `add` calls mean
 * 1000 network round trips (seconds of latency and a partially-scheduled batch if
 * it fails halfway). One bulk call makes the whole batch visible to workers at
 * essentially the same instant.
 *
 * A duplicate `jobId` is never replaced, so re-enqueuing an email that already
 * has a job is a no-op — the Redis-side half of the duplicate-send defence.
 */
export async function enqueueEmailJobs(items: EnqueueItem[]): Promise<EnqueueResult> {
  if (items.length === 0) return { enqueued: 0, duplicateSkipped: 0 };

  // `Parameters<typeof emailQueue.addBulk>[0][number]` asks BullMQ itself what a
  // bulk job looks like, so this type can never drift from the library's.
  type BulkJob = Parameters<typeof emailQueue.addBulk>[0][number];

  const jobs: BulkJob[] = items.map((item) => ({
    name: EMAIL_JOB_NAME,
    data: { emailId: item.emailId, senderId: item.senderId } satisfies EmailJobData,
    opts: {
      delay: Math.max(0, Math.floor(item.delayMs)),
      jobId: buildEmailJobId(item.emailId),
    },
  }));

  const created = await emailQueue.addBulk(jobs);

  log.info('Jobs enqueued', {
    requested: items.length,
    created: created.length,
    firstDelayMs: items[0]?.delayMs,
    lastDelayMs: items[items.length - 1]?.delayMs,
  });

  return { enqueued: created.length, duplicateSkipped: items.length - created.length };
}

/** Removes a scheduled job (used by cancellation). */
export async function removeEmailJob(emailId: string): Promise<boolean> {
  const job = await emailQueue.getJob(buildEmailJobId(emailId));
  if (!job) return false;
  await job.remove();
  return true;
}

/** Counts per state, for GET /api/health and the dashboard header. */
export async function getQueueCounts(): Promise<Record<string, number>> {
  // NOTE: BullMQ 6 accepts JobState values — there is no 'paused' job state
  // (pausing is a queue-level property, not a job state).
  const counts = await emailQueue.getJobCounts(
    'waiting',
    'active',
    'delayed',
    'completed',
    'failed',
  );
  return counts as Record<string, number>;
}

/** Position of an email's job in the queue (0 = next), for the UI. */
export async function getJobState(emailId: string): Promise<string | null> {
  const job = await emailQueue.getJob(buildEmailJobId(emailId));
  if (!job) return null;
  return job.getState();
}

/** Called from graceful shutdown. */
export async function closeQueue(): Promise<void> {
  await emailQueue.close();
  log.info('Queue closed');
}
