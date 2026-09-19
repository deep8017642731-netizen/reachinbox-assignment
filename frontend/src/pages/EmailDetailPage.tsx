/**
 * EmailDetailPage — a single email, laid out like AP4.
 *
 * Header: back arrow, the subject as the page title, and the actions that make
 * sense for this build. Body: sender avatar and address on the left, delivery
 * time on the right, "to me" recipient line, then the message.
 *
 * WHY THE TRASH ICON IS REAL AND THE STAR IS ABSENT
 * The frames show a star (favourite) and a trash can. Starring is not part of the
 * assignment and would need a database column and API — a star that only changed
 * colour in the browser would be a fake feature, so it is omitted rather than
 * faked. The trash icon IS real here: it maps to
 * POST /api/emails/:id/cancel and only appears while the email is still
 * cancellable. That is why it is labelled plainly ("Cancel") instead of being a
 * bare icon the user has to guess at.
 *
 * ATTACHMENTS: the frames show image attachments. This pipeline sends plain text
 * with no attachment support (no file storage, no multipart body), so there is no
 * attachment section. Documented in the README's known limitations.
 */
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import { useAsync } from '../hooks/useAsync';
import { cancelEmail } from '../services/emails.api';
import { api, ApiError } from '../services/api';
import { useToast } from '../context/ToastContext';
import { formatDateTime, formatRelativeFuture, formatRelativePast } from '../utils/format';
import type { EmailListItem } from '../types';

interface EmailDetailResponse {
  success: true;
  email: EmailListItem & { body: string; messageId: string | null };
}

export function EmailDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);

  const { data, loading, error, reload } = useAsync(
    (signal) => api.get<EmailDetailResponse>(`/api/emails/${id}`, { signal }),
    [id],
  );

  const email = data?.email;

  async function handleCancel(): Promise<void> {
    if (!email) return;
    setCancelling(true);
    try {
      await cancelEmail(email.id);
      toast.success('Email cancelled', `${email.recipient} will not receive this message.`);
      reload();
    } catch (caught) {
      toast.error('Could not cancel', caught instanceof ApiError ? caught.message : undefined);
      reload();
    } finally {
      setCancelling(false);
    }
  }

  /* ---- states ------------------------------------------------------------ */

  if (loading && !email) {
    return (
      <div className="mx-auto max-w-3xl animate-pulse px-6 py-10" aria-hidden="true">
        <div className="h-4 w-24 rounded bg-slate-200" />
        <div className="mt-4 h-7 w-2/3 rounded bg-slate-200" />
        <div className="mt-8 h-3 w-48 rounded bg-slate-100" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-3.5 rounded bg-slate-100" style={{ width: `${90 - index * 12}%` }} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !email) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 px-6 py-24 text-center">
        <p className="text-sm font-semibold text-slate-800">Could not open this email</p>
        <p className="max-w-md text-sm text-slate-500">{error ?? 'Email not found.'}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={reload}
            className="rounded-pill border border-slate-300 px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Try again
          </button>
          <Link
            to="/dashboard/scheduled"
            className="rounded-pill px-4 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50"
          >
            Back to list
          </Link>
        </div>
      </div>
    );
  }

  const senderInitial = (email.sender.displayName ?? email.sender.email).charAt(0).toUpperCase();
  const canCancel = email.status === 'SCHEDULED';

  return (
    <div className="min-h-full">
      {/* ---- header -------------------------------------------------------- */}
      <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="mt-0.5 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M19 12H5m0 0 6-6m-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900 sm:text-lg">
          {email.subject}
        </h1>

        <div className="flex shrink-0 items-center gap-1.5">
          {email.previewUrl ? (
            <a
              href={email.previewUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-pill border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              Ethereal preview
            </a>
          ) : null}

          {canCancel ? (
            <button
              type="button"
              onClick={() => void handleCancel()}
              disabled={cancelling}
              className="rounded-pill border border-slate-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50"
            >
              {cancelling ? 'Cancelling…' : 'Cancel email'}
            </button>
          ) : null}
        </div>
      </div>

      {/* ---- message ------------------------------------------------------- */}
      <article className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <header className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
            {senderInitial}
          </span>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              <span className="font-semibold text-slate-900">
                {email.sender.displayName ?? email.sender.email}
              </span>{' '}
              <span className="text-slate-400">&lt;{email.sender.email}&gt;</span>
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              to {email.recipient}
            </p>
          </div>

          <div className="shrink-0 text-right text-xs text-slate-400">
            <p>{formatDateTime(email.sentAt ?? email.scheduledAt)}</p>
            <p className="mt-0.5">
              {email.sentAt
                ? formatRelativePast(email.sentAt)
                : email.status === 'SCHEDULED'
                  ? formatRelativeFuture(email.scheduledAt)
                  : ''}
            </p>
          </div>
        </header>

        {/* ---- delivery state -------------------------------------------- */}
        <DeliveryState email={email} />

        {/* ---- body ------------------------------------------------------- */}
        <div className="mt-7 whitespace-pre-wrap text-[15px] leading-7 text-slate-800">
          {email.body || <span className="text-slate-400">(no body)</span>}
        </div>

        {/* ---- technical detail ------------------------------------------- */}
        <footer className="mt-10 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Delivery record
          </p>
          <dl className="mt-2 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
            <Detail label="Status" value={email.status} />
            <Detail label="Attempts" value={String(email.attempts)} />
            <Detail label="Scheduled for" value={formatDateTime(email.scheduledAt)} />
            <Detail label="Sent at" value={formatDateTime(email.sentAt)} />
            <Detail label="Batch" value={email.batchId} mono />
            <Detail label="Sequence in batch" value={`#${email.sequence + 1}`} />
            {email.messageId ? <Detail label="SMTP message id" value={email.messageId} mono /> : null}
          </dl>

          {email.errorMessage ? (
            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
              <p className="text-xs font-semibold text-rose-800">Delivery error</p>
              <p className="mt-0.5 break-words text-xs text-rose-700">{email.errorMessage}</p>
            </div>
          ) : null}

          <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
            {email.status === 'SCHEDULED'
              ? 'This email is waiting in the BullMQ delayed set in Redis. It will be sent without the API running.'
              : email.status === 'SENT'
                ? 'Delivered through Ethereal SMTP. The preview link above opens the message in the Ethereal test inbox.'
                : null}
          </p>
        </footer>
      </article>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Pieces                                                                    */
/* -------------------------------------------------------------------------- */

/** A one-line summary of where this email is in its lifecycle. */
function DeliveryState({ email }: { email: EmailListItem }) {
  const config = {
    SCHEDULED: { tone: 'bg-amber-50 text-amber-900 border-amber-100', text: 'Scheduled — waiting to be sent' },
    PROCESSING: { tone: 'bg-sky-50 text-sky-900 border-sky-100', text: 'Sending right now' },
    SENT: { tone: 'bg-brand-50 text-brand-800 border-brand-100', text: 'Delivered successfully' },
    FAILED: { tone: 'bg-rose-50 text-rose-900 border-rose-100', text: 'Delivery failed' },
    CANCELLED: { tone: 'bg-slate-50 text-slate-600 border-slate-100', text: 'Cancelled before sending' },
  }[email.status];

  return (
    <div className={`mt-5 rounded-lg border px-3.5 py-2 text-xs font-medium ${config.tone}`}>
      {config.text}
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-slate-400">{label}</dt>
      <dd className={`min-w-0 break-all text-slate-700 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}
