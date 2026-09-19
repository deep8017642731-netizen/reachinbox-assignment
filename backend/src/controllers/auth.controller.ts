/**
 * Authentication controllers.
 *
 * `/api/auth/me` is what the React app calls on load to decide between rendering
 * the login page and the dashboard. It returns `user: null` (HTTP 200) instead of
 * 401 for anonymous visitors, so "not signed in yet" is a normal state the UI can
 * render rather than an error it has to catch.
 */
import type { Request, Response } from 'express';
import { env, getGoogleOAuthConfig, getSlackOAuthConfig, isSmtpConfigured } from '../config/env';
import { createLogger } from '../lib/logger';

const log = createLogger('Auth');

export async function handleMe(req: Request, res: Response): Promise<void> {
  res.json({
    success: true,
    user: req.authUser ?? null,
    /**
     * Which optional integrations exist in this deployment. The UI uses this to
     * disable the "Connect Slack" button with a helpful tooltip instead of
     * sending the user into a broken OAuth redirect.
     */
    integrations: {
      googleOAuth: Boolean(getGoogleOAuthConfig()),
      slackOAuth: Boolean(getSlackOAuthConfig()),
      smtp: isSmtpConfigured(),
    },
    /**
     * True when the development auth bypass is active. The UI shows a small
     * warning banner so nobody mistakes the local user for a real Google login.
     */
    devAuthBypass: env.DEV_AUTH_BYPASS && env.NODE_ENV !== 'production',
  });
}

export async function handleLogout(req: Request, res: Response): Promise<void> {
  const userId = req.session?.user?.id;

  await new Promise<void>((resolve) => {
    req.session.destroy((error) => {
      if (error) log.error('Failed to destroy session', { message: error.message });
      resolve();
    });
  });

  // Clear the cookie in the browser too; otherwise the client keeps sending a
  // session id that no longer exists server-side.
  res.clearCookie('reachinbox.sid');
  log.info('User signed out', { userId });

  res.json({ success: true, message: 'Signed out' });
}
