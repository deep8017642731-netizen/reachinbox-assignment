/**
 * Request validation schemas (Zod).
 *
 * These are the API's front door: nothing reaches a service or the database
 * without passing through here first. Two benefits beyond "cleaner code":
 *   - Attack surface: only well-formed, size-limited data is ever persisted.
 *   - Error quality: failures produce field-level messages the React form shows
 *     next to the offending input.
 *
 * Note on email validation: we reuse `isValidEmail` from utils/email-parser
 * rather than Zod's built-in `.email()`. Having ONE definition of "valid email"
 * means the frontend parser and the backend acceptance rule can never disagree —
 * an address the UI accepts is always an address the API accepts.
 */
import { z } from 'zod';
import { isValidEmail } from '../utils/email-parser';
import { env } from '../config/env';

/* -------------------------------------------------------------------------- */
/*  Reusable primitives                                                       */
/* -------------------------------------------------------------------------- */

export const emailAddressSchema = z
  .string()
  .trim()
  .min(6, 'Email address is too short')
  .max(254, 'Email address is too long')
  .refine(isValidEmail, { message: 'Not a valid email address' });

export const uuidSchema = z.uuid('Expected a UUID');

/* -------------------------------------------------------------------------- */
/*  POST /api/emails/schedule                                                 */
/* -------------------------------------------------------------------------- */

export const scheduleEmailSchema = z.object({
  senderId: uuidSchema,

  subject: z
    .string()
    .trim()
    .min(1, 'Subject is required')
    .max(500, 'Subject must be 500 characters or fewer'),

  body: z
    .string()
    .trim()
    .min(1, 'Body is required')
    .max(50_000, 'Body must be 50,000 characters or fewer'),

  recipients: z
    .array(emailAddressSchema)
    .min(1, 'At least one recipient is required')
    .max(1000, 'At most 1000 recipients per request — split larger lists into batches'),

  /**
   * ISO-8601 timestamp. `offset: true` accepts both `...Z` and `+05:30`, which
   * matters because the browser may send either.
   */
  startTime: z.iso.datetime({ offset: true, message: 'startTime must be an ISO-8601 date-time' }),

  /**
   * Gap between consecutive sends for THIS sender. A value below
   * MIN_EMAIL_DELAY_MS is not rejected — it is raised to the configured floor,
   * and the response reports the value actually applied.
   */
  delayBetweenEmailsMs: z.coerce
    .number()
    .int('Delay must be a whole number of milliseconds')
    .min(0, 'Delay cannot be negative')
    .max(3_600_000, 'Delay cannot exceed 1 hour')
    .default(env.MIN_EMAIL_DELAY_MS),

  /** Per-sender hourly cap for this batch. Falls back to EMAILS_PER_HOUR. */
  hourlyLimit: z.coerce
    .number()
    .int('Hourly limit must be a whole number')
    .min(1, 'Hourly limit must be at least 1')
    .max(1_000_000, 'Hourly limit is unreasonably large')
    .default(env.EMAILS_PER_HOUR),
});

export type ScheduleEmailRequest = z.infer<typeof scheduleEmailSchema>;

/* -------------------------------------------------------------------------- */
/*  GET /api/emails/scheduled and /api/emails/sent                            */
/* -------------------------------------------------------------------------- */

export const listEmailsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListEmailsQuery = z.infer<typeof listEmailsQuerySchema>;

/* -------------------------------------------------------------------------- */
/*  GET /api/emails/search?q=                                                 */
/* -------------------------------------------------------------------------- */

export const searchEmailsQuerySchema = z.object({
  q: z.string().trim().min(1, 'Search query cannot be empty').max(200),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type SearchEmailsQuery = z.infer<typeof searchEmailsQuerySchema>;

/* -------------------------------------------------------------------------- */
/*  Route params                                                              */
/* -------------------------------------------------------------------------- */

export const emailIdParamSchema = z.object({ id: uuidSchema });
export const senderIdParamSchema = z.object({ id: uuidSchema });

export type EmailIdParams = z.infer<typeof emailIdParamSchema>;
export type SenderIdParams = z.infer<typeof senderIdParamSchema>;
