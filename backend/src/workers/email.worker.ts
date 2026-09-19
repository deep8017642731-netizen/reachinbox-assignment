/**
 * BullMQ worker — the process that actually sends emails.
 *
 * WHY A SEPARATE PROCESS INSTEAD OF SENDING INSIDE THE EXPRESS HANDLER?
 *   1. A request must return in milliseconds; an SMTP conversation takes seconds.
 *   2. HTTP request lifecycles are not durable — if the server restarts, anything
 *      mid-flight is lost. A queued job survives independently of any HTTP request.
 *   3. Concurrency is a worker setting, not something you can tune on a web server
 *      without also affecting request handling.
 *   4. Workers scale horizontally: run ten copies of this file and Redis hands
 *      each one work with no coordination code.
 *
 * THE PROCESSING PIPELINE (per job), in deliberate order:
 *
 *   fetch row ──► idempotency gate ──► minimum-delay gate ──► rate-limit reserve
 *        │               │                    │                      │
 *        │        skip if SENT/          if too soon:           if over limit:
 *        │        CANCELLED/FAILED       reschedule             notify Slack +
 *        │                                   │                  reschedule
 *        └───────────────────────────────────┴──────────────────────┐
 *                                                                    ▼
 *                                       mark PROCESSING ──► SMTP send ──► mark SENT
 *                                                                    └──► index in ES
 *
 * WHY THAT ORDER:
 *  - Idempotency first: never spend quota or a send slot on an email that is
 *    already done. Cheapest check, strongest guarantee.
 *  - Delay gate before rate limit: the gate is cheap and reversible (a few ms of
 *    pacing). Reserving rate-limit quota and then waiting would waste quota.
 *  - Reserving quota immediately before sending minimises the window in which a
 *    reservation exists for an email that never goes out.
 */
import { DelayedError, UnrecoverableError, Worker, type Job } from 'bullmq';
import { bullConnection } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { createLogger } from '../lib/logger';
import { EMAIL_QUEUE_NAME, type EmailJobData } from '../types';
import { decideDelivery } from '../utils/idempotency';
import { acquireSendSlot, effectiveDelayMs } from '../services/delay.service';
import { reserveEmailSend } from '../services/rate-limit.service';
import { sendEmail } from '../services/smtp.service';
import { indexEmailsSafely } from '../services/elasticsearch.service';
import { notifySenderRateLimitReached } from '../services/slack.service';
import { closeQueue, getQueueCounts } from '../queues/email.queue';

const log = createLogger('Worker');

/* -------------------------------------------------------------------------- */
/*  Result of one processing run (visible in Bull Board's job data)            */
/* -------------------------------------------------------------------------- */

export type ProcessResult =
  | { outcome: 'sent'; messageId: string; previewUrl: string | null }
  | { outcome: 'skipped'; reason: string }
  | { outcome: 'deferred'; reason: 'minimum-delay' | 'rate-limit'; waitMs: number };

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic spread so a whole hour's worth of blocked emails does not all wake
 * at the same millisecond when the next window opens ("thundering herd").
 *
 * `sequence` (the recipient's position in its batch) is used rather than a random
 * number, so the relative order of a batch is preserved: recipient 0 wakes 0s
 * after the window opens, recipient 1 wakes 1s after, and so on up to 59s before
 * the pattern repeats. Order is respected, and the burst is flattened.
 */
export function rateLimitSpreadMs(sequence: number): number {
  return (sequence % 60) * 1000;
}

/**
 * Distinguishes "try again later" from "this will never work".
 *
 * Retrying a permanently-bad recipient three times wastes SMTP connections and
 * delays the FAILED status the user needs to see. BullMQ's UnrecoverableError
 * skips the remaining attempts immediately.
 */
export function isPermanentSmtpError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // 5xx from the SMTP server: mailbox unavailable, message refused, etc.
  const responseCode = (error as { responseCode?: number }).responseCode;
  if (typeof responseCode === 'number' && responseCode >= 500 && responseCode < 600) return true;

  // Nodemailer error codes: EENVELOPE (bad from/to), EAUTH (credentials wrong),
  // EACCES (relay denied). None of these fix themselves in 20 seconds.
  const code = (error as { code?: string }).code;
  return code === 'EENVELOPE' || code === 'EAUTH' || code === 'EACCES';
}

