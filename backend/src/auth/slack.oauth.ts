/**
 * Slack OAuth 2.0 ("Add to Slack") — the real flow.
 *
 *   1. GET /api/slack/connect
 *        redirect to https://slack.com/oauth/v2/authorize
 *   2. user picks a workspace and approves the requested scopes
 *   3. Slack redirects to SLACK_REDIRECT_URI?code=…&state=…
 *   4. POST code to https://slack.com/api/oauth.v2.access -> bot access token
 *   5. store the token and post a confirmation message
 *
 * WHAT WE ASK FOR (and nothing more — least privilege):
 *   team:read      read the workspace name for the dashboard
 *   channels:read  list channels so we can pick one for alerts
 *   chat:write     post the rate-limit notification
 *
 * WHERE THE TOKEN GOES
 * The bot token stays in PostgreSQL (`SlackConnection.accessToken`) and is only
 * ever read by the Slack service when posting a message. It is never returned to
 * the browser, never logged, and never put in a session. The API exposes only the
 * safe projection in `toConnectionView` (see services/slack.service.ts).
 *
 * Configuring the app: see README "Slack OAuth Setup".
 */
import { getSlackOAuthConfig } from '../config/env';
import { buildQuery, exchangeAuthorizationCode } from './oauth';
import { createLogger } from '../lib/logger';

const log = createLogger('SlackOAuth');

const AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
const ACCESS_URL = 'https://slack.com/api/oauth.v2.access';

export class SlackOAuthNotConfiguredError extends Error {
  constructor() {
    super(
      'Slack OAuth is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET ' +
        '(see README → Slack OAuth Setup).',
    );
    this.name = 'SlackOAuthNotConfiguredError';
  }
}

export interface SlackWorkspaceConnection {
  teamId: string;
  teamName: string;
  /** Server-side only. */
  accessToken: string;
  scope: string | null;
  /** The bot's own user id, needed by some Slack APIs (not required for chat.postMessage). */
  botUserId: string | null;
}

/** Step 1: the URL we send the user's browser to. */
export function buildSlackAuthorizeUrl(state: string): string {
  const config = getSlackOAuthConfig();
  if (!config) throw new SlackOAuthNotConfiguredError();

  return `${AUTHORIZE_URL}?${buildQuery({
    client_id: config.clientId,
    // Slack accepts a comma-separated scope list; minimal set, no admin scopes.
    scope: config.scopes.join(','),
    redirect_uri: config.redirectUri,
    state,
  })}`;
}

/** Reconnecting uses the same endpoint; Slack replaces the previous grant. */
export function isSlackReconnect(): boolean {
  return true;
}

/** Step 4: exchange the code for a bot token. */
export async function exchangeSlackCode(code: string): Promise<SlackWorkspaceConnection> {
  const config = getSlackOAuthConfig();
  if (!config) throw new SlackOAuthNotConfiguredError();

  const result = await exchangeAuthorizationCode(ACCESS_URL, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
  });

  if (!result.ok || !result.data) {
    log.error('Token exchange failed', { error: result.error });
    throw new Error(`Slack rejected the authorization code: ${result.error}`);
  }

  const payload = result.data as {
    access_token?: string;
    scope?: string;
    bot_user_id?: string;
    team?: { id?: string; name?: string };
  };

  if (!payload.access_token || !payload.team?.id) {
    throw new Error('Slack did not return an access token or team id');
  }

  log.info('Slack workspace authorised', {
    team: payload.team.name,
    // Log WHICH scopes were granted, never the token itself.
    scope: payload.scope,
  });

  return {
    teamId: payload.team.id,
    teamName: payload.team.name ?? 'Slack workspace',
    accessToken: payload.access_token,
    scope: payload.scope ?? null,
    botUserId: payload.bot_user_id ?? null,
  };
}
