/**
 * Email service — the business logic for scheduling, listing and cancelling.
 *
 * THE SCHEDULING FLOW (one recipient = one row = one job)
 *
 *   1. Verify the sender belongs to the caller        (authorisation)
 *   2. Normalise recipients: validate, lowercase, deduplicate
 *   3. Compute each recipient's own scheduledAt:
 *        scheduledAt(i) = effectiveStart + i * delayBetweenEmailsMs
 *   4. INSERT all rows in one statement               (PostgreSQL = truth)
 *   5. addBulk the delayed jobs, jobId = email:<id>   (Redis = timing)
 *   6. Return the ids so the UI can track the batch
 *
 * ORDERING: the deterministic stagger in step 3 is what makes ordering
 * predictable — recipient 0 is due 2s before recipient 1, and so on. It is
 * "reasonable ordering", not a strict global guarantee: once several jobs become
 * due at the same time, N workers process them concurrently. See README
 * "Ordering" for the exact guarantee this project makes.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { AppError } from '../middleware/error.middleware';
import { createLogger } from '../lib/logger';
import { enqueueEmailJobs, removeEmailJob } from '../queues/email.queue';
import { getSenderOrThrow } from './sender.service';
import { normaliseRecipients } from '../utils/email-parser';
import { indexEmailsSafely, searchEmails as searchEmailsInIndex } from './elasticsearch.service';
import type { EmailStatus } from '../types';

const log = createLogger('Email');

/* -------------------------------------------------------------------------- */
/*  Views                                                                     */
/* -------------------------------------------------------------------------- */

export interface EmailSenderSummary {
  id: string;
  email: string;
  displayName: string | null;
}

export interface EmailListItem {
  id: string;
  batchId: string;
  recipient: string;
  subject: string;
  /** First 160 characters, so a list response stays small. */
  bodyPreview: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  failedAt: string | null;
  errorMessage: string | null;
  attempts: number;
  sequence: number;
  sender: EmailSenderSummary;
  createdAt: string;
  /** Ethereal web-inbox link, when the message was delivered through Ethereal. */
  previewUrl: string | null;
}

export interface EmailDetail extends EmailListItem {
  body: string;
  messageId: string | null;
}

type EmailWithSender = {
  id: string;
  batchId: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: Date;
  sentAt: Date | null;
  failedAt: Date | null;
  errorMessage: string | null;
  attempts: number;
  sequence: number;
  messageId: string | null;
  previewUrl: string | null;
  createdAt: Date;
  sender: { id: string; email: string; displayName: string | null };
};

const BODY_PREVIEW_LENGTH = 160;

function toListItem(email: EmailWithSender): EmailListItem {
  return {
    id: email.id,
    batchId: email.batchId,
    recipient: email.recipient,
    subject: email.subject,
    bodyPreview:
      email.body.length > BODY_PREVIEW_LENGTH
        ? `${email.body.slice(0, BODY_PREVIEW_LENGTH)}…`
        : email.body,
    status: email.status,
    scheduledAt: email.scheduledAt.toISOString(),
    sentAt: email.sentAt?.toISOString() ?? null,
    failedAt: email.failedAt?.toISOString() ?? null,
    errorMessage: email.errorMessage,
    attempts: email.attempts,
    sequence: email.sequence,
    sender: {
      id: email.sender.id,
      email: email.sender.email,
      displayName: email.sender.displayName,
    },
    createdAt: email.createdAt.toISOString(),
    previewUrl: email.previewUrl,
  };
}

function toDetail(email: EmailWithSender): EmailDetail {
  return { ...toListItem(email), body: email.body, messageId: email.messageId };
}

/**
 * Prisma `include` used by every query that returns an email.
 * Typed with `satisfies` so a typo in the field name fails the build instead of
 * silently returning rows without their sender.
 */
const withSender = {
  sender: { select: { id: true, email: true, displayName: true } },
} satisfies Prisma.EmailInclude;

/* -------------------------------------------------------------------------- */
/*  Scheduling                                                                */
/* -------------------------------------------------------------------------- */

export interface ScheduleEmailsInput {
  userId: string;
  senderId: string;
  subject: string;
  body: string;
  recipients: string[];
  startTime: Date;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
}

export interface ScheduleEmailsResult {
  batchId: string;
  scheduledCount: number;
  emailIds: string[];
  /** Duplicate addresses silently collapsed into one email. */
  duplicatesRemoved: number;
  /** The delay actually applied — never below MIN_EMAIL_DELAY_MS. */
  appliedDelayMs: number;
  /** True when the requested startTime was in the past and was moved to now. */
  startTimeAdjusted: boolean;
  /** The first and last computed send times for this batch. */
  firstScheduledAt: string;
  lastScheduledAt: string;
}

