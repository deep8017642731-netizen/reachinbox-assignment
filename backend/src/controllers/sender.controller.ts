/**
 * Sender HTTP controllers.
 */
import type { Request, Response } from 'express';
import { createSender, deleteSender, listSenders } from '../services/sender.service';
import { peekUsage } from '../services/rate-limit.service';
import { AppError } from '../middleware/error.middleware';
import { validatedBody, validatedParams } from '../middleware/validation.middleware';
import type { SenderIdParams } from '../validation/email.schema';
import type { CreateSenderRequest } from '../validation/sender.schema';
import { env } from '../config/env';

function requireUserId(req: Request): string {
  if (!req.authUser) throw AppError.unauthorized('No authenticated user on this request');
  return req.authUser.id;
}

/**
 * Lists the caller's senders together with their CURRENT hourly usage, so the
 * dashboard can show "12/50 this hour" without a second request.
 *
 * If Redis is unavailable the usage lookup fails: rather than failing the whole
 * request (the senders themselves are still useful) we return `usage: null` and
 * let the UI omit that detail.
 */
export async function handleListSenders(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const senders = await listSenders(userId);

  const withUsage = await Promise.all(
    senders.map(async (sender) => {
      try {
        const usage = await peekUsage(sender.id, env.EMAILS_PER_HOUR);
        return {
          ...sender,
          usage: { usedThisHour: usage.used, limit: usage.limit, resetsAt: usage.resetsAtUtc },
        };
      } catch {
        return { ...sender, usage: null };
      }
    }),
  );

  res.json({ success: true, senders: withUsage });
}

export async function handleCreateSender(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const body = validatedBody<CreateSenderRequest>(req);
  const sender = await createSender(userId, body);

  res.status(201).json({ success: true, message: 'Sender added', sender });
}

export async function handleDeleteSender(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);
  const { id } = validatedParams<SenderIdParams>(req);
  await deleteSender(userId, id);

  res.json({ success: true, message: 'Sender deleted' });
}
