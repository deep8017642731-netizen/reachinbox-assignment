/**
 * SlackConnectionCard — sized for the sidebar area of the new layout.
 *
 * THREE DISTINCT STATES, because collapsing them is how a UI ends up lying:
 *
 *   1. Slack OAuth is not configured on this deployment
 *        -> the button is disabled and names the exact env vars required. It does
 *           not pretend to connect, and it does not bounce the user into a raw
 *           JSON error page.
 *   2. Not connected  -> "Connect Slack" starts the real OAuth redirect.
 *   3. Connected      -> shows the workspace, a "Send test message" button that
 *                        posts a real Slack message, and Disconnect.
 *
 * Disconnecting is presented as normal, not as an error: emails keep flowing and
 * only notifications stop (the worker logs "slack-not-connected" and continues).
 */
import { useState } from 'react';
import { useAsync } from '../hooks/useAsync';
import {
  disconnectSlack,
  fetchSlackStatus,
  sendSlackTest,
  startSlackConnect,
} from '../services/misc.api';
import { ApiError } from '../services/api';
import { useToast } from '../context/ToastContext';

/** Result of the OAuth round trip, read from ?slack=… by the layout. */
export type SlackRedirectResult =
  | 'connected'
  | 'denied'
  | 'failed'
  | 'invalid_state'
  | 'missing_code'
  | 'session_expired'
  | null;

interface SlackConnectionCardProps {
  redirectResult: SlackRedirectResult;
  onRedirectHandled: () => void;
}

const REDIRECT_ERRORS: Record<Exclude<SlackRedirectResult, null | 'connected'>, string> = {
  denied: 'Slack connection was cancelled.',
  failed: 'Slack could not complete the connection. Check the backend logs.',
  invalid_state: 'The Slack response failed a security check and was rejected. Please try again.',
  missing_code: 'Slack did not return an authorization code.',
  session_expired: 'Your session expired during the Slack redirect. Please sign in and try again.',
};

