/**
 * LoginPage — real Google sign-in, and honest messages when it cannot run.
 *
 * THE IMPORTANT PART: this page never fakes authentication. The button navigates
 * to `${BACKEND}/auth/google`, which 302s to accounts.google.com. When the
 * deployment has no GOOGLE_CLIENT_ID/SECRET the backend redirects back here with
 * `?authError=google_not_configured`, and this page explains exactly what to
 * configure — rather than showing a "logged in!" screen that is not true.
 *
 * It also renders the dev-bypass notice when the backend is running in local mode,
 * so nobody mistakes the local development user for a real Google session.
 */
import { useEffect, useState } from 'react';
import { Alert, Spinner } from '../components/ui/Feedback';
import { useAuth } from '../context/AuthContext';
import { GOOGLE_LOGIN_URL } from '../services/misc.api';

/** Human-readable text for each `?authError=` code the backend can return. */
const AUTH_ERRORS: Record<string, { title: string; body: string }> = {
  google_not_configured: {
    title: 'Google sign-in is not configured yet',
    body: 'The backend has no GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. Follow “Google OAuth Setup” in the README, add them to backend/.env and restart the API. Until then, sign-in is unavailable — the app will not pretend otherwise.',
  },
  google_access_denied: {
    title: 'Sign-in cancelled',
    body: 'You declined the Google consent screen, so no session was created.',
  },
  invalid_state: {
    title: 'Sign-in could not be verified',
    body: 'The response failed a security check (the OAuth state did not match), so it was rejected. This can happen if you left the page open for a long time. Please try again.',
  },
  missing_code: {
    title: 'Google did not return an authorization code',
    body: 'The callback was missing its code parameter. Please try signing in again.',
  },
  google_login_failed: {
    title: 'Google sign-in failed',
    body: 'The authorization code could not be exchanged, or the Google profile could not be read. Check the backend logs for the specific error.',
  },
  google_start_failed: {
    title: 'Could not start Google sign-in',
    body: 'The authorize URL could not be built. Check the backend logs.',
  },
};

export function LoginPage() {
  const { user, loading, integrations, devAuthBypass } = useAuth();
  const [authError, setAuthError] = useState<string | null>(null);

  // Read the error code once on mount, then strip it from the URL so a refresh
  // does not resurrect a stale message.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('authError');
    if (code) {
      setAuthError(code);
      params.delete('authError');
      const query = params.toString();
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}`,
      );
    }
  }, []);

  const errorInfo = authError ? AUTH_ERRORS[authError] : null;

  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* ---- brand ------------------------------------------------------ */}
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="white" strokeWidth="2" />
              <path d="m4 7.5 8 5.5 8-5.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h1 className="mt-3 text-lg font-semibold text-slate-900">ReachInbox Email Scheduler</h1>
          <p className="mt-1 text-sm text-slate-500">
            Schedule campaigns with BullMQ, monitor delivery, and get Slack alerts when a sender hits
            its hourly limit.
          </p>
        </div>

        {/* ---- card ------------------------------------------------------- */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-6">
              <Spinner size={20} />
              <span className="text-sm text-slate-500">Checking your session…</span>
            </div>
          ) : user ? (
            <div className="space-y-4">
              <Alert tone="success" title={`Signed in as ${user.name}`}>
                {user.email} — you can go straight to the dashboard.
              </Alert>
              <a
                href="/dashboard"
                className="block w-full rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-brand-700"
              >
                Open dashboard
              </a>
            </div>
          ) : (
            <div className="space-y-4">
              {errorInfo ? (
                <Alert tone="warning" title={errorInfo.title}>
                  {errorInfo.body}
                </Alert>
              ) : null}

              {/*
                A full-page navigation, not a fetch: the backend replies with a 302
                to Google, and the browser has to follow it. fetch() would be blocked
                by CORS before reaching Google at all.
              */}
              <a
                href={GOOGLE_LOGIN_URL}
                className={`flex w-full items-center justify-center gap-2.5 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                  integrations.googleOAuth
                    ? 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                }`}
                aria-disabled={!integrations.googleOAuth}
                onClick={(event) => {
                  // Block the navigation when the backend has no credentials: it
                  // would only bounce straight back with an error.
                  if (!integrations.googleOAuth) event.preventDefault();
                }}
              >
                <GoogleMark />
                Continue with Google
              </a>

              {!integrations.googleOAuth ? (
                <p className="text-center text-xs text-slate-500">
                  Google OAuth is not configured on this deployment. See README → Google OAuth Setup.
                </p>
              ) : (
                <p className="text-center text-xs text-slate-500">
                  You will be redirected to Google to approve access. Only your name, email and avatar
                  are stored.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ---- development notice ----------------------------------------- */}
        {devAuthBypass ? (
          <div className="mt-4">
            <Alert tone="info" title="Development mode">
              The backend is running with <code className="font-mono text-xs">DEV_AUTH_BYPASS=true</code>,
              so requests are attributed to a local development user instead of a Google session.
              Google login above is the real integration and works as soon as credentials are added.
              This bypass is refused when <code className="font-mono text-xs">NODE_ENV=production</code>.
            </Alert>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Google's "G", inlined. */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.1Z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.5 46 24 46Z"
      />
      <path
        fill="#FBBC05"
        d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.3-2.9.7-4.2v-5.7H4.5A22 22 0 0 0 2 24c0 3.6.9 6.9 2.5 9.9l7.3-5.7Z"
      />
      <path
        fill="#EA4335"
        d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.3 29.9 2 24 2 15.5 2 8.1 6.9 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9 12.2-9Z"
      />
    </svg>
  );
}
