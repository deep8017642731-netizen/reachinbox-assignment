/**
 * Shared type contracts.
 *
 * These types are deliberately framework-agnostic: they describe the *shape* of
 * data as it crosses boundaries (HTTP request/response, BullMQ job payloads,
 * session contents). They keep controllers, services and the worker honest
 * without leaking Prisma- or Express-specific types into every layer.
 *
 * Why not use Prisma's generated types everywhere?
 *  - Prisma types describe database rows (including internal columns).
 *  - These types describe the public contract we are willing to promise: what a
 *    job payload looks like, what the API returns, what the session holds.
 *  Keeping them separate lets us change the database without silently changing
 *  the API (and vice versa).
 */

/* -------------------------------------------------------------------------- */
/*  Email status                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Lifecycle of a single email.
 *
 * This is the *source of truth mirrored* by the Prisma enum `EmailStatus` in
 * `prisma/schema.prisma`. A compile-time assertion in
 * `src/lib/prisma-status-check.ts` guarantees the two can never drift apart.
 *
 * SCHEDULED  -> row created + delayed BullMQ job enqueued, nothing sent yet
 * PROCESSING -> a worker has picked the job up and is about to send
 * SENT       -> SMTP accepted the message (terminal, success)
 * FAILED     -> delivery failed after all BullMQ retries were exhausted
 * CANCELLED  -> user cancelled before delivery (terminal)
 */
export const EMAIL_STATUSES = [
  'SCHEDULED',
  'PROCESSING',
  'SENT',
  'FAILED',
  'CANCELLED',
] as const;

export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** Statuses that mean "this email is finished, never touch it again". */
export const TERMINAL_EMAIL_STATUSES = ['SENT', 'CANCELLED'] as const;

export type TerminalEmailStatus = (typeof TERMINAL_EMAIL_STATUSES)[number];

/* -------------------------------------------------------------------------- */
/*  BullMQ job contract                                                       */
/* -------------------------------------------------------------------------- */

/** Queue name. Kept in one place so API, worker and Bull Board agree. */
export const EMAIL_QUEUE_NAME = 'email-queue';

/** Job name inside the queue. */
export const EMAIL_JOB_NAME = 'send-email';

/**
 * The ONLY thing we put inside a Redis job: the primary key.
 *
 * Everything else (subject, body, recipient, status…) stays in PostgreSQL so
 * there is exactly one source of truth for business state. Redis stores *when*
 * to run a job, PostgreSQL stores *what* the job means.
 */
export interface EmailJobData {
  /** `Email.id` in PostgreSQL. */
  emailId: string;
  /** `Email.senderId` — duplicated so the worker can rate-limit before querying. */
  senderId: string;
}

/**
 * Deterministic BullMQ job id for an email.
 *
 * WHY A DASH AND NOT A COLON
 * The assignment brief suggests `email:<emailId>`, which is not possible: BullMQ
 * composes its Redis keys by joining parts with `:`, so a custom job id containing
 * a colon is rejected outright with "Custom Id cannot contain :". Using `email-`
 * keeps the id readable, globally unique (the email UUID is unique) and valid.
 *
 * Deterministic ids are the first line of defence against duplicate sends: BullMQ
 * refuses to create a second job with an id that already exists, so a retried
 * enqueue (e.g. a replayed HTTP request) cannot create a duplicate send. The
 * database status check is the second line of defence.
 */
export function buildEmailJobId(emailId: string): string {
  if (emailId.includes(':')) {
    // Fail here, with a clear message, rather than deep inside BullMQ.
    throw new Error(`Email id must not contain ':' (received: ${emailId})`);
  }
  return `email-${emailId}`;
}

/* -------------------------------------------------------------------------- */
/*  API envelope                                                              */
/* -------------------------------------------------------------------------- */

/** Every error response from the API looks exactly like this. */
export interface ApiErrorBody {
  success: false;
  message: string;
  /** Field-level details, present for validation failures (HTTP 400). */
  details?: ApiErrorDetail[];
}

export interface ApiErrorDetail {
  /** Dotted path of the offending field, e.g. `recipients.1`. */
  field: string;
  message: string;
}

/* -------------------------------------------------------------------------- */
/*  Pagination                                                                */
/* -------------------------------------------------------------------------- */

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

/* -------------------------------------------------------------------------- */
/*  Authentication / session                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What we keep in the server-side session. Note what is NOT here: no access
 * tokens, no refresh tokens, no Slack tokens. Sessions identify a user; long
 * lived third-party credentials stay in the database and never reach the browser.
 */
export interface SessionUser {
  id: string;
  googleId: string;
  name: string;
  email: string;
  avatar: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Structured logging                                                        */
/* -------------------------------------------------------------------------- */

export interface LogFields {
  [key: string]: unknown;
}