export async function scheduleEmails(input: ScheduleEmailsInput): Promise<ScheduleEmailsResult> {
  const now = new Date();

  // (1) Authorisation: the sender must belong to the caller. Throws 404 otherwise.
  await getSenderOrThrow(input.userId, input.senderId);

  // (2) Validate + deduplicate. Invalid addresses are rejected outright rather
  //     than silently dropped: a typo in an API call should be visible, not
  //     turn into "I scheduled 5 emails" when only 4 were accepted.
  const parsed = normaliseRecipients(input.recipients);
  if (parsed.invalid.length > 0) {
    throw AppError.badRequest(
      `${parsed.invalid.length} recipient address(es) are not valid email addresses`,
      parsed.invalid.map((value) => ({ field: 'recipients', message: `Invalid email address: ${value}` })),
    );
  }
  if (parsed.valid.length === 0) {
    throw AppError.badRequest('No valid recipients were provided');
  }

  // (3) Configuration actually enforced (the request cannot go faster than the
  //     configured floor, no matter what it asks for).
  const appliedDelayMs = Math.max(input.delayBetweenEmailsMs, env.MIN_EMAIL_DELAY_MS);

  const requestedStartMs = input.startTime.getTime();
  const startTimeAdjusted = requestedStartMs < now.getTime();
  // A past start time means "start immediately" rather than an error: a demo
  // user pasting a stale timestamp should not have to redo the request.
  const effectiveStartMs = Math.max(requestedStartMs, now.getTime());

  const batchId = randomUUID();

  // (4) One INSERT for the whole batch. `createManyAndReturn` gives us the
  //     generated ids without a second round trip.
  const rows = await prisma.email.createManyAndReturn({
    data: parsed.valid.map((recipient, index) => ({
      userId: input.userId,
      senderId: input.senderId,
      batchId,
      recipient,
      subject: input.subject,
      body: input.body,
      status: 'SCHEDULED' as const,
      scheduledAt: new Date(effectiveStartMs + index * appliedDelayMs),
      sequence: index,
      delayBetweenEmailsMs: appliedDelayMs,
      hourlyLimit: input.hourlyLimit,
    })),
    select: { id: true, recipient: true, scheduledAt: true, sequence: true },
  });

  // (5) Queue the delayed jobs. BullMQ stores "run at T" in Redis; the row keeps
  //     the same instant in PostgreSQL, so both views of the schedule agree.
  let enqueuedCount: number;
  try {
    const result = await enqueueEmailJobs(
      rows.map((row) => ({
        emailId: row.id,
        senderId: input.senderId,
        delayMs: row.scheduledAt.getTime() - Date.now(),
      })),
    );
    enqueuedCount = result.enqueued;
  } catch (error) {
    // The rows exist but have no job: they would sit in SCHEDULED forever. Mark
    // them FAILED so the problem is visible in the UI instead of silent — a
    // stuck-but-invisible email is the worst possible failure mode.
    await prisma.email.updateMany({
      where: { batchId },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorMessage: 'Could not enqueue the scheduled job — is Redis running?',
      },
    });

    log.error('Enqueue failed; batch marked FAILED', {
      batchId,
      count: rows.length,
      error: error instanceof Error ? error.message : String(error),
    });

    throw new AppError(
      503,
      'Emails were saved but could not be queued. Check that Redis is running and retry.',
    );
  }

  const firstScheduledAt = rows[0]?.scheduledAt ?? new Date(effectiveStartMs);
  const lastScheduledAt = rows[rows.length - 1]?.scheduledAt ?? firstScheduledAt;

  log.info('Batch scheduled', {
    batchId,
    userId: input.userId,
    senderId: input.senderId,
    scheduledCount: rows.length,
    enqueuedCount,
    appliedDelayMs,
    firstScheduledAt: firstScheduledAt.toISOString(),
    lastScheduledAt: lastScheduledAt.toISOString(),
  });

  // Search index (best effort — never blocks scheduling; see elasticsearch.service).
  await indexEmailsSafely(
    await prisma.email.findMany({ where: { batchId }, include: withSender }),
  );

  return {
    batchId,
    scheduledCount: rows.length,
    emailIds: rows.map((row) => row.id),
    duplicatesRemoved: parsed.duplicatesRemoved,
    appliedDelayMs,
    startTimeAdjusted,
    firstScheduledAt: firstScheduledAt.toISOString(),
    lastScheduledAt: lastScheduledAt.toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/*  Listing                                                                   */
/* -------------------------------------------------------------------------- */

export interface PaginatedEmails {
  items: EmailListItem[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

async function listEmails(
  userId: string,
  statuses: EmailStatus[],
  page: number,
  limit: number,
): Promise<PaginatedEmails> {
  const where = { userId, status: { in: statuses } };

  const [total, rows] = await Promise.all([
    prisma.email.count({ where }),
    prisma.email.findMany({
      where,
      include: withSender,
      orderBy:
        statuses.includes('SCHEDULED')
          ? // Upcoming first for the scheduled tab.
            [{ scheduledAt: 'asc' as const }, { sequence: 'asc' as const }]
          : // Newest first for the sent tab. `nulls: 'last'` keeps SCHEDULED-time
            // rows from floating to the top when sentAt is empty (failures).
            [{ sentAt: { sort: 'desc' as const, nulls: 'last' as const } }, { updatedAt: 'desc' as const }],
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    items: rows.map((row) => toListItem(row)),
    meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/** Upcoming and in-flight emails: SCHEDULED + PROCESSING. */
export function listScheduledEmails(userId: string, page: number, limit: number) {
  return listEmails(userId, ['SCHEDULED', 'PROCESSING'], page, limit);
}

/**
 * Finished emails: SENT + FAILED.
 * Failures are listed here deliberately — a "sent" tab that hides errors is how
 * users end up believing mail was delivered when it was not.
 */
export function listSentEmails(userId: string, page: number, limit: number) {
  return listEmails(userId, ['SENT', 'FAILED'], page, limit);
}

export async function getEmailForUser(userId: string, emailId: string): Promise<EmailDetail> {
  const email = await prisma.email.findFirst({
    where: { id: emailId, userId },
    include: withSender,
  });
  if (!email) throw AppError.notFound('Email not found');
  return toDetail(email);
}

export interface EmailStats {
  scheduled: number;
  processing: number;
  sent: number;
  failed: number;
  cancelled: number;
  total: number;
}

/** Counts for the dashboard cards (one grouped query, not five). */
export async function getEmailStats(userId: string): Promise<EmailStats> {
  const grouped = await prisma.email.groupBy({
    by: ['status'],
    where: { userId },
    _count: { _all: true },
  });

  const stats: EmailStats = {
    scheduled: 0,
    processing: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
    total: 0,
  };

  for (const group of grouped) {
    const count = group._count._all;
    stats.total += count;
    switch (group.status) {
      case 'SCHEDULED':
        stats.scheduled += count;
        break;
      case 'PROCESSING':
        stats.processing += count;
        break;
      case 'SENT':
        stats.sent += count;
        break;
      case 'FAILED':
        stats.failed += count;
        break;
      case 'CANCELLED':
        stats.cancelled += count;
        break;
    }
  }

  return stats;
}

/* -------------------------------------------------------------------------- */
/*  Cancellation                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Cancels an email that has not been sent yet.
 *
 * Order of operations matters: we write CANCELLED to PostgreSQL FIRST, then try
 * to remove the Redis job. If both succeed, nothing is sent. If the job removal
 * fails (e.g. the worker just picked it up), the database already says CANCELLED
 * and the worker's idempotency check refuses to send — the database is the
 * authority, so a lost race cannot produce an unwanted email.
 */
export async function cancelEmail(userId: string, emailId: string): Promise<EmailListItem> {
  const email = await prisma.email.findFirst({ where: { id: emailId, userId }, include: withSender });
  if (!email) throw AppError.notFound('Email not found');

  if (email.status === 'SENT') throw AppError.conflict('This email has already been sent');
  if (email.status === 'CANCELLED') throw AppError.conflict('This email is already cancelled');
  if (email.status === 'FAILED') throw AppError.conflict('This email already failed and cannot be cancelled');
  if (email.status === 'PROCESSING') {
    throw AppError.conflict('This email is being sent right now and can no longer be cancelled');
  }

  const updated = await prisma.email.update({
    where: { id: emailId },
    data: { status: 'CANCELLED' },
    include: withSender,
  });

  const removed = await removeEmailJob(emailId);
  log.info('Email cancelled', { emailId, jobRemoved: removed });

  await indexEmailsSafely([updated]);
  return toListItem(updated);
}

/* -------------------------------------------------------------------------- */
/*  Search (Elasticsearch + PostgreSQL hydration)                             */
/* -------------------------------------------------------------------------- */

/**
 * Full-text search across the caller's own emails.
 *
 * TWO-STEP READ, ON PURPOSE:
 *   1. Elasticsearch decides WHICH emails match (relevance, fuzziness, ranking).
 *   2. PostgreSQL supplies the actual row for each match.
 *
 * Step 2 is what makes the results trustworthy: if an email was indexed as
 * SCHEDULED and has since been sent, you see SENT — the index is never allowed to
 * be the source of truth. Re-reading also re-applies the `userId` filter, so even
 * a corrupted or stale index cannot leak another user's email into the response.
 */
export async function searchUserEmails(
  userId: string,
  query: string,
  page: number,
  limit: number,
): Promise<PaginatedEmails> {
  let result: { hits: Array<{ emailId: string; score: number | null }>; total: number };

  try {
    result = await searchEmailsInIndex(userId, query, page, limit);
  } catch (error) {
    log.error('Search failed', {
      error: error instanceof Error ? error.message : String(error),
      query,
    });
    throw new AppError(
      503,
      'Search is temporarily unavailable (Elasticsearch unreachable). Scheduling and sending are unaffected.',
    );
  }

  const meta = {
    page,
    limit,
    total: result.total,
    totalPages: Math.max(1, Math.ceil(result.total / limit)),
  };

  if (result.hits.length === 0) return { items: [], meta };

  const ids = result.hits.map((hit) => hit.emailId);
  const rows = await prisma.email.findMany({
    where: { id: { in: ids }, userId }, // second, independent ownership check
    include: withSender,
  });

  // Restore Elasticsearch's relevance order (a SQL `IN` clause has no order).
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items = ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [toListItem(row)] : [];
  });

  return { items, meta };
}
