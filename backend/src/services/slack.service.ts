/**
 * Slack notifications.
 *
 * WHAT THIS FILE DOES: posts a rate-limit alert into the user's Slack workspace
 * using the token obtained from Slack OAuth (see auth/slack.oauth.ts). It talks to
 * the real Slack Web API (`chat.postMessage`) over HTTPS — there is no mock, no
 * webhook-URL stand-in and no "pretend it worked" branch.
 *
 * THE HARD PART: EXACTLY ONE NOTIFICATION PER EVENT
 * When a sender hits its hourly limit there may be hundreds of queued emails, and
 * up to WORKER_CONCURRENCY workers discovering the limit simultaneously. Naively
 * notifying per blocked job would post hundreds of identical messages and get the
 * app rate-limited by Slack itself.
 *
 * The fix is a Redis `SET key value EX ttl NX` claim (see
 * rate-limit.service.claimRateLimitNotification): the first worker to set the key
 * wins and posts; everyone else sees the key already exists and stays silent. The
 * claim expires shortly after the hour window ends, so the next hour can notify
 * again. If the Slack post itself fails, the claim is released so a later attempt
 * can retry instead of the window being silently "already notified".
 *
 * DISCONNECTED SLACK IS NOT AN ERROR: notification becomes a no-op and the system
 * keeps sending email. No crash, no retry storm — see README "Slack".
 */
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { createLogger } from '../lib/logger';
import {
  claimRateLimitNotification,
  describeWindow,
  releaseNotificationClaim,
  type RateLimitWindow,
} from './rate-limit.service';

const log = createLogger('Slack');
const SLACK_API_BASE = 'https://slack.com/api';

/** Safe projection — the access token never leaves the server. */
export interface SlackConnectionView {
  connected: boolean;
  teamId: string | null;
  teamName: string | null;
  channelId: string | null;
  channelName: string | null;
  /** Whether the deployment has Slack OAuth credentials at all. */
  configured: boolean;
}

type SlackConnectionRow = {
  teamId: string;
  teamName: string;
  channelId: string | null;
  channelName: string | null;
  connected: boolean;
} | null;

export function toConnectionView(row: SlackConnectionRow, configured: boolean): SlackConnectionView {
  if (!row || !row.connected) {
    return {
      connected: false,
      teamId: row?.teamId ?? null,
      teamName: row?.teamName ?? null,
      channelId: null,
      channelName: null,
      configured,
    };
  }
  return {
    connected: true,
    teamId: row.teamId,
    teamName: row.teamName,
    channelId: row.channelId,
    channelName: row.channelName,
    configured,
  };
}

