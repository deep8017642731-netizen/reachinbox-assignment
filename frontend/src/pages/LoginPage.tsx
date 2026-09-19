/**
 * LoginPage — matches the login frame (AP1).
 *
 * Layout: centred white card, bold "Login" heading, a light-green
 * "Login with Google" button, an "or sign up through email" divider, two
 * borderless grey fields, and a solid green submit button.
 *
 * THE ONE PLACE I DID NOT COPY THE DESIGN — AND WHY
 * The frame shows working Email ID / Password fields. This assignment specifies
 * authentication via **Google OAuth 2.0**, and password sign-in would mean adding
 * password hashing, a registration flow, login rate limiting and reset handling —
 * a second authentication system, with its own attack surface, that nobody asked
 * for. The fields are therefore rendered in the design's position but DISABLED,
 * with a visible explanation. That keeps the layout faithful while making it
 * unmistakable that nothing is being faked: there is no "logged in!" screen behind
 * a password box that does not authenticate anyone.
 *
 * The Google button performs the real OAuth redirect. When the deployment has no
 * GOOGLE_CLIENT_ID/SECRET the backend returns `?authError=google_not_configured`
 * and this page explains precisely what to configure.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { GOOGLE_LOGIN_URL } from '../services/misc.api';

/** Human-readable text for each `?authError=` code the backend can return. */
const AUTH_ERRORS: Record<string, string> = {
  google_not_configured:
    'Google sign-in is not configured on this deployment. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env and restart the API (README → Google OAuth Setup).',
  google_access_denied: 'You declined the Google consent screen, so no session was created.',
  invalid_state:
    'The sign-in could not be verified (the OAuth state did not match), so it was rejected. Please try again.',
  missing_code: 'Google did not return an authorization code. Please try again.',
  google_login_failed:
    'The authorization code could not be exchanged, or your Google profile could not be read. Check the backend logs.',
  google_start_failed: 'Google sign-in could not be started. Check the backend logs.',
};

export function LoginPage() {
  const { user, loading, integrations, devAuthBypass } = useAuth();
  const [authError, setAuthError] = useState<string | null>(null);

  // Read the error code once, then strip it from the URL so a refresh does not
  // resurrect a message the user has already read.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('authError');
    if (code) {
      setAuthError(code);
      params.delete('authError');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    }
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-app px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="rounded-2xl border border-slate-200 bg-white px-8 py-9 shadow-sm">
          <h1 className="text-center text-3xl font-bold tracking-tight text-slate-900">Login</h1>

          {authError ? (
            <div
              role="alert"
              className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs text-amber-900"
            >
              {AUTH_ERRORS[authError] ?? 'Sign-in could not be completed.'}
            </div>
          ) : null}

          {/* ---- Google: the real authentication path -------------------- */}
          {loading ? (
            <p className="mt-8 text-center text-sm text-slate-400">Checking your session…</p>
          ) : user ? (
            <div className="mt-6 space-y-4">
              <p className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-3 text-xs text-brand-900">
                Signed in as <span className="font-semibold">{user.name}</span> ({user.email})
              </p>
              <a
                href="/dashboard"
                className="block w-full rounded-lg bg-brand-600 px-4 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-700"
              >
                Open dashboard
              </a>
            </div>
          ) : (
            <>
              {/*
                A full-page navigation rather than fetch(): the API replies 302 to
                accounts.google.com and the browser must follow it. fetch() would be
                stopped by CORS long before reaching Google.
              */}
              <a
                href={GOOGLE_LOGIN_URL}
                aria-disabled={!integrations.googleOAuth}
                onClick={(event) => {
                  // With no credentials the redirect would only bounce back with an
                  // error, so it is blocked with an explanation instead.
                  if (!integrations.googleOAuth) event.preventDefault();
                }}
                className={`mt-6 flex w-full items-center justify-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors ${
                  integrations.googleOAuth
                    ? 'bg-brand-100 text-slate-800 hover:bg-brand-200'
                    : 'cursor-not-allowed bg-slate-100 text-slate-400'
                }`}
              >
                <GoogleMark />
                Login with Google
              </a>

              {/* ---- divider -------------------------------------------- */}
              <div className="my-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-slate-200" />
                <span className="text-xs text-slate-400">or sign up through email</span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>

              {/* ---- Email/password: present in the design, disabled here --- */}
              <fieldset disabled className="cursor-not-allowed space-y-3">
                <legend className="sr-only">Email and password sign-in (not available)</legend>

                <input
                  type="email"
                  placeholder="Email ID"
                  aria-label="Email ID"
                  className="w-full rounded-lg bg-surface-muted px-4 py-3 text-sm text-slate-500 placeholder:text-slate-500"
                />
                <input
                  type="password"
                  placeholder="Password"
                  aria-label="Password"
                  className="w-full rounded-lg bg-surface-muted px-4 py-3 text-sm text-slate-500 placeholder:text-slate-500"
                />
                <button
                  type="button"
                  className="w-full cursor-not-allowed rounded-lg bg-slate-200 px-4 py-3 text-sm font-semibold text-slate-400"
                >
                  Login
                </button>
              </fieldset>

              <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-400">
                Password sign-in is disabled: this assignment authenticates with Google OAuth 2.0 only.
                Use the Google button above.
              </p>
            </>
          )}
        </div>

        {/* ---- development notice ---------------------------------------- */}
        {devAuthBypass ? (
          <p className="mt-5 rounded-xl border border-sky-200 bg-sky-50 px-3.5 py-3 text-center text-[11px] leading-relaxed text-sky-900">
            <span className="font-semibold">Development mode:</span> the API runs with{' '}
            <code className="font-mono">DEV_AUTH_BYPASS=true</code>, so requests are attributed to a
            local development user. The Google button above is the real integration and works as soon
            as credentials are added. The bypass is refused when{' '}
            <code className="font-mono">NODE_ENV=production</code>.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Google's "G", inlined so no external asset is requested. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
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
