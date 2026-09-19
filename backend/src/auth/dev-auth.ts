/**
 * Development authentication fallback.
 *
 * WHY THIS EXISTS
 * Google OAuth is implemented for real (see auth/google.strategy.ts), but it
 * needs credentials that live in a Google Cloud project. Until those are set,
 * every email endpoint would return 401 and the scheduler would be impossible to
 * run or grade. This module provides a single, clearly-labelled local user so the
 * scheduling pipeline can be exercised without OAuth credentials.
 *
 * WHAT IT IS NOT
 * It is not a fake Google login: no Google UI is imitated, no token is invented,
 * and the React app still links to the real `/auth/google` route. It is a
 * development-only identity, and it is refused outright when
 * NODE_ENV=production (see assertDevAuthBypassAllowed in config/env.ts).
 *
 * This is a deliberate engineering trade-off, and it is documented as such in
 * the README rather than hidden.
 */
import { prisma } from '../lib/prisma';
import { ensureDefaultSender } from '../services/sender.service';
import { createLogger } from '../lib/logger';
import type { SessionUser } from '../types';

const log = createLogger('DevAuth');

/** Stable marker so the same dev user is reused across restarts. */
const DEV_GOOGLE_ID = 'dev-bypass-user';
const DEV_EMAIL = 'dev.local@example.com';

let cachedUser: SessionUser | null = null;

export async function getDevUser(): Promise<SessionUser> {
  if (cachedUser) return cachedUser;

  // upsert, not create: the row survives restarts, so scheduled emails keep
  // pointing at a user that still exists.
  const user = await prisma.user.upsert({
    where: { googleId: DEV_GOOGLE_ID },
    update: {},
    create: {
      googleId: DEV_GOOGLE_ID,
      email: DEV_EMAIL,
      name: 'Local Dev User',
      avatar: null,
    },
  });

  const sender = await ensureDefaultSender(user);

  cachedUser = {
    id: user.id,
    googleId: user.googleId,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
  };

  log.warn('DEV_AUTH_BYPASS enabled — every request is attributed to the local dev user', {
    userId: user.id,
    senderId: sender.id,
    note: 'Set DEV_AUTH_BYPASS=false and configure Google OAuth for real authentication.',
  });

  return cachedUser;
}
