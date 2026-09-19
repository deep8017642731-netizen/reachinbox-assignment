/**
 * Shared OAuth 2.0 plumbing used by both Google and Slack.
 *
 * WHY NOT A LIBRARY?
 * Passport strategies exist for Google but not for Slack, which would mean two
 * different implementations of the same flow. Both providers use the same standard
 * "authorization code" flow, so one small helper covers both:
 *
 *   1. GET /auth/<provider>            -> redirect the browser to the provider
 *   2. user approves on the provider   -> provider redirects back with ?code=…
 *   3. GET /auth/<provider>/callback   -> exchange the code for a token
 *   4. GET the user's profile          -> find or create our own user
 *
 * Writing it out also means every step is visible and explainable, with no
 * strategy-specific magic to debug at 2am.
 *
 * THE `state` PARAMETER (why it is not optional)
 * The redirect back from a provider is just a URL. Without protection, an attacker
 * can trick your browser into completing a callback with *their* authorization
 * code and silently log you into their account ("login CSRF"). We generate a random
 * `state`, store it in the user's session, and refuse any callback whose `state`
 * does not match. The comparison is timing-safe.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/** 128 bits of entropy — far beyond guessing, and URL-safe. */
export function createOAuthState(): string {
  return randomBytes(16).toString('hex');
}

/** Stores the state (and where to return afterwards) in the user's session. */
export function rememberOAuthState(req: Request, state: string, returnTo?: string): void {
  req.session.oauthState = state;
  if (returnTo) req.session.oauthReturnTo = returnTo;
}

/**
 * Validates the returned `state` against the session and clears it, so a code can
 * never be replayed. Returns false for a missing, wrong or already-used state.
 */
export function consumeOAuthState(req: Request, receivedState: unknown): boolean {
  const expected = req.session.oauthState;
  req.session.oauthState = undefined;

  if (!expected || typeof receivedState !== 'string') return false;

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(receivedState, 'utf8');
  // timingSafeEqual throws on length mismatch, so check length first.
  if (expectedBuffer.length !== receivedBuffer.length) return false;

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

/**
 * Builds a URL-safe query string.
 * `URLSearchParams` handles the encoding/escaping that is easy to get wrong by hand
 * (a malformed redirect_uri is the most common OAuth setup failure).
 */
export function buildQuery(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export interface OAuthTokenResponse {
  ok: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

/**
 * Exchanges an authorization code for an access token (the `token` endpoint).
 * Shared by Google and Slack: same request shape, different URLs and error styles.
 */
export async function exchangeAuthorizationCode(
  tokenUrl: string,
  body: Record<string, string>,
  options: { tokenInBody?: boolean } = {},
): Promise<OAuthTokenResponse> {
  const form = new URLSearchParams(body);

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  void options;

  // Google uses the HTTP status; Slack always returns 200 with {ok:false,error}.
  if (!response.ok) {
    return {
      ok: false,
      error: String(payload.error_description ?? payload.error ?? `HTTP ${response.status}`),
    };
  }
  if (payload.ok === false) {
    return { ok: false, error: String(payload.error ?? 'provider rejected the exchange') };
  }

  return { ok: true, data: payload };
}

/**
 * Session IDs must be rotated on login.
 *
 * If an attacker manages to set a session cookie in your browser *before* you log
 * in (a "session fixation" attack), reusing that same session ID after login would
 * hand them your authenticated session. Regenerating the ID on login makes any
 * pre-login ID worthless.
 */
export async function regenerateSession(req: Request): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

/** Persists the session before redirecting, so the browser's next request sees it. */
export async function saveSession(req: Request): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}
