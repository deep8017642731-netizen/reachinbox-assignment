/**
 * EmailsPage — the Scheduled list and the Sent list (AP2 and P3).
 *
 * One component serves both routes because the two frames differ only in the
 * endpoint they read and the wording of their empty state. Duplicating it would
 * mean maintaining the loading, error, empty and pagination behaviour twice.
 *
 * SEARCH OVERRIDES THE TAB
 * When the top bar holds a query, this page reads from
 * GET /api/emails/search instead of the tab's endpoint. Search spans the user's
 * whole mailbox (scheduled *and* sent), which is what an email-style search field
 * implies; the page says so in a small banner so the result set is never
 * mysterious.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmailList } from '../components/EmailList';
import { useDashboardContext } from '../layouts/DashboardLayout';
import { useAsync, usePolling } from '../hooks/useAsync';
import {
  cancelEmail,
  fetchScheduledEmails,
  fetchSentEmails,
  searchEmails,
} from '../services/emails.api';
import { ApiError } from '../services/api';
import { useToast } from '../context/ToastContext';
import type { EmailListItem } from '../types';

const PAGE_SIZE = 12;

export function EmailsPage({ variant }: { variant: 'scheduled' | 'sent' }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { searchQuery, refreshToken, requestRefresh } = useDashboardContext();

  const [page, setPage] = useState(1);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const isSearching = searchQuery.length > 0;

  // Any change to the result set shape returns to page 1, so the user is never
  // stranded on page 7 of a two-page result.
  useEffect(() => {
    setPage(1);
  }, [variant, searchQuery]);

  const state = useAsync(
    (signal) =>
      isSearching
        ? searchEmails(searchQuery, page, PAGE_SIZE, signal)
        : variant === 'scheduled'
          ? fetchScheduledEmails(page, PAGE_SIZE, signal)
          : fetchSentEmails(page, PAGE_SIZE, signal),
    [variant, page, isSearching, searchQuery, refreshToken],
  );

  const emails: EmailListItem[] = state.data?.items ?? [];
  const meta = state.data?.meta;

  const hasPending = variant === 'scheduled' && emails.some((email) => email.status === 'SCHEDULED');

  // Live updates while emails are still queued, so SCHEDULED → PROCESSING → SENT
  // is visible during a demo. This refreshes a VIEW; email timing is owned
  // entirely by BullMQ delayed jobs in Redis (see hooks/usePolling.ts).
  usePolling(state.reload, hasPending ? 5_000 : 0);

  const handleCancel = useCallback(
    async (email: EmailListItem): Promise<void> => {
      setCancellingId(email.id);
      try {
        await cancelEmail(email.id);
        toast.success('Email cancelled', `${email.recipient} will not be sent.`);
      } catch (error) {
        // A 409 means the worker got there first — worth saying plainly.
        toast.error('Could not cancel this email', error instanceof ApiError ? error.message : undefined);
      } finally {
        setCancellingId(null);
        state.reload();
        requestRefresh();
      }
    },
    [toast, state, requestRefresh],
  );

  const searchBanner = useMemo(
    () =>
      isSearching ? (
        <div className="border-b border-slate-100 bg-brand-50/60 px-4 py-2 text-xs text-brand-900 sm:px-6">
          Searching <span className="font-semibold">“{searchQuery}”</span> across recipient, subject
          and body of all your emails (Elasticsearch). Fuzzy matching is on, so typos still match.
        </div>
      ) : null,
    [isSearching, searchQuery],
  );

  return (
    <div>
      {searchBanner}

      <EmailList
        emails={emails}
        loading={state.loading}
        error={state.error}
        errorStatus={state.status}
        onRetry={state.reload}
        searchQuery={isSearching ? searchQuery : undefined}
        onCancel={handleCancel}
        cancellingId={cancellingId}
        variant={variant}
        onCompose={() => navigate('/dashboard/compose')}
        page={page}
        totalPages={meta?.totalPages ?? 1}
        total={meta?.total ?? 0}
        onPageChange={setPage}
      />
    </div>
  );
}
