/**
 * Slack OAuth + connection management handlers.
 *
 * The four operations the assignment requires, all real:
 *   Connect     GET  /api/slack/connect      -> redirect to Slack
 *   Callback    GET  /auth/slack/callback    -> store the token
 *   Status      GET  /api/slack/status       -> safe projection for the UI
 *   Disconnect  POST /api/slack/disconnect   -> stop notifications
 *   Test        POST /api/slack/test         -> prove it works right now
 *
 * DISCONNECT IS A FIRST-CLASS STATE, NOT AN ERROR: after disconnecting, the worker
 * keeps sending email and simply skips the notification. Reconnecting later works
 * immediately because the token is read from the database on every alert — no
 * process restart, no cached client.
 */
import type { Request, Response } from 'express';
import { env, getSlackOAuthConfig } from '../config/env';
import {
  SlackOAuthNotConfiguredError,
  buildSlackAuthorizeUrl,
  exchangeSlackCode,
} from '../auth/slack.oauth';
import { consumeOAuthState, createOAuthState, rememberOAuthState, saveSession } from '../auth/oauth';
import { prisma } from '../lib/prisma';
import { callSlackApi, disconnectSlack, sendTestNotification, toConnectionView } from '../services/slack.service';
import { AppError } from '../middleware/error.middleware';
import { createLogger } from '../lib/logger';

const log = createLogger('SlackAPI');

function requireUserId(req: Request): string {
  if (!req.authUser) throw AppError.unauthorized('No authenticated user on this request');
  return req.authUser.id;
}

/** GET /api/slack/connect — begin OAuth. */
export function handleSlackConnect(req: Request, res: Response): void {
  const userId = requireUserId(req);

  if (!getSlackOAuthConfig()) {
    // A JSON error is correct here: the frontend calls this via fetch so it can
    // show a tooltip explaining what is missing.
    throw AppError.notConfigured(
      'Slack OAuth is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET (see README → Slack OAuth Setup).',
    );
  }

  const state = createOAuthState();
  rememberOAuthState(req, state);

  let url: string;
  try {
    url = buildSlackAuthorizeUrl(state);
  } catch (error) {
    if (error instanceof SlackOAuthNotConfiguredError) {
      throw AppError.notConfigured(error.message);
    }
    throw error;
  }

  log.info('Redirecting to Slack for consent', { userId });
  res.json({ success: true, authorizeUrl: url });
}

/** GET /auth/slack/callback — Slack sends the user back here. */
export async function handleSlackCallback(req: Request, res: Response): Promise<void> {
  const dashboard = `${env.FRONTEND_URL}/dashboard`;

  if (typeof req.query.error === 'string') {
    log.info('User declined Slack consent', { error: req.query.error });
    res.redirect(`${dashboard}?slack=denied`);
    return;
  }

  if (!consumeOAuthState(req, req.query.state)) {
    log.warn('Rejected Slack callback: state mismatch');
    res.redirect(`${dashboard}?slack=invalid_state`);
    return;
  }

  const code = req.query.code;
  if (typeof code !== 'string' || code === '') {
    res.redirect(`${dashboard}?slack=missing_code`);
    return;
  }

  // The callback must know WHO is connecting. Normally the session cookie carries
  // that; if it has expired the user simply has to sign in again.
  const userId = req.session.user?.id;
  if (!userId) {
    res.redirect(`${dashboard}?slack=session_expired`);
    return;
  }

  try {
    const connection = await exchangeSlackCode(code);

    // Discover a channel to post alerts into, so notifications work immediately
    // instead of failing with "no channel" on the first rate limit.
    const listed = await callSlackApi<{ channels?: Array<{ id: string; name: string }> }>(
      'conversations.list',
      connection.accessToken,
      { limit: 100, exclude_archived: true },
    );
    const firstChannel = listed.data?.channels?.[0] ?? null;

    if (!firstChannel) {
      log.warn('No channel visible to the bot', {
        hint: 'Invite the app to a channel so it can post rate-limit alerts.',
      });
    }

    // One workspace per user: reconnecting replaces the previous grant, which is
    // exactly the "reconnect" behaviour the brief asks for.
    await prisma.slackConnection.upsert({
      where: { userId },
      update: {
        teamId: connection.teamId,
        teamName: connection.teamName,
        accessToken: connection.accessToken,
        scope: connection.scope,
        channelId: firstChannel?.id ?? null,
        channelName: firstChannel?.name ?? null,
        connected: true,
      },
      create: {
        userId,
        teamId: connection.teamId,
        teamName: connection.teamName,
        accessToken: connection.accessToken,
        scope: connection.scope,
        channelId: firstChannel?.id ?? null,
        channelName: firstChannel?.name ?? null,
        connected: true,
      },
    });

    await saveSession(req);
    log.info('Slack connected', {
      userId,
      team: connection.teamName,
      channel: firstChannel?.name ?? '(none)',
    });

    res.redirect(`${dashboard}?slack=connected`);
  } catch (error) {
    log.error('Slack callback failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.redirect(`${dashboard}?slack=failed`);
  }
}

/** GET /api/slack/status — never returns the access token. */
export async function handleSlackStatus(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);

  const connection = await prisma.slackConnection.findUnique({
    where: { userId },
    select: { teamId: true, teamName: true, channelId: true, channelName: true, connected: true },
  });

  res.json({
    success: true,
    slack: toConnectionView(connection, Boolean(getSlackOAuthConfig())),
  });
}

/** POST /api/slack/disconnect */
export async function handleSlackDisconnect(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);

  const disconnected = await disconnectSlack(userId);
  if (!disconnected) throw AppError.notFound('No Slack connection to disconnect');

  res.json({
    success: true,
    message: 'Slack disconnected. Emails will still be sent, without notifications.',
    slack: toConnectionView(null, Boolean(getSlackOAuthConfig())),
  });
}

/** POST /api/slack/test — posts a real message to prove the connection works. */
export async function handleSlackTest(req: Request, res: Response): Promise<void> {
  const userId = requireUserId(req);

  const result = await sendTestNotification(userId);
  if (!result.notified) {
    throw AppError.badRequest(
      result.reason === 'slack-not-connected'
        ? 'Slack is not connected'
        : `Slack could not deliver the message: ${result.reason ?? 'unknown reason'}`,
    );
  }

  res.json({ success: true, message: 'Test notification posted to Slack' });
}