/** Thin wrapper over the Slack Web API. Returns Slack's own error code on failure. */
export async function callSlackApi<T = Record<string, unknown>>(
  method: string,
  accessToken: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; data: T | null; error?: string }> {
  try {
    const response = await fetch(`${SLACK_API_BASE}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${accessToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });

    const payload = (await response.json()) as { ok: boolean; error?: string } & T;

    if (!payload.ok) {
      // Slack returns HTTP 200 with `{ok:false,error:"not_in_channel"}` for most
      // application errors, so the body must be inspected, not just the status.
      return { ok: false, data: null, error: payload.error ?? `HTTP ${response.status}` };
    }
    return { ok: true, data: payload };
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : 'network error',
    };
  }
}

/**
 * Picks where alerts should go, in order of preference:
 *   1. SLACK_ALERT_CHANNEL from .env (explicit configuration wins)
 *   2. the channel resolved during the OAuth callback
 *   3. the first channel the bot can see
 */
async function resolveChannelId(
  accessToken: string,
  storedChannelId: string | null,
): Promise<{ channelId: string | null; channelName: string | null; reason?: string }> {
  if (env.SLACK_ALERT_CHANNEL) {
    if (env.SLACK_ALERT_CHANNEL.startsWith('C') || env.SLACK_ALERT_CHANNEL.startsWith('G')) {
      return { channelId: env.SLACK_ALERT_CHANNEL, channelName: null };
    }
    // A channel *name* was configured; resolve it to an id.
    const listed = await callSlackApi<{ channels?: Array<{ id: string; name: string }> }>(
      'conversations.list',
      accessToken,
      { limit: 100, exclude_archived: true },
    );
    const match = listed.data?.channels?.find((c) => c.name === env.SLACK_ALERT_CHANNEL);
    if (match) return { channelId: match.id, channelName: match.name };
    return { channelId: null, channelName: null, reason: `channel #${env.SLACK_ALERT_CHANNEL} not found` };
  }

  if (storedChannelId) return { channelId: storedChannelId, channelName: null };

  const listed = await callSlackApi<{ channels?: Array<{ id: string; name: string }> }>(
    'conversations.list',
    accessToken,
    { limit: 100, exclude_archived: true },
  );
  const first = listed.data?.channels?.[0];
  if (first) return { channelId: first.id, channelName: first.name };

  return {
    channelId: null,
    channelName: null,
    reason:
      'no channel available — invite the bot to a channel (e.g. /invite @YourApp) or set SLACK_ALERT_CHANNEL',
  };
}

export interface RateLimitAlertInput {
  userId: string;
  senderId: string;
  senderEmail: string;
  limit: number;
  used: number;
  window: RateLimitWindow;
  /** Optional: the email that could not be sent and was delayed instead. */
  blockedRecipient?: string;
}

/** The message text. Exported so tests can assert on it without posting. */
export function buildRateLimitMessage(input: RateLimitAlertInput): string {
  const { endUtc } = input.window;
  const resumeTime = `${String(endUtc.getUTCHours()).padStart(2, '0')}:${String(
    endUtc.getUTCMinutes(),
  ).padStart(2, '0')} UTC`;

  const lines = [
    '⚠️ *Email Rate Limit Reached*',
    '',
    `*Sender:* ${input.senderEmail}`,
    `*Hourly limit:* ${input.limit}`,
    `*Used:* ${input.used}/${input.limit}`,
    `*Current window:* ${describeWindow(input.window)}`,
  ];

  if (input.blockedRecipient) {
    lines.push(`*Delayed email:* to ${input.blockedRecipient}`);
  }

  lines.push(
    '',
    `Additional emails have been *delayed* (not dropped) and will resume in the next available window from ${resumeTime}.`,
  );

  return lines.join('\n');
}

export interface NotifyResult {
  notified: boolean;
  reason?: string;
}

/**
 * Posts the "rate limit reached" alert — at most once per sender per hour window,
 * and only if Slack is connected.
 *
 * Never throws: a notification problem must not affect email delivery.
 */
export async function notifySenderRateLimitReached(
  input: RateLimitAlertInput,
): Promise<NotifyResult> {
  try {
    const connection = await prisma.slackConnection.findUnique({ where: { userId: input.userId } });

    if (!connection || !connection.connected) {
      // Expected, non-fatal: the system simply continues without notifying.
      log.info('Rate limit reached but Slack is not connected — skipping notification', {
        senderId: input.senderId,
        window: input.window.label,
      });
      return { notified: false, reason: 'slack-not-connected' };
    }

    // Exactly one worker per sender per window wins this claim.
    const claimed = await claimRateLimitNotification(input.senderId, input.window);
    if (!claimed) {
      log.debug('Rate limit alert already sent for this window', {
        senderId: input.senderId,
        window: input.window.label,
      });
      return { notified: false, reason: 'already-notified' };
    }

    const channel = await resolveChannelId(connection.accessToken, connection.channelId);
    if (!channel.channelId) {
      await releaseNotificationClaim(input.senderId, input.window);
      log.warn('Could not resolve a Slack channel for the alert', { reason: channel.reason });
      return { notified: false, reason: channel.reason ?? 'no-channel' };
    }

    const isRateLimited = (slashCommand: string, error?: string): boolean =>
      error === 'ratelimited' || error === 'rate_limited' || slashCommand.includes('ratelimit');

    let result = await callSlackApi('chat.postMessage', connection.accessToken, {
      channel: channel.channelId,
      text: buildRateLimitMessage(input),
      mrkdwn: true,
    });

    // Slack allowed, but the bot is not in that channel: retry joining once.
    if (!result.ok && result.error === 'not_in_channel') {
      const joined = await callSlackApi('conversations.join', connection.accessToken, {
        channel: channel.channelId,
      });
      if (joined.ok) {
        result = await callSlackApi('chat.postMessage', connection.accessToken, {
          channel: channel.channelId,
          text: buildRateLimitMessage(input),
          mrkdwn: true,
        });
      }
    }

    if (!result.ok) {
      // Release the claim so a later blocked email can retry the notification.
      await releaseNotificationClaim(input.senderId, input.window);
      if (isRateLimited('', result.error)) {
        log.warn('Slack throttled our request', { error: result.error });
      }
      log.error('Failed to post Slack alert', { error: result.error, channel: channel.channelId });
      return { notified: false, reason: result.error };
    }

    // Remember where we posted, so the next alert skips discovery.
    if (!connection.channelId) {
      await prisma.slackConnection
        .update({
          where: { userId: input.userId },
          data: { channelId: channel.channelId, channelName: channel.channelName },
        })
        .catch(() => undefined);
    }

    log.info('Slack rate-limit alert posted', {
      senderId: input.senderId,
      channel: channel.channelId,
      window: input.window.label,
    });
    return { notified: true };
  } catch (error) {
    log.error('Unexpected error while notifying Slack', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { notified: false, reason: 'unexpected-error' };
  }
}

/** "Send test message" button in the dashboard — proves the connection works now. */
export async function sendTestNotification(userId: string): Promise<NotifyResult> {
  const connection = await prisma.slackConnection.findUnique({ where: { userId } });
  if (!connection || !connection.connected) {
    return { notified: false, reason: 'slack-not-connected' };
  }

  const channel = await resolveChannelId(connection.accessToken, connection.channelId);
  if (!channel.channelId) return { notified: false, reason: channel.reason ?? 'no-channel' };

  const result = await callSlackApi('chat.postMessage', connection.accessToken, {
    channel: channel.channelId,
    text: '✅ *ReachInbox Email Scheduler* connected successfully.\nYou will be notified here when a sender reaches its hourly limit.',
    mrkdwn: true,
  });

  return result.ok ? { notified: true } : { notified: false, reason: result.error };
}

/** Disconnects Slack: stops notifications but keeps the row for audit history. */
export async function disconnectSlack(userId: string): Promise<boolean> {
  const connection = await prisma.slackConnection.findUnique({ where: { userId } });
  if (!connection) return false;

  // Clearing the token as well as the flag means a stale token is not left in the
  // database waiting to be misused; reconnecting writes a fresh one.
  await prisma.slackConnection.update({
    where: { userId },
    data: { connected: false, accessToken: '', channelId: null, channelName: null },
  });

  log.info('Slack disconnected', { userId, team: connection.teamName });
  return true;
}
