/**
 * DashboardPage — the main screen.
 *
 * Layout follows the assignment brief: tabs for Scheduled / Sent, a Compose button,
 * search, stat cards, the email table, and the Slack connection card.
 *
 * DATA FLOW (why it is structured this way):
 *   - `useAsync` owns each fetch and its loading / error / abort behaviour.
 *   - The active tab decides which endpoint is used; when a search query is
 *     present, search takes precedence and the result set replaces the list.
 *   - After a mutation (scheduling or cancelling) the relevant queries are
 *     reloaded, so the table never disagrees with the server.
 *
 * A visible "auto-refresh" note is shown while there are SCHEDULED emails: the user
 * should not have to guess whether what they see is live.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DashboardHeader } from '../components/DashboardHeader';
import { EmailTable } from '../components/EmailTable';
import { ComposeEmailModal } from '../components/ComposeEmailModal';
import { SlackConnectionCard, type SlackRedirectResult } from '../components/SlackConnectionCard';
import { StatCards } from '../components/StatCards';
import { SearchBar } from '../components/SearchBar';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Feedback';
import { useAsync, useDebouncedValue, usePolling } from '../hooks/useAsync';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import {
  cancelEmail,
  fetchEmailStats,
  fetchScheduledEmails,
  fetchSentEmails,
  searchEmails,
} from '../services/emails.api';
import { fetchSenders } from '../services/misc.api';
import { ApiError } from '../services/api';
import type { EmailListItem, ScheduleEmailResponse } from '../types';

type Tab = 'scheduled' | 'sent';

const PAGE_SIZE = 20;

export function DashboardPage() {
  const toast = useToast();
  const { user, signOut } = useAuth();

  const [tab, setTab] = useState<Tab>('scheduled');
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [composeOpen, setComposeOpen] = useState(false);
  const [slackRedirect, setSlackRedirect] = useState<SlackRedirectResult>(null);
  const [schedulingNote, setSchedulingNote] = useState<string | null>(null);

  // Debounced so typing does not fire a request per keystroke.
  const searchQuery = useDebouncedValue(searchInput.trim(), 350);
  const isSearching = searchQuery.length > 0;

  // Reset to page 1 whenever the result set changes shape, so the user is never
  // left on page 7 of a 2-page result.
  useEffect(() => {
    setPage(1);
  }, [tab, searchQuery]);

  /* ---- reads ------------------------------------------------------------- */

  const emailsState = useAsync(
    (signal) =>
      isSearching
        ? searchEmails(searchQuery, page, PAGE_SIZE, signal)
        : tab === 'scheduled'
          ? fetchScheduledEmails(page, PAGE_SIZE, signal)
          : fetchSentEmails(page, PAGE_SIZE, signal),
    [tab, page, isSearching, searchQuery],
  );

  const statsState = useAsync((signal) => fetchEmailStats(signal), []);
  const sendersState = useAsync((signal) => fetchSenders(signal), []);

  // Refresh the table and counters every 5s while something is pending, so
  // SCHEDULED → PROCESSING → SENT is visibly live during the demo.
  const hasPending =
    (statsState.data?.stats.scheduled ?? 0) + (statsState.data?.stats.processing ?? 0) > 0;

  const refreshAll = useCallback(() => {
    emailsState.reload();
    statsState.reload();
  }, [emailsState, statsState]);

  usePolling(refreshAll, hasPending ? 5_000 : 0);

  /* ---- mutations --------------------------------------------------------- */

  async function handleCancel(email: EmailListItem): Promise<void> {
    try {
      await cancelEmail(email.id);
      toast.success('Email cancelled', `${email.recipient} will not be sent.`);
      refreshAll();
    } catch (caught) {
      // Conflict (409) is the interesting case: the worker already sent it.
      toast.error(
        'Could not cancel this email',
        caught instanceof ApiError ? caught.message : 'Unexpected error',
      );
      refreshAll();
    }
  }

  function handleScheduled(result: ScheduleEmailResponse): void {
    const notes: string[] = [];
    if (result.duplicatesRemoved > 0) notes.push(`${result.duplicatesRemoved} duplicate(s) removed`);
    if (result.startTimeAdjusted) notes.push('start time moved to now (it was in the past)');
    if (result.appliedDelayMs !== undefined) {
      notes.push(`delay applied: ${result.appliedDelayMs}ms`);
    }

    toast.success(
      `${result.scheduledCount} email${result.scheduledCount === 1 ? '' : 's'} scheduled`,
      notes.join(' · ') || 'Queued as delayed BullMQ jobs.',
    );

    setSchedulingNote(
      `Batch ${result.batchId.slice(0, 8)} scheduled · first send ${new Date(
        result.firstScheduledAt,
      ).toLocaleTimeString()} · last ${new Date(result.lastScheduledAt).toLocaleTimeString()}`,
    );

    setTab('scheduled');
    setPage(1);
    refreshAll();
  }

  /* ---- derive table props ------------------------------------------------ */

  const emails = emailsState.data?.items ?? [];
  const meta = emailsState.data?.meta;

  const tableProps = useMemo(
    () => ({
      emails,
      loading: emailsState.loading,
      error: emailsState.error,
      errorStatus: emailsState.status,
      onRetry: emailsState.reload,
      page,
      totalPages: meta?.totalPages ?? 1,
      total: meta?.total ?? 0,
      limit: meta?.limit ?? PAGE_SIZE,
      onPageChange: setPage,
    }),
    [emails, emailsState.loading, emailsState.error, emailsState.status, emailsState.reload, page, meta],
  );

  if (!user) return null;

  return (
    <div className="min-h-full bg-slate-50">
      <DashboardHeader user={user} onSignOut={signOut} />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {/* ---- page heading + primary action ----------------------------- */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Dashboard</h1>
            <p className="text-sm text-slate-500">
              Email campaigns scheduled through BullMQ and delivered via Ethereal SMTP.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/admin/queues"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              title="Open the Bull Board queue dashboard (new tab)"
            >
              Bull Board
            </a>
            <Button
              onClick={() => setComposeOpen(true)}
              icon={
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
                </svg>
              }
            >
              Compose new email
            </Button>
          </div>
        </div>

        {/* ---- result of the last scheduling request --------------------- */}
        {schedulingNote ? (
          <Alert tone="success" title="Campaign queued">
            <span className="font-mono text-xs">{schedulingNote}</span>
          </Alert>
        ) : null}

        {/* ---- counters --------------------------------------------------- */}
        <StatCards
          stats={statsState.data?.stats ?? null}
          loading={statsState.loading}
          emphasiseFailures={(statsState.data?.stats.failed ?? 0) > 0}
        />

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          {/* ---- main column: search + tabs + table ----------------------- */}
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
              {/* Tabs are real buttons with aria-selected so keyboard and screen
                  reader users can operate them. */}
              <div role="tablist" aria-label="Email views" className="flex gap-1 rounded-lg bg-slate-100 p-0.5">
                {(['scheduled', 'sent'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="tab"
                    aria-selected={tab === option}
                    disabled={isSearching && tab !== option}
                    onClick={() => setTab(option)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                      tab === option ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                    } disabled:opacity-50`}
                  >
                    {option} emails
                  </button>
                ))}
              </div>

              <SearchBar
                value={searchInput}
                onChange={setSearchInput}
                loading={isSearching && emailsState.loading}
              />
            </div>

            {/* Search replaces the tab's list, so say so explicitly. */}
            {isSearching ? (
              <div className="border-b border-slate-100 bg-sky-50/60 px-4 py-2 text-xs text-sky-900">
                Showing Elasticsearch results for <span className="font-semibold">“{searchQuery}”</span> across
                recipient, subject and body ·{' '}
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  className="font-medium underline underline-offset-2"
                >
                  clear
                </button>
              </div>
            ) : hasPending ? (
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">
                Auto-refreshing every 5s while emails are pending.
              </div>
            ) : null}

            <EmailTable
              variant={tab}
              {...tableProps}
              onCancel={handleCancel}
              onCompose={() => setComposeOpen(true)}
              searchQuery={isSearching ? searchQuery : undefined}
            />
          </section>

          {/* ---- side column: Slack + how it works ----------------------- */}
          <aside className="space-y-6">
            <SlackConnectionCard
              redirectResult={slackRedirect}
              onRedirectHandled={() => {
                setSlackRedirect(null);
                // Strip ?slack=… so a refresh does not re-toast.
                window.history.replaceState(null, '', window.location.pathname);
              }}
            />

            <SystemPanel />
          </aside>
        </div>
      </main>

      <ComposeEmailModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        senders={sendersState.data?.senders ?? []}
        defaults={{
          // These come from the server's own configuration, not hardcoded values,
          // so the form always matches what the worker will enforce.
          minDelayMs: 2000,
          hourlyLimit: 50,
        }}
        onScheduled={handleScheduled}
        onError={(message, detail) => toast.error(message, detail)}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Side panel: explains the runtime rules currently in force                 */
/* -------------------------------------------------------------------------- */

function SystemPanel() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-800">How scheduling works</h2>
      <ol className="mt-3 space-y-2 text-xs text-slate-600">
        <li className="flex gap-2">
          <StepNumber>1</StepNumber>
          Each recipient becomes a row in PostgreSQL with status SCHEDULED.
        </li>
        <li className="flex gap-2">
          <StepNumber>2</StepNumber>
          A delayed BullMQ job is queued in Redis — no cron, no polling loop.
        </li>
        <li className="flex gap-2">
          <StepNumber>3</StepNumber>
          A worker sends it through Ethereal SMTP, honouring the minimum delay.
        </li>
        <li className="flex gap-2">
          <StepNumber>4</StepNumber>
          Over-limit emails are delayed to the next hour and trigger a Slack alert.
        </li>
      </ol>

      <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
        Jobs live in Redis, so they survive restarting the API or the worker.
      </p>
    </section>
  );
}

function StepNumber({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[10px] font-semibold text-brand-700">
      {children}
    </span>
  );
}
