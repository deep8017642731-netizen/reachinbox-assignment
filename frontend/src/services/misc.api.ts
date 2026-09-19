/**
 * Auth, sender, Slack and health API calls.
 *
 * Grouped in one file because each is only two or three lines — splitting them
 * into four files would add navigation cost without adding clarity. The larger
 * email surface lives in emails.api.ts.
 */
import { api } from './api';
import type {
  AuthUser,
  HealthReport,
  IntegrationFlags,
  MeResponse,
  Sender,
  SlackStatus,
} from '../types';

/* -------------------------------------------------------------------------- */
/*  Auth                                                                      */
/* -------------------------------------------------------------------------- */

export function fetchMe(signal?: AbortSignal): Promise<MeResponse> {
  return api.get<MeResponse>('/api/auth/me', { signal });
}

export function logout(): Promise<{ success: true }> {
  return api.post<{ success: true }>('/api/auth/logout');
}

/**
 * Google sign-in target.
 *
 * A full-page navigation, not a fetch: the backend responds with a 302 to
 * accounts.google.com, and the browser must follow it. Calling this with fetch
 * would fail the CORS preflight and never reach Google's consent screen.
 */
export const GOOGLE_LOGIN_URL = '/auth/google';

/* -------------------------------------------------------------------------- */
/*  Senders                                                                   */
/* -------------------------------------------------------------------------- */

export function fetchSenders(signal?: AbortSignal): Promise<{ success: true; senders: Sender[] }> {
  return api.get<{ success: true; senders: Sender[] }>('/api/senders', { signal });
}

export function createSender(payload: {
  email: string;
  displayName?: string;
}): Promise<{ success: true; sender: Sender }> {
  return api.post<{ success: true; sender: Sender }>('/api/senders', payload);
}

export function deleteSender(senderId: string): Promise<{ success: true }> {
  return api.delete<{ success: true }>(`/api/senders/${senderId}`);
}

/* -------------------------------------------------------------------------- */
/*  Slack                                                                     */
/* -------------------------------------------------------------------------- */

export function fetchSlackStatus(signal?: AbortSignal): Promise<{ success: true; slack: SlackStatus }> {
  return api.get<{ success: true; slack: SlackStatus }>('/api/slack/status', { signal });
}

/**
 * Starts Slack OAuth.
 *
 * Returns the authorization URL instead of redirecting, so the caller can decide
 * what to do — and so a failure (503 when the deployment has no Slack
 * credentials) surfaces as an error message rather than a broken browser
 * navigation to a plain JSON error page.
 */
export function startSlackConnect(): Promise<{ success: true; authorizeUrl: string }> {
  return api.get<{ success: true; authorizeUrl: string }>('/api/slack/connect');
}

export function disconnectSlack(): Promise<{ success: true; message: string }> {
  return api.post<{ success: true; message: string }>('/api/slack/disconnect');
}

export function sendSlackTest(): Promise<{ success: true; message: string }> {
  return api.post<{ success: true; message: string }>('/api/slack/test');
}

/* -------------------------------------------------------------------------- */
/*  Health                                                                    */
/* -------------------------------------------------------------------------- */

/** Used by the status strip in the header. Never throws for a degraded system. */
export function fetchHealth(signal?: AbortSignal): Promise<HealthReport> {
  return api.get<HealthReport>('/api/health', { signal });
}

export type { AuthUser, IntegrationFlags, Sender, SlackStatus, HealthReport };