export function SlackConnectionCard({ redirectResult, onRedirectHandled }: SlackConnectionCardProps) {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync((signal) => fetchSlackStatus(signal), []);
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'test' | null>(null);

  const slack = data?.slack;

  // Report an OAuth failure exactly once, then mark it handled so a re-render does
  // not raise the same toast again.
  if (redirectResult && redirectResult !== 'connected') {
    toast.error('Slack was not connected', REDIRECT_ERRORS[redirectResult]);
    onRedirectHandled();
  }

  async function handleConnect(): Promise<void> {
    setBusy('connect');
    try {
      // The API returns the URL rather than redirecting, so a missing-credentials
      // 503 surfaces as a message instead of a dead browser tab.
      const { authorizeUrl } = await startSlackConnect();
      window.location.href = authorizeUrl;
    } catch (caught) {
      toast.error(
        'Could not start the Slack connection',
        caught instanceof ApiError ? caught.message : 'Unexpected error',
      );
      setBusy(null);
    }
  }

  async function handleDisconnect(): Promise<void> {
    setBusy('disconnect');
    try {
      await disconnectSlack();
      toast.info('Slack disconnected', 'Emails continue to send without notifications.');
      reload();
    } catch (caught) {
      toast.error('Could not disconnect Slack', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  async function handleTest(): Promise<void> {
    setBusy('test');
    try {
      await sendSlackTest();
      toast.success('Test message posted to Slack', 'Check the channel to confirm.');
    } catch (caught) {
      toast.error(
        'Slack could not deliver the message',
        caught instanceof ApiError ? caught.message : undefined,
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="slack-heading" className="rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="slack-heading" className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <SlackMark />
          Slack
        </h2>
        {slack?.connected ? (
          <span className="inline-flex items-center gap-1 rounded-pill bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            Connected
          </span>
        ) : null}
      </div>

      {/* ---- loading -------------------------------------------------------- */}
      {loading && !slack ? (
        <p className="mt-2 text-[11px] text-slate-400">Checking connection…</p>
      ) : null}

      {/* ---- load failure --------------------------------------------------- */}
      {error ? (
        <div className="mt-2">
          <p className="text-[11px] text-rose-600">{error}</p>
          <button
            type="button"
            onClick={reload}
            className="mt-1 text-[11px] font-medium text-slate-500 underline underline-offset-2"
          >
            Try again
          </button>
        </div>
      ) : null}

      {slack ? (
        <>
          {/* ---- state 1: this deployment has no Slack credentials ---------- */}
          {!slack.configured ? (
            <div className="mt-2">
              <p className="text-[11px] leading-relaxed text-amber-800">
                Not configured. Set <code className="font-mono">SLACK_CLIENT_ID</code> and{' '}
                <code className="font-mono">SLACK_CLIENT_SECRET</code> in backend/.env and restart the
                API (README → Slack OAuth Setup).
              </p>
              <button
                type="button"
                disabled
                title="Slack credentials are missing"
                className="mt-2 w-full cursor-not-allowed rounded-pill border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-400"
              >
                Connect Slack
              </button>
            </div>
          ) : null}

          {/* ---- state 2: connected ---------------------------------------- */}
          {slack.configured && slack.connected ? (
            <div className="mt-2 space-y-2">
              <p className="text-[11px] text-slate-500">
                {slack.teamName ?? 'Workspace'}
                {slack.channelName ? ` · #${slack.channelName}` : ''}
              </p>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleTest()}
                  disabled={busy !== null}
                  className="flex-1 rounded-pill border border-slate-200 px-2 py-1.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
                >
                  {busy === 'test' ? 'Sending…' : 'Send test'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDisconnect()}
                  disabled={busy !== null}
                  className="flex-1 rounded-pill border border-slate-200 px-2 py-1.5 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
                >
                  {busy === 'disconnect' ? 'Working…' : 'Disconnect'}
                </button>
              </div>
            </div>
          ) : null}

          {/* ---- state 3: configured but not connected ---------------------- */}
          {slack.configured && !slack.connected ? (
            <div className="mt-2">
              <p className="text-[11px] leading-relaxed text-slate-500">
                Get an alert when a sender reaches its hourly limit. Sending is unaffected either way.
              </p>
              <button
                type="button"
                onClick={() => void handleConnect()}
                disabled={busy !== null}
                className="mt-2 w-full rounded-pill border border-brand-600 px-3 py-1.5 text-[11px] font-semibold text-brand-700 transition-colors hover:bg-brand-50 disabled:opacity-50"
              >
                {busy === 'connect' ? 'Redirecting…' : 'Connect Slack'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** Slack's official mark, inlined so no external asset is requested. */
function SlackMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#E01E5A" d="M5.1 15.2a2.1 2.1 0 1 1-2.1-2.1h2.1v2.1Zm1 0a2.1 2.1 0 0 1 4.2 0v5.2a2.1 2.1 0 1 1-4.2 0v-5.2Z" />
      <path fill="#36C5F0" d="M8.8 5.1a2.1 2.1 0 1 1 2.1-2.1v2.1H8.8Zm0 1a2.1 2.1 0 0 1 0 4.2H3.6a2.1 2.1 0 1 1 0-4.2h5.2Z" />
      <path fill="#2EB67D" d="M18.9 8.8a2.1 2.1 0 1 1 2.1 2.1h-2.1V8.8Zm-1 0a2.1 2.1 0 0 1-4.2 0V3.6a2.1 2.1 0 1 1 4.2 0v5.2Z" />
      <path fill="#ECB22E" d="M15.2 18.9a2.1 2.1 0 1 1-2.1 2.1v-2.1h2.1Zm0-1a2.1 2.1 0 0 1 0-4.2h5.2a2.1 2.1 0 1 1 0 4.2h-5.2Z" />
    </svg>
  );
}
