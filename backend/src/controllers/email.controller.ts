/**
 * Email HTTP controllers.
 *
 * Controllers stay thin on purpose: read validated input, call a service, shape
 * the response. All rules (authorisation, rate limits, scheduling maths) live in
 * the service layer, so the same logic is reachable from the worker and from
 * tests without going through HTTP.
 */
import type { Request, Response } from 'express';
import {
  cancelEmail,
  getEmailForUser,
  getEmailStats,
  listScheduledEmails,
  listSentEmails,
  scheduleEmails,
  searchUserEmails,
} from '../services/email.service';
import { parseRecipientsFromText, MAX_RECIPIENTS_PER_REQUEST } from '../utils/email-parser';
import { AppError } from '../middleware/error.middleware';
import { createLogger } from '../lib/logger';
import {
  validatedBody,
  validatedParams,
  validatedQuery,
} from '../middleware/validation.middleware';
import type {
  EmailIdParams,
  ListEmailsQuery,
  ScheduleEmailRequest,
  SearchEmailsQuery,
} from '../validation/email.schema';
import type { SessionUser } from '../types';

const log = createLogger('EmailAPI');

/**
 * Identity is guaranteed by `requireAuth`, but read through this helper so a
 * route accidentally mounted without the guard fails loudly (500 with a clear
 * message) instead of silently operating on `undefined`.
 */
function requireUser(req: Request): SessionUser {
  if (!req.authUser) {
    throw AppError.unauthorized('No authenticated user on this request');
  }
  return req.authUser;
}

export async function handleScheduleEmails(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = validatedBody<ScheduleEmailRequest>(req);

  const result = await scheduleEmails({
    userId: user.id,
    senderId: body.senderId,
    subject: body.subject,
    body: body.body,
    recipients: body.recipients,
    startTime: new Date(body.startTime),
    delayBetweenEmailsMs: body.delayBetweenEmailsMs,
    hourlyLimit: body.hourlyLimit,
  });

  res.status(201).json({
    success: true,
    message: `${result.scheduledCount} email(s) scheduled`,
    ...result,
    // Echo the enforced rules so the UI can tell the user what actually applied
    // (e.g. a requested 500ms delay raised to the 2000ms floor).
    enforced: {
      delayBetweenEmailsMs: result.appliedDelayMs,
      hourlyLimit: body.hourlyLimit,
    },
  });
}

export async function handleListScheduled(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { page, limit } = validatedQuery<ListEmailsQuery>(req);
  const result = await listScheduledEmails(user.id, page, limit);

  res.json({ success: true, ...result });
}

export async function handleListSent(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { page, limit } = validatedQuery<ListEmailsQuery>(req);
  const result = await listSentEmails(user.id, page, limit);

  res.json({ success: true, ...result });
}

export async function handleGetEmail(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = validatedParams<EmailIdParams>(req);
  const email = await getEmailForUser(user.id, id);

  res.json({ success: true, email });
}

export async function handleCancelEmail(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { id } = validatedParams<EmailIdParams>(req);
  const email = await cancelEmail(user.id, id);

  res.json({ success: true, message: 'Email cancelled', email });
}

export async function handleSearchEmails(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { q, page, limit } = validatedQuery<SearchEmailsQuery>(req);
  const result = await searchUserEmails(user.id, q, page, limit);

  res.json({ success: true, query: q, ...result });
}

export async function handleEmailStats(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const stats = await getEmailStats(user.id);

  res.json({ success: true, stats });
}

/**
 * Parses an uploaded CSV/TXT file (or pasted text) into recipients.
 *
 * The React app parses files locally too, for instant feedback — this endpoint
 * exists so that (a) the same parsing rules are enforced server-side, and (b) very
 * large lists can be validated server-side without trusting the browser.
 * Nothing is stored: validation only.
 */
export async function handleParseRecipients(req: Request, res: Response): Promise<void> {
  requireUser(req);

  const file = req.file;
  const pasted = typeof req.body?.text === 'string' ? (req.body.text as string) : '';

  const raw = file ? file.buffer.toString('utf8') : pasted;
  if (!raw.trim()) {
    throw AppError.badRequest(
      'No file or text supplied. Upload a .csv/.txt file in the "file" field, or send { "text": "..." }',
    );
  }

  const parsed = parseRecipientsFromText(raw);

  log.info('Parsed recipient list', {
    source: file ? file.originalname : 'pasted-text',
    valid: parsed.valid.length,
    invalid: parsed.invalid.length,
    duplicates: parsed.duplicatesRemoved,
  });

  res.json({
    success: true,
    source: file ? file.originalname : 'text',
    totalCandidates: parsed.totalCandidates,
    validCount: parsed.valid.length,
    invalidCount: parsed.invalid.length,
    duplicatesRemoved: parsed.duplicatesRemoved,
    truncated: parsed.truncated,
    maxPerRequest: MAX_RECIPIENTS_PER_REQUEST,
    // Return valid addresses so the UI can show the final list before sending;
    // invalid ones are echoed back for display but are never submitted.
    valid: parsed.valid,
    invalid: parsed.invalid.slice(0, 50),
  });
}
