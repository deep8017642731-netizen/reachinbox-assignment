/**
 * Sender service — everything that touches the `senders` table.
 *
 * AUTHORISATION RULE (applies to every function in this file):
 * A sender is only ever read or written together with its `userId`. There is no
 * `findById(id)` that skips the owner check, because a single such method is how
 * cross-tenant data leaks get introduced. Instead of returning 403 for someone
 * else's sender we return 404, so the API never reveals that the row exists.
 */
import type { Sender } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { createLogger } from '../lib/logger';

const log = createLogger('Sender');

/** Safe projection sent to the browser (never the raw Prisma row). */
export interface SenderView {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

export function toSenderView(sender: Sender): SenderView {
  return {
    id: sender.id,
    email: sender.email,
    displayName: sender.displayName,
    createdAt: sender.createdAt.toISOString(),
  };
}

export async function listSenders(userId: string): Promise<SenderView[]> {
  const senders = await prisma.sender.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  });
  return senders.map(toSenderView);
}

export async function createSender(
  userId: string,
  input: { email: string; displayName?: string },
): Promise<SenderView> {
  // The unique index is ([userId, email]); check first so we can return a clear
  // message rather than a raw P2002 database error.
  const existing = await prisma.sender.findUnique({
    where: { userId_email: { userId, email: input.email } },
  });
  if (existing) {
    throw AppError.conflict(`Sender ${input.email} already exists`);
  }

  const sender = await prisma.sender.create({
    data: { userId, email: input.email, displayName: input.displayName ?? null },
  });

  log.info('Sender created', { senderId: sender.id, userId });
  return toSenderView(sender);
}

export async function deleteSender(userId: string, senderId: string): Promise<void> {
  // deleteMany with userId in the filter: a sender belonging to someone else
  // simply does not match, so nothing can be deleted across accounts.
  const { count } = await prisma.sender.deleteMany({ where: { id: senderId, userId } });
  if (count === 0) throw AppError.notFound('Sender not found');
  log.info('Sender deleted', { senderId, userId });
}

/**
 * Ownership-checked lookup used by the scheduling flow.
 * Throws 404 (not 403) when the sender belongs to another user.
 */
export async function getSenderOrThrow(userId: string, senderId: string): Promise<Sender> {
  const sender = await prisma.sender.findFirst({ where: { id: senderId, userId } });
  if (!sender) throw AppError.notFound('Sender not found');
  return sender;
}

/**
 * Gives a brand-new account a usable sender so the dashboard is not empty on
 * first login. Idempotent: safe to call on every login.
 */
export async function ensureDefaultSender(user: {
  id: string;
  email: string;
  name: string;
}): Promise<Sender> {
  const existing = await prisma.sender.findFirst({ where: { userId: user.id } });
  if (existing) return existing;

  const sender = await prisma.sender.create({
    data: { userId: user.id, email: user.email, displayName: user.name },
  });
  log.info('Default sender created for new account', { senderId: sender.id, userId: user.id });
  return sender;
}
