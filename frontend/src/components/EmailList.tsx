/**
 * EmailList — the row list from the Figma frames.
 *
 * Row anatomy (per the design):
 *   To: name · [status pill] · **Subject** - grey preview · actions
 *
 * WHY A LIST AND NOT A DATA TABLE
 * The frames use a conversational, email-client row rather than columns with
 * headers. It suits the content better (a subject and a preview read as a
 * sentence) and it is the layout the assignment asks to match. The trade-off is
 * that fixed column comparison is lost — which is why each row carries its own
 * "To:" label and status pill instead of relying on a header row.
 *
 * STATUS PILLS ARE COLOUR-CODED **AND** ICONOGRAPHIC
 * Colour alone fails for the ~8% of men with red/green colour blindness, who
 * could not tell a green "Sent" from an amber "Scheduled". Each state also has a
 * distinct icon and word, so the meaning survives without colour.
 */
import { Link } from 'react-router-dom';
import type { EmailListItem } from '../types';
import { formatDateTime, formatRelativeFuture, truncate } from '../utils/format';

interface EmailListProps {
  emails: EmailListItem[];
  loading: boolean;
  error: string | null;
  errorStatus: number | null;
  onRetry: () => void;
  /** Present when the results came from a search rather than a nav tab. */
  searchQuery?: string | undefined;
  /** Only scheduled emails can be cancelled. */
  onCancel?: ((email: EmailListItem) => Promise<void>) | undefined;
  cancellingId?: string | null;
  /** Which nav tab is active, so the empty state can be worded correctly. */
  variant: 'scheduled' | 'sent';
  onCompose: () => void;
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function EmailList({
  emails,
  loading,
  error,
  errorStatus,
  onRetry,
  searchQuery,
  onCancel,
  cancellingId,
  variant,
  onCompose,
  page,
  totalPages,
  total,
  onPageChange,
}: EmailListProps) {
  /* ---- error ------------------------------------------------------------- */
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-rose-500">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800">Could not load your emails</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{error}</p>
          {errorStatus === 503 ? (
            <p className="mx-auto mt-1 max-w-md text-xs text-slate-400">
              A dependency is unavailable. Scheduling and sending are unaffected — check the status
              strip at the top of the page.
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-pill border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
        >
          Try again
        </button>
      </div>
    );
  }

  /* ---- loading ----------------------------------------------------------- */
  if (loading && emails.length === 0) {
    return (
      <div className="animate-pulse" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 border-b border-slate-100 px-6 py-5">
            <div className="h-3.5 w-28 rounded bg-slate-200" />
            <div className="h-6 w-32 rounded-pill bg-slate-100" />
            <div className="h-3.5 flex-1 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    );
  }

  /* ---- empty ------------------------------------------------------------- */
  if (emails.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          {variant === 'scheduled' ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M21 3 10.5 13.5M21 3l-6.5 18-4-8-8-4L21 3Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>

        <div>
          <p className="text-sm font-semibold text-slate-800">
            {searchQuery
              ? 'No emails matched your search'
              : variant === 'scheduled'
                ? 'No emails scheduled yet'
                : 'Nothing sent yet'}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
            {searchQuery ? (
              <>
                Nothing found for “{searchQuery}”. Search is fuzzy, so “quaterly” still finds
                “quarterly” — but a completely different word will not match.
              </>
            ) : variant === 'scheduled' ? (
              'Upload a list of leads, choose a start time, and every email will wait here as a delayed BullMQ job.'
            ) : (
              'Delivered emails appear here with their send time and an Ethereal preview link.'
            )}
          </p>
        </div>

        {!searchQuery && variant === 'scheduled' ? (
          <button
            type="button"
            onClick={onCompose}
            className="rounded-pill bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-700"
          >
            Compose your first email
          </button>
        ) : null}
      </div>
    );
  }

  /* ---- rows -------------------------------------------------------------- */
  return (
    <div>
      <ul className="divide-y divide-slate-100">
        {emails.map((email) => (
          <EmailRow
            key={email.id}
            email={email}
            onCancel={onCancel}
            cancelling={cancellingId === email.id}
          />
        ))}
      </ul>

      <PaginationBar page={page} totalPages={totalPages} total={total} onChange={onPageChange} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  One row                                                                   */
/* -------------------------------------------------------------------------- */

function EmailRow({
  email,
  onCancel,
  cancelling,
}: {
  email: EmailListItem;
  onCancel?: ((email: EmailListItem) => Promise<void>) | undefined;
  cancelling: boolean;
}) {
  return (
    <li className="group flex items-center gap-4 px-4 py-4 transition-colors hover:bg-surface-muted sm:px-6">
      {/* "To:" — carried per row because there is no column header. */}
      <Link to={`/dashboard/emails/${email.id}`} className="flex min-w-0 flex-1 items-center gap-4">
        <span className="w-28 shrink-0 truncate text-sm text-slate-500 sm:w-40">
          To: <span className="text-slate-700">{email.recipient}</span>
        </span>

        <StatusPill email={email} />

        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="font-semibold text-slate-900">{email.subject}</span>
          <span className="text-slate-400"> - {truncate(email.bodyPreview, 90)}</span>
        </span>
      </Link>

      {/* Actions appear on hover/focus to keep the row calm, but are always
          reachable with the keyboard (group-focus-within). */}
      <span className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {email.status === 'SENT' && email.previewUrl ? (
          <a
            href={email.previewUrl}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(event) => event.stopPropagation()}
            title="Open this message in the Ethereal web inbox"
            className="rounded-pill border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-white"
          >
            Preview
          </a>
        ) : null}

        {email.status === 'SCHEDULED' && onCancel ? (
          <button
            type="button"
            disabled={cancelling}
            onClick={() => void onCancel(email)}
            title="Remove this email from the queue before it is sent"
            className="rounded-pill border border-slate-200 px-3 py-1 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        ) : null}
      </span>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/*  Status pill                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Renders the amber "Tue 9:15:12 AM" pill for scheduled mail and the neutral
 * "Sent" pill for delivered mail, exactly as the frames show.
 */
function StatusPill({ email }: { email: EmailListItem }) {
  if (email.status === 'SCHEDULED') {
    return (
      <span
        title={`Scheduled for ${formatDateTime(email.scheduledAt)} — ${formatRelativeFuture(email.scheduledAt)}`}
        className="flex w-40 shrink-0 items-center gap-1.5 rounded-pill bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2" />
          <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span className="truncate">{formatScheduledPill(email.scheduledAt)}</span>
      </span>
    );
  }

  if (email.status === 'PROCESSING') {
    return (
      <span className="flex w-40 shrink-0 items-center gap-1.5 rounded-pill bg-sky-100 px-3 py-1 text-xs font-medium text-sky-800">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden="true">
          <circle className="opacity-30" cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.6" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
        Sending…
      </span>
    );
  }

  if (email.status === 'FAILED') {
    return (
      <span
        title={email.errorMessage ?? 'Delivery failed'}
        className="flex w-40 shrink-0 items-center gap-1.5 rounded-pill bg-rose-100 px-3 py-1 text-xs font-medium text-rose-800"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
        Failed
      </span>
    );
  }

  if (email.status === 'CANCELLED') {
    return (
      <span className="flex w-40 shrink-0 items-center gap-1.5 rounded-pill bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
        Cancelled
      </span>
    );
  }

  // SENT — neutral pill with the send time, matching the "Sent" pill in the frames.
  return (
    <span
      title={formatDateTime(email.sentAt)}
      className="flex w-40 shrink-0 items-center gap-1.5 rounded-pill bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M21 3 10.5 13.5M21 3l-6.5 18-4-8-8-4L21 3Z"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Sent
    </span>
  );
}

/**
 * Compact date for the pill, e.g. "Tue 9:15:12 AM" — the format the frames use.
 * Falls back to a full date when the email is not scheduled today, so a pill is
 * never ambiguous about which day it refers to.
 */
function formatScheduledPill(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow =
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate();

  const time = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);

  if (sameDay) {
    // The design shows a weekday even for today, so keep that shape.
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(date);
    return `${weekday} ${time}`;
  }
  if (isTomorrow) return `Tmrw ${time}`;

  const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date);
  return `${day} ${time}`;
}

/* -------------------------------------------------------------------------- */
/*  Pagination                                                                */
/* -------------------------------------------------------------------------- */

function PaginationBar({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total === 0) return null;

  return (
    <div className="flex flex-col items-center gap-2 py-6">
      {totalPages > 1 ? (
        <div className="flex items-center gap-3 rounded-pill bg-slate-100 px-2.5 py-1.5">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onChange(page - 1)}
            aria-label="Previous page"
            className="rounded p-1 text-slate-500 transition-colors hover:text-slate-900 disabled:text-slate-300"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <span className="text-xs font-medium tabular-nums text-slate-600">
            {page} / {totalPages}
          </span>

          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onChange(page + 1)}
            aria-label="Next page"
            className="rounded p-1 text-slate-500 transition-colors hover:text-slate-900 disabled:text-slate-300"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      ) : null}

      <p className="text-[11px] text-slate-400">
        {total} email{total === 1 ? '' : 's'} in total
      </p>
    </div>
  );
}
