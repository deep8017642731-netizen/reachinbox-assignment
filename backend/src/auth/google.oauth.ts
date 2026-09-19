/**
 * Google OAuth 2.0 / OpenID Connect — the real flow.
 *
 *   1. GET /auth/google
 *        redirect to https://accounts.google.com/o/oauth2/v2/auth
 *   2. user approves, Google redirects to GOOGLE_CALLBACK_URL?code=…&state=…
 *   3. POST code to https://oauth2.googleapis.com/token  -> access token
 *   4. GET https://www.googleapis.com/oauth2/v3/userinfo -> the profile
 *   5. find-or-create the User row, start a session
 *
 * WHY USERINFO INSTEAD OF DECODING THE id_token
 * The code flow returns an `id_token` (a JWT). Verifying it properly means fetching
 * Google's JWKS and checking the signature, issuer and audience. Calling the
 * userinfo endpoint with the freshly issued access token achieves the same result
 * with less code: the token came directly from Google over TLS in step 3, and it
 * is only ever used to ask Google "who does this token belong to?". Both approaches
 * are accepted in Google's documentation; this one is easier to audit.
 *
 * Configuring the credentials: see README "Google OAuth Setup".
 */
import { getGoogleOAuthConfig } from '../config/env';
import { buildQuery, exchangeAuthorizationCode } from './oauth';
import { createLogger } from '../lib/logger';

const log = createLogger('GoogleOAuth');

const AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** The subset of Google's profile we store. */
export interface GoogleProfile {
  /** Google's stable subject id. Never the email: an email address can change. */
  googleId: string;
  email: string;
  name: string;
  avatar: string | null;
  emailVerified: boolean;
}

export class GoogleOAuthNotConfiguredError extends Error {
  constructor() {
    super(
      'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET ' +
        '(see README → Google OAuth Setup).',
    );
    this.name = 'GoogleOAuthNotConfiguredError';
  }
}

/** Step 1: the URL we send the user's browser to. */
export function buildGoogleAuthorizeUrl(state: string): string {
  const config = getGoogleOAuthConfig();
  if (!config) throw new GoogleOAuthNotConfiguredError();

  return `${AUTHORIZE_URL}?${buildQuery({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    // Always show the account chooser: without it, users who are signed into
    // multiple Google accounts get logged into a previous one by surprise.
    prompt: 'select_account',
    access_type: 'online',
  })}`;
}

/** Steps 3 and 4: swap the code for a token, then read the profile. */
export async function exchangeGoogleCode(code: string): Promise<GoogleProfile> {
  const config = getGoogleOAuthConfig();
  if (!config) throw new GoogleOAuthNotConfiguredError();

  const token = await exchangeAuthorizationCode(TOKEN_URL, {
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.callbackUrl,
    grant_type: 'authorization_code',
  });

  if (!token.ok) {
    log.error('Token exchange failed', { error: token.error });
    throw new Error(`Google rejected the authorization code: ${token.error}`);
  }

  const accessToken = token.data?.access_token;
  if (typeof accessToken !== 'string') {
    throw new Error('Google did not return an access token');
  }

  const response = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Could not read the Google profile (HTTP ${response.status})`);
  }

  const profile = (await response.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    picture?: string;
    email_verified?: boolean;
  };

  if (!profile.sub || !profile.email) {
    throw new Error('Google profile is missing the subject id or email');
  }

  log.info('Google profile received', { email: profile.email, verified: profile.email_verified });

  return {
    googleId: profile.sub,
    email: profile.email.toLowerCase(),
    name: profile.name ?? profile.email.split('@')[0],
    avatar: profile.picture ?? null,
    emailVerified: profile.email_verified === true,
  };
}
