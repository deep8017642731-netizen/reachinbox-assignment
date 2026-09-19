/**
 * Google OAuth HTTP handlers.
 *
 * ERROR HANDLING PHILOSOPHY FOR BROWSER FLOWS
 * These two endpoints are reached by NAVIGATING, not by fetch. Returning raw JSON
 * would leave the user staring at `{"success":false,...}` in the address bar, so
 * every failure redirects back to the frontend with an `?authError=` code that the
 * login page turns into a readable message. Nothing sensitive is put in the URL —
 * only short machine codes.
 */
import type { Request, Response } from 'express';
import { env, getGoogleOAuthConfig } from '../config/env';
import {
  GoogleOAuthNotConfiguredError,
  buildGoogleAuthorizeUrl,
  exchangeGoogleCode,
} from '../auth/google.oauth';
import { consumeOAuthState, createOAuthState, regenerateSession, rememberOAuthState, saveSession } from '../auth/oauth';
import { prisma } from '../lib/prisma';
import { ensureDefaultSender } from '../services/sender.service';
import { createLogger } from '../lib/logger';
import type { SessionUser } from '../types';

const log = createLogger('GoogleAuth');

/** Sends the browser back to the login page with a short, safe error code. */
function redirectWithError(res: Response, code: string): void {
  res.redirect(`${env.FRONTEND_URL}/login?authError=${encodeURIComponent(code)}`);
}

/**
 * GET /auth/google — start the flow.
 * When credentials are absent we say so explicitly rather than impersonating
 * Google's consent screen.
 */
export function handleGoogleStart(req: Request, res: Response): void {
  const config = getGoogleOAuthConfig();
  if (!config) {
    log.warn('Google login attempted but OAuth is not configured');
    redirectWithError(res, 'google_not_configured');
    return;
  }

  try {
    const state = createOAuthState();
    rememberOAuthState(req, state);
    const url = buildGoogleAuthorizeUrl(state);
    log.info('Redirecting to Google for consent');
    res.redirect(url);
  } catch (error) {
    if (error instanceof GoogleOAuthNotConfiguredError) {
      redirectWithError(res, 'google_not_configured');
      return;
    }
    log.error('Failed to build the Google authorize URL', {
      error: error instanceof Error ? error.message : String(error),
    });
    redirectWithError(res, 'google_start_failed');
  }
}

/**
 * GET /auth/google/callback — Google sends the user back here.
 *
 * Steps 3-5 of the flow in auth/google.oauth.ts, plus session creation. The
 * session ID is regenerated before storing the user (session-fixation defence) and
 * the session is saved BEFORE redirecting, otherwise the very next request from the
 * browser can arrive before the session is persisted and appear unauthenticated.
 */
export async function handleGoogleCallback(req: Request, res: Response): Promise<void> {
  // The user pressed "Cancel" on Google's consent screen.
  if (typeof req.query.error === 'string') {
    log.info('User declined Google consent', { error: req.query.error });
    redirectWithError(res, 'google_access_denied');
    return;
  }

  if (!consumeOAuthState(req, req.query.state)) {
    // Missing, replayed or tampered `state` — never continue.
    log.warn('Rejected Google callback: state mismatch');
    redirectWithError(res, 'invalid_state');
    return;
  }

  const code = req.query.code;
  if (typeof code !== 'string' || code === '') {
    redirectWithError(res, 'missing_code');
    return;
  }

  try {
    const profile = await exchangeGoogleCode(code);

    // Find by Google's stable subject id; create on first login. `update` refreshes
    // the name/avatar so a changed Google profile is reflected on next login.
    const user = await prisma.user.upsert({
      where: { googleId: profile.googleId },
      update: { name: profile.name, avatar: profile.avatar, email: profile.email },
      create: {
        googleId: profile.googleId,
        email: profile.email,
        name: profile.name,
        avatar: profile.avatar,
      },
    });

    // Every account needs at least one sender to be able to schedule anything.
    await ensureDefaultSender(user);

    const sessionUser: SessionUser = {
      id: user.id,
      googleId: user.googleId,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
    };

    // Rotate the session id, then attach the user.
    await regenerateSession(req);
    req.session.user = sessionUser;
    await saveSession(req);

    log.info('User signed in', { userId: user.id, email: user.email });
    res.redirect(`${env.FRONTEND_URL}/dashboard`);
  } catch (error) {
    log.error('Google callback failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    redirectWithError(res, 'google_login_failed');
  }
}
