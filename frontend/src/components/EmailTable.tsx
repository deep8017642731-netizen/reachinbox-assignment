/**
 * EmailTable — the scheduled and sent tables (same component, one flag).
 *
 * WHY ONE COMPONENT FOR BOTH VIEWS
 * The two tabs differ only in their columns and their empty-state wording. Two
 * components would mean two copies of the loading state, the error state, the
 * empty state and the row rendering — four chances for them to drift apart.
 *
 * ORDERING IS SHOWN, NOT ASSUMED: a scheduled batch is staggered by the configured
 * delay, and each row displays both its absolute time and "in 2 min", so the
 * scheduling order is visible on screen. That is the deterministic ordering the
 * backend guarantees (see README → Ordering).
 */
import { useState } from 'react';
import { Table, Pagination, type Column } from './ui/Table';
import { Badge, StatusBadge } from './ui/Badge';
import { Button } from './ui/Button';
import { EmptyState, ErrorState, TableSkeleton } from './ui/Feedback';
import { formatDateTime, formatRelativeFuture, formatRelativePast, truncate } from '../utils/format';
import type { EmailListItem } from '../types';

export type EmailTableVariant = 'scheduled' | 'sent';

interface EmailTableProps {
  variant: EmailTableVariant;
  emails: EmailListItem[];
  loading: boolean;
  error: string | null;
  errorStatus: number | null;
  onRetry: () => void;
  onCancel?: (email: EmailListItem) => Promise<void>;
  onCompose?: () => void;
  /** Present when the list came from a search rather than the default view. */
  searchQuery?: string;
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
}

