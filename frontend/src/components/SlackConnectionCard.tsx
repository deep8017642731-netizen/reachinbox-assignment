/**
 * SlackConnectionCard — connect / disconnect / test, with honest configuration state.
 *
 * THREE DISTINCT STATES, because collapsing them is how UIs end up lying:
 *
 *   1. Slack OAuth is not configured on this deployment
 *        -> the button is disabled and explains exactly which env vars are needed.
 *           It does NOT pretend to connect and it does NOT navigate the user into
 *           a JSON error page.
 *   2. Not connected  -> "Connect Slack" starts the real OAuth redirect.
 *   3. Connected      -> shows the workspace, a "Send test message" button that
 *                        posts a real message, and Disconnect.
 *
 * Disconnecting is presented as normal, not as an error: email keeps flowing and
 * only notifications stop (the backend logs "slack-not-connected" and continues).
 */
import { useState } from 'react';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Alert, Spinner } from './ui/Feedback';
import { useAsync } from '../hooks/useAsync';
import {
  disconnectSlack,
  fetchSlackStatus,
  sendSlackTest,
  startSlackConnect,
} from '../services/misc.api';
import { ApiError } from '../services/api';
import { useToast } from '../context/ToastContext';

/** Result of the OAuth round trip, read from ?slack=… by the dashboard. */
export type SlackRedirectResult =
  | 'connected'
  | 'denied'
  | 'failed'
  | 'invalid_state'
  | 'missing_code'
  | 'session_expired'
  | null;

interface SlackConnectionCardProps {
  /** Set when the user has just returned from Slack's consent screen. */
  redirectResult: SlackRedirectResult;
  onRedirectHandled: () => void;
}

export function SlackConnectionCard({ redirectResult, onRedirectHandled }: SlackConnectionCardProps) {
  const toast = useToast();
  const { data, loading, error, reload } = useAsync((signal) => fetchSlackStatus(signal), []);
  const [busy, setBusy] = useState<'connect' | 'disconnect' | 'test' | null>(null);

  const slack = data?.slack;

  // Report the outcome of an OAuth redirect exactly once.
  if (redirectResult && redirectResult !== 'connected') {
    const messages: Record<Exclude<SlackRedirectResult, null | 'connected'>, string> = {
      denied: 'Slack connection was cancelled.',
      failed: 'Slack could not complete the connection. Check the backend logs.',
      invalid_state: 'The Slack response failed a security check, so it was rejected. Please try again.',
      missing_code: 'Slack did not return an authorization code.',
      session_expired: 'Your session expired during the Slack redirect. Please sign in and try again.',
    };
    toast.error('Slack was not connected', messages[redirectResult]);
    onRedirectHandled();
  }

  async function handleConnect(): Promise<void> {
    setBusy('connect');
    try {
      // The API returns the URL rather than redirecting, so a missing-credentials
      // 503 shows up as a message instead of a dead browser tab.
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
      toast.error('Slack could not deliver the message', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setBusy(null);
    }
  }

  /* ---- loading / error -------------------------------------------------- */
  if (loading && !slack) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-5">
        <Spinner size={18} />
        <span className="text-sm text-slate-500">Checking Slack connection…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <Alert tone="error" title="Could not load the Slack status">
          {error}
        </Alert>
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={reload}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!slack) return null;

  const notConfigured = !slack.configured;

  return (
    <section
      aria-labelledby="slack-card-heading"
      className="rounded-xl border border-slate-200 bg-white p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="slack-card-heading" className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <SlackMark />
            Slack
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Real-time alerts when a sender reaches its hourly limit.
          </p>
        </div>

        {slack.connected ? <Badge tone="success">Connected</Badge> : null}
        {!slack.connected && !notConfigured ? <Badge tone="neutral">Not connected</Badge> : null}
      </div>

      {/* ---- state 1: this deployment has no Slack credentials ------------- */}
      {notConfigured ? (
        <div className="mt-4">
          <Alert tone="warning" title="Slack OAuth is not configured on this deployment">
            Set <code className="font-mono">SLACK_CLIENT_ID</code> and{' '}
            <code className="font-mono">SLACK_CLIENT_SECRET</code> in{' '}
            <code className="font-mono">backend/.env</code>, then restart the API. See README →
            “Slack OAuth Setup”.
          </Alert>
        </div>
      ) : null}

      {/* ---- state 2: connected ------------------------------------------- */}
      {slack.connected ? (
        <div className="mt-4 space-y-3">
          <dl className="grid gap-1 text-xs">
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-medium text-slate-500">Workspace</dt>
              <dd className="text-slate-700">{slack.teamName ?? '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-24 shrink-0 font-medium text-slate-500">Alert channel</dt>
              <dd className="text-slate-700">
                {slack.channelName ? `#${slack.channelName}` : 'First channel the app can see'}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={handleTest} loading={busy === 'test'}>
              Send test message
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDisconnect}
              loading={busy === 'disconnect'}
            >
              Disconnect
            </Button>
          </div>
        </div>
      ) : null}

      {/* ---- state 3: configured but not connected ------------------------- */}
      {!slack.connected && !notConfigured ? (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-slate-500">
            Emails are unaffected by connecting or disconnecting — Slack only changes whether you are
            notified.
          </p>
          <Button onClick={handleConnect} loading={busy === 'connect'}>
            Connect Slack
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Slack's official mark, inlined (no external asset request). */
function SlackMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#E01E5A"
        d="M5.1 15.2a2.1 2.1 0 1 1-2.1-2.1h2.1v2.1Zm1 0a2.1 2.1 0 0 1 4.2 0v5.2a2.1 2.1 0 1 1-4.2 0v-5.2Z"
      />
      <path
        fill="#36C5F0"
        d="M8.8 5.1a2.1 2.1 0 1 1 2.1-2.1v2.1H8.8Zm0 1a2.1 2.1 0 0 1 0 4.2H3.6a2.1 2.1 0 1 1 0-4.2h5.2Z"
      />
      <path
        fill="#2EB67D"
        d="M18.9 8.8a2.1 2.1 0 1 1 2.1 2.1h-2.1V8.8Zm-1 0a2.1 2.1 0 0 1-4.2 0V3.6a2.1 2.1 0 1 1 4.2 0v5.2Z"
      />
      <path
        fill="#ECB22E"
        d="M15.2 18.9a2.1 2.1 0 1 1-2.1 2.1v-2.1h2.1Zm0-1a2.1 2.1 0 0 1 0-4.2h5.2a2.1 2.1 0 1 1 0 4.2h-5.2Z"
      />
    </svg>
  );
}
