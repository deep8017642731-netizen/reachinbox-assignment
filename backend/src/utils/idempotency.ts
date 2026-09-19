/**
 * Idempotency rules for email delivery.
 *
 * THE PROBLEM
 * A queue delivers "at least once". A job can therefore run more than once:
 * the worker may crash after sending but before recording SENT; a stalled job
 * can be recovered and retried by another worker; an operator may retry a job
 * manually from Bull Board. Any of these could send the same email twice.
 *
 * THE DEFENCE — two independent layers:
 *
 *  Layer 1 (Redis): the BullMQ job id is deterministic — `email:<emailId>`.
 *    BullMQ refuses to create a second job with an existing id, so the same
 *    email cannot be queued twice, even if the browser replays the HTTP request.
 *
 *  Layer 2 (PostgreSQL): before handing anything to SMTP the worker re-reads the
 *    row and asks this module whether delivery may proceed. The database is the
 *    single source of truth, and a status change is committed BEFORE a send is
 *    considered complete... except for the unavoidable window described below.
 *
 * THE HONEST LIMITATION
 * SMTP offers no transaction we can join. There is an irreducible window between
 * "SMTP accepted the message" and "we recorded SENT". If the process is killed
 * inside that window the row stays SCHEDULED/PROCESSING and a retry will send a
 * second copy. Closing that window needs either
 *   (a) an idempotency key honoured by the receiving mail server (rare), or
 *   (b) exactly-once queue semantics (which do not exist),
 * so real systems accept at-least-once plus a message-id-based dedupe on the
 * recipient side. We do the practical version: check-before-send, record
 * immediately after send, and document the residual risk instead of pretending
 * it is gone.
 */
import type { EmailStatus } from '../types';

export type DeliveryDecision =
  | { action: 'send' }
  | { action: 'skip'; reason: 'already-sent' | 'cancelled' | 'permanently-failed' };

/**
 * Pure function: given the current database status, may the worker send?
 *
 * Kept pure and free of I/O so it can be unit-tested exhaustively (see
 * tests/idempotency.test.ts) — the rule that protects against duplicate emails
 * should be trivially verifiable.
 */
export function decideDelivery(status: EmailStatus): DeliveryDecision {
  switch (status) {
    case 'SENT':
      return { action: 'skip', reason: 'already-sent' };
    case 'CANCELLED':
      return { action: 'skip', reason: 'cancelled' };
    case 'FAILED':
      // FAILED means "all BullMQ attempts were exhausted". Automatically
      // re-sending on a late/duplicate delivery of the same job would silently
      // resurrect an email the system already gave up on; a human decides.
      return { action: 'skip', reason: 'permanently-failed' };
    case 'SCHEDULED':
    case 'PROCESSING':
      // PROCESSING is re-sendable on purpose: it can only be observed when a
      // previous worker died mid-flight without reaching SMTP, and refusing to
      // retry would strand the email forever with no way to recover.
      return { action: 'send' };
    default: {
      // Exhaustiveness guard: if a new status is added to the enum, this line
      // stops compiling instead of silently falling through to a default.
      const exhaustive: never = status;
      throw new Error(`Unhandled email status: ${String(exhaustive)}`);
    }
  }
}

/** True when a status is final and should never be written to again. */
export function isTerminalStatus(status: EmailStatus): boolean {
  return status === 'SENT' || status === 'CANCELLED';
}