export function EmailTable({
  variant,
  emails,
  loading,
  error,
  errorStatus,
  onRetry,
  onCancel,
  onCompose,
  searchQuery,
  page,
  totalPages,
  total,
  limit,
  onPageChange,
}: EmailTableProps) {
  // Which row's detail panel is open (only one at a time).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  /* ---- error state ------------------------------------------------------- */
  if (error) {
    return (
      <ErrorState
        message={error}
        onRetry={onRetry}
        hint={
          errorStatus === 503
            ? 'A dependency (database, Redis or Elasticsearch) is unavailable. Check GET /api/health.'
            : undefined
        }
      />
    );
  }

  /* ---- loading state ---------------------------------------------------- */
  if (loading && emails.length === 0) {
    return <TableSkeleton rows={6} columns={variant === 'scheduled' ? 4 : 3} />;
  }

  /* ---- empty state ------------------------------------------------------ */
  if (emails.length === 0) {
    if (searchQuery) {
      return (
        <EmptyState
          title="No emails matched your search"
          description={`Nothing found for “${searchQuery}”. Try a different word, part of an address, or check for typos — search is fuzzy, so “quaterly” still finds “quarterly”.`}
          icon={<SearchIcon />}
        />
      );
    }

    return variant === 'scheduled' ? (
      <EmptyState
        title="No emails scheduled yet"
        description="Upload a list of leads, set a start time, and this table will show every email waiting in the BullMQ delayed set."
        icon={<ClockIcon />}
        action={onCompose ? <Button onClick={onCompose}>Compose your first email</Button> : undefined}
      />
    ) : (
      <EmptyState
        title="Nothing sent yet"
        description="Once a scheduled email is delivered it appears here with its delivery time and an Ethereal preview link."
        icon={<SendIcon />}
      />
    );
  }

  /* ---- columns ---------------------------------------------------------- */
  const columns: Column<EmailListItem>[] = [
    {
      key: 'recipient',
      header: 'Email',
      className: 'min-w-[15rem]',
      render: (email) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-800">{email.recipient}</p>
          <p className="truncate text-xs text-slate-400">
            from {email.sender.displayName ?? email.sender.email}
          </p>
        </div>
      ),
    },
    {
      key: 'subject',
      header: 'Subject',
      className: 'hidden lg:table-cell min-w-[12rem]',
      render: (email) => (
        <span className="text-slate-600" title={email.subject}>
          {truncate(email.subject, 48)}
        </span>
      ),
    },
    variant === 'scheduled'
      ? {
          key: 'scheduledAt',
          header: 'Scheduled',
          className: 'w-52',
          render: (email) => (
            <div>
              <p className="text-slate-700">{formatDateTime(email.scheduledAt)}</p>
              {email.status === 'SCHEDULED' ? (
                <p className="text-xs text-slate-400">{formatRelativeFuture(email.scheduledAt)}</p>
              ) : null}
            </div>
          ),
        }
      : {
          key: 'sentAt',
          header: 'Sent',
          className: 'w-52',
          render: (email) => (
            <div>
              <p className="text-slate-700">{formatDateTime(email.sentAt ?? email.failedAt)}</p>
              {email.sentAt ? (
                <p className="text-xs text-slate-400">{formatRelativePast(email.sentAt)}</p>
              ) : null}
            </div>
          ),
        },
    {
      key: 'status',
      header: 'Status',
      className: 'w-40',
      render: (email) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={email.status} />
          {email.attempts > 1 ? (
            <span
              className="text-xs text-slate-400"
              title="How many times a worker has attempted this send"
            >
              {email.attempts} attempts
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'w-28 text-right',
      render: (email) => (
        <div className="flex items-center justify-end gap-1.5">
          {email.status === 'SENT' && email.previewUrl ? (
            <a
              href={email.previewUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
              title="Open this message in the Ethereal web inbox"
            >
              Preview
            </a>
          ) : null}

          {variant === 'scheduled' && onCancel && email.status === 'SCHEDULED' ? (
            <Button
              variant="danger"
              size="sm"
              loading={cancellingId === email.id}
              onClick={async () => {
                setCancellingId(email.id);
                try {
                  await onCancel(email);
                } finally {
                  setCancellingId(null);
                }
              }}
              title="Remove this email from the queue before it is sent"
            >
              Cancel
            </Button>
          ) : null}

          <button
            type="button"
            onClick={() => setExpandedId(expandedId === email.id ? null : email.id)}
            aria-expanded={expandedId === email.id}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="Show details"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d={expandedId === email.id ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <Table
        columns={columns}
        rows={emails}
        rowKey={(email) => email.id}
        expandedKey={expandedId}
        caption={variant === 'scheduled' ? 'Scheduled emails' : 'Sent emails'}
        rowClassName={(email) => (email.status === 'FAILED' ? 'bg-rose-50/40' : '')}
        renderExpanded={(email) => <EmailDetailPanel email={email} />}
      />

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={limit}
        onChange={onPageChange}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Expanded detail row                                                       */
/* -------------------------------------------------------------------------- */

function EmailDetailPanel({ email }: { email: EmailListItem }) {
  return (
    <div className="grid gap-4 text-xs lg:grid-cols-3">
      <div className="space-y-1">
        <DetailRow label="Batch" value={email.batchId} mono />
        <DetailRow label="Recipient" value={email.recipient} />
        <DetailRow
          label="Sequence in batch"
          value={`#${email.sequence + 1}`}
          title="Position in the original upload; also used to spread rate-limited emails"
        />
      </div>

      <div className="space-y-1">
        <DetailRow label="Scheduled for" value={formatDateTime(email.scheduledAt)} />
        <DetailRow label="Sent at" value={formatDateTime(email.sentAt)} />
        <DetailRow label="Attempts" value={String(email.attempts)} />
      </div>

      <div className="space-y-1">
        <p className="font-semibold text-slate-500">Body preview</p>
        <p className="whitespace-pre-wrap text-slate-600">{email.bodyPreview || '—'}</p>

        {email.errorMessage ? (
          <div className="mt-2">
            <Badge tone="error">Error</Badge>
            <p className="mt-1 break-words text-rose-700">{email.errorMessage}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  title?: string;
}) {
  return (
    <div className="flex gap-2" title={title}>
      <span className="w-32 shrink-0 font-semibold text-slate-500">{label}</span>
      <span className={`min-w-0 break-all text-slate-700 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  );
}

/* ---- local icons --------------------------------------------------------- */

function ClockIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 3 10.5 13.5M21 3l-6.5 18-4-8-8-4L21 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