/** Puts this job back in the delayed set and tells BullMQ we did it on purpose. */
async function deferJob(job: Job<EmailJobData>, waitMs: number): Promise<never> {
  await job.moveToDelayed(Date.now() + Math.max(0, Math.floor(waitMs)), job.token);
  // DelayedError is BullMQ's signal for "I moved this job myself"; without it the
  // worker would treat the returned value as a completed job.
  throw new DelayedError();
}

/* -------------------------------------------------------------------------- */
/*  The processor                                                             */
/* -------------------------------------------------------------------------- */

export async function processEmail(job: Job<EmailJobData>): Promise<ProcessResult> {
  const { emailId } = job.data;
  const attemptNumber = job.attemptsMade + 1;
  const maxAttempts = job.opts.attempts ?? 1;

  // ---- 1. Load business state from PostgreSQL (the source of truth) --------
  const email = await prisma.email.findUnique({
    where: { id: emailId },
    include: { sender: true },
  });

  if (!email) {
    // The row was deleted after the job was queued. Completing the job is correct:
    // retrying can never succeed, and failing it would pollute the failed set.
    log.warn('Job references an email that no longer exists — completing', { emailId });
    return { outcome: 'skipped', reason: 'email-not-found' };
  }

  // ---- 2. Idempotency gate -------------------------------------------------
  const decision = decideDelivery(email.status);
  if (decision.action === 'skip') {
    log.info('Skipping send — email is already in a final state', {
      emailId,
      status: email.status,
      reason: decision.reason,
    });
    return { outcome: 'skipped', reason: decision.reason };
  }

  // ---- 3. Minimum delay between sends (Redis-coordinated, per sender) ------
  const gapMs = effectiveDelayMs(email.delayBetweenEmailsMs, env.MIN_EMAIL_DELAY_MS);
  const waitMs = await acquireSendSlot(email.senderId, gapMs);

  if (waitMs > 0) {
    log.info('Minimum delay not elapsed — rescheduling', {
      emailId,
      senderId: email.senderId,
      waitMs,
      gapMs,
    });
    return deferJob(job, waitMs);
  }

  // ---- 4. Hourly rate limit (atomic Redis reservation) ---------------------
  const reservation = await reserveEmailSend(email.senderId, email.hourlyLimit);

  if (!reservation.allowed) {
    // Respect the limit WITHOUT losing the email: delay it into the next window.
    const spreadMs = rateLimitSpreadMs(email.sequence);
    const delayMs = (reservation.retryInMs ?? 0) + spreadMs;

    log.warn('Hourly limit reached — rescheduling into the next window', {
      emailId,
      senderId: email.senderId,
      used: reservation.used,
      limit: reservation.limit,
      window: reservation.window.label,
      resumeAt: new Date(Date.now() + delayMs).toISOString(),
      spreadMs,
    });

    // Exactly one worker per sender per window reaches Slack (Redis NX claim).
    await notifySenderRateLimitReached({
      userId: email.userId,
      senderId: email.senderId,
      senderEmail: email.sender.email,
      limit: reservation.limit,
      used: reservation.used,
      window: reservation.window,
      blockedRecipient: email.recipient,
    });

    return deferJob(job, delayMs);
  }

  // ---- 5. Mark PROCESSING and count the attempt ---------------------------
  // Written before the SMTP call so a crash mid-send leaves a visible PROCESSING
  // row rather than a row that looks untouched.
  await prisma.email.update({
    where: { id: emailId },
    data: { status: 'PROCESSING', attempts: { increment: 1 } },
  });

  // ---- 6. Send ------------------------------------------------------------
  try {
    log.info('Sending email', {
      emailId,
      recipient: email.recipient,
      attempt: attemptNumber,
      maxAttempts,
    });

    const result = await sendEmail({
      to: email.recipient,
      subject: email.subject,
      body: email.body,
      from: email.sender.displayName
        ? `${email.sender.displayName} <${email.sender.email}>`
        : email.sender.email,
    });

    // SMTP "accepted" the message but rejected every recipient: a hard failure
    // that no amount of retrying will fix.
    if (result.accepted.length === 0 && result.rejected.length > 0) {
      throw new UnrecoverableError(
        `SMTP rejected the recipient: ${result.rejected.join(', ')}`,
      );
    }

    // ---- 7. Commit success -------------------------------------------------
    const sentAt = new Date();
    await prisma.email.update({
      where: { id: emailId },
      data: {
        status: 'SENT',
        sentAt,
        messageId: result.messageId,
        previewUrl: result.previewUrl,
        errorMessage: null,
      },
    });

    log.info('Email sent', {
      emailId,
      recipient: email.recipient,
      messageId: result.messageId,
      previewUrl: result.previewUrl,
      sentAt: sentAt.toISOString(),
    });

    // ---- 8. Update the search index (best effort — never blocks sending) ---
    await indexEmailsSafely([
      {
        ...email,
        status: 'SENT',
        sentAt,
      },
    ]);

    return { outcome: 'sent', messageId: result.messageId, previewUrl: result.previewUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const permanent = error instanceof UnrecoverableError || isPermanentSmtpError(error);

    if (permanent || attemptNumber >= maxAttempts) {
      // Terminal: record the failure so it is visible in the API and the UI.
      const failedAt = new Date();
      await prisma.email.update({
        where: { id: emailId },
        data: { status: 'FAILED', failedAt, errorMessage: message.slice(0, 1000) },
      });

      log.error('Email failed permanently', {
        emailId,
        recipient: email.recipient,
        attempt: attemptNumber,
        maxAttempts,
        permanent,
        error: message,
      });

      await indexEmailsSafely([{ ...email, status: 'FAILED', sentAt: null }]);

      // Still throw so BullMQ records it in the failed set (visible in Bull Board).
      throw error;
    }

    // Transient: let BullMQ retry with exponential backoff. The row stays
    // PROCESSING, and the retry re-runs the idempotency + rate-limit checks.
    log.warn('Send attempt failed — BullMQ will retry with backoff', {
      emailId,
      attempt: attemptNumber,
      maxAttempts,
      error: message,
    });
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/*  Worker construction                                                       */
/* -------------------------------------------------------------------------- */

export function createEmailWorker(): Worker<EmailJobData, ProcessResult> {
  const worker = new Worker<EmailJobData, ProcessResult>(EMAIL_QUEUE_NAME, processEmail, {
    connection: bullConnection,
    // From WORKER_CONCURRENCY — how many jobs this process handles simultaneously.
    concurrency: env.WORKER_CONCURRENCY,
    // Wait up to 5s for a job before polling again: fewer round trips when idle.
    drainDelay: 5,
    // If this process dies mid-job, another worker recovers it after this long.
    lockDuration: 30_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  });

  worker.on('completed', (job, result: ProcessResult) => {
    log.debug('Job completed', { jobId: job.id, outcome: result?.outcome });
  });

  worker.on('failed', (job, error) => {
    log.error('Job failed', {
      jobId: job?.id,
      emailId: job?.data?.emailId,
      attemptsMade: job?.attemptsMade,
      error: error.message,
    });
  });

  worker.on('error', (error) => {
    // Connection-level problems (Redis restarting, etc.). BullMQ retries by itself.
    log.error('Worker error', { error: error.message });
  });

  worker.on('stalled', (jobId) => {
    log.warn('Job stalled and was returned to the queue', { jobId });
  });

  return worker;
}

/* -------------------------------------------------------------------------- */
/*  Standalone entry point                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Only runs when this file is executed directly (`npm run worker:dev`), so tests
 * can import `processEmail` without starting a worker.
 */
async function main(): Promise<void> {
  log.info('Worker starting', {
    concurrency: env.WORKER_CONCURRENCY,
    queue: EMAIL_QUEUE_NAME,
    redis: `${env.REDIS_HOST}:${env.REDIS_PORT}`,
  });
  // Printed explicitly because the README and the demo script quote these values.
  log.info(`Minimum delay between sends: ${env.MIN_EMAIL_DELAY_MS}ms (per sender)`);
  log.info(`Default hourly limit per sender: ${env.EMAILS_PER_HOUR} emails`);

  const worker = createEmailWorker();

  // Report the queue state at startup. During the restart demo this line is the
  // proof that the delayed jobs were waiting in Redis all along: they were never
  // held in this process's memory.
  try {
    log.info('Queue state at startup', await getQueueCounts());
  } catch (error) {
    log.warn('Could not read queue counts at startup', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`${signal} received — finishing active jobs before exit`);
    // close() waits for in-flight jobs to finish, then releases locks. Jobs that
    // are waiting or delayed stay safely in Redis for the next start.
    await worker.close();
    await closeQueue();
    await prisma.$disconnect();
    log.info('Worker stopped cleanly');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

// `require.main === module` is the CommonJS way to detect "run directly".
if (require.main === module) {
  main().catch((error: unknown) => {
    log.error('Worker crashed during startup', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}
