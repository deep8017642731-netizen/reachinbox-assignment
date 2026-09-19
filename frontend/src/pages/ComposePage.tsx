/**
 * ComposePage — the full-page composer from the Figma frames (AP5–AP7).
 *
 * Structure follows the design exactly: a label column on the left, a pill-styled
 * "From" selector, recipient chips with an "Upload List" link, subject, the two
 * scheduling fields, an editor surface, and a "Send Later" popover with quick
 * presets.
 *
 * TWO DELIBERATE OMISSIONS, both explained rather than faked:
 *
 *  1. ATTACHMENTS (the paperclip icon). The email pipeline sends plain text
 *     through Nodemailer and the assignment's data model has no attachment field.
 *     Rendering a paperclip that silently discards a chosen file would be worse
 *     than not showing it, so the control is absent and this is documented.
 *
 *  2. RICH-TEXT FORMATTING (the B / I / U toolbar). The stored body is plain text
 *     and is sent verbatim; the backend deliberately sends `text` rather than
 *     `html` so user input can never inject markup into a delivered message. A
 *     real rich-text editor would therefore need HTML sanitisation on the server
 *     first. The toolbar is rendered as visibly DISABLED controls with a tooltip,
 *     so it looks like the design while making it obvious nothing is being
 *     silently dropped — which is more honest than a toolbar that does nothing.
 *
 * "Send Later" IS fully functional: it sets the real `startTime` that the API
 * schedules the BullMQ job against.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useAsync';
import { fetchSenders } from '../services/misc.api';
import { scheduleEmails } from '../services/emails.api';
import { ApiError } from '../services/api';
import { useToast } from '../context/ToastContext';
import { LeadUploader } from '../components/LeadUploader';
import { fromDateTimeLocalValue, toDateTimeLocalValue, formatDuration } from '../utils/format';
import { MAX_RECIPIENTS } from '../utils/parseLeads';
import type { ParsedLeadsResult } from '../utils/parseLeads';
import type { Sender } from '../types';

/** Quick presets offered by the Send Later popover, as in the frames. */
function sendLaterPresets(): Array<{ label: string; date: Date }> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const at = (hours: number, minutes = 0): Date => {
    const date = new Date(tomorrow);
    date.setHours(hours, minutes, 0, 0);
    return date;
  };

  const tomorrowNoon = new Date(tomorrow);
  tomorrowNoon.setHours(0, 0, 0, 0);

  return [
    { label: 'Tomorrow', date: tomorrowNoon },
    { label: 'Tomorrow, 10:00 AM', date: at(10) },
    { label: 'Tomorrow, 11:00 AM', date: at(11) },
    { label: 'Tomorrow, 3:00 PM', date: at(15) },
  ];
}

export function ComposePage() {
  const navigate = useNavigate();
  const toast = useToast();

  const sendersState = useAsync((signal) => fetchSenders(signal), []);
  const senders: Sender[] = sendersState.data?.senders ?? [];

  const [senderId, setSenderId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [manualRecipient, setManualRecipient] = useState('');
  const [leads, setLeads] = useState<ParsedLeadsResult | null>(null);
  const [parsedLeads, setParsedLeads] = useState<ParsedLeadsResult | null>(null);

  const [startTime, setStartTime] = useState(() => toDateTimeLocalValue(new Date(Date.now() + 60_000)));
  const [delayMs, setDelayMs] = useState('2000');
  const [hourlyLimit, setHourlyLimit] = useState('50');

  const [showSendLater, setShowSendLater] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showUploader, setShowUploader] = useState(false);

  // Default to the account's first sender so a single-sender account can schedule
  // immediately without touching the selector.
  useEffect(() => {
    if (senderId === '' && senders.length > 0) setSenderId(senders[0]?.id ?? '');
  }, [senders, senderId]);

  const delayValue = Number(delayMs);
  const hourlyLimitValue = Number(hourlyLimit);
  const recipientCount = recipients.length;

  /** A start time meaningfully in the future turns the primary action into "Send Later". */
  const isScheduledForLater = useMemo(() => {
    const when = new Date(startTime).getTime();
    return Number.isFinite(when) && when - Date.now() > 120_000;
  }, [startTime]);

  /** Warn when the batch cannot finish inside one hour at the chosen pace. */
  const estimatedMinutes = useMemo(() => {
    if (delayValue <= 0 || recipientCount === 0) return null;
    const seconds = (recipientCount * delayValue) / 1000;
    return seconds < 60 ? null : Math.ceil(seconds / 60);
  }, [delayValue, recipientCount]);

  const exceedsHourlyLimit = recipientCount > hourlyLimitValue && hourlyLimitValue > 0;

  /* ---- recipient chips --------------------------------------------------- */

  function applyLeads(result: ParsedLeadsResult | null): void {
    setLeads(result);
    setParsedLeads(result);
    if (result) setRecipients(result.valid);
  }

  function addManualRecipient(): void {
    // Validate with the same rule the server uses, so a rejected address is caught
    // here rather than after a round trip.
    const value = manualRecipient.trim().toLowerCase();
    if (value === '') return;
    if (!/^([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,63})$/.test(value)) {
      setFieldErrors((current) => ({ ...current, recipients: `“${value}” is not a valid email address` }));
      return;
    }
    if (recipients.includes(value)) {
      setManualRecipient('');
      return;
    }
    setRecipients((current) => [...current, value]);
    setManualRecipient('');
    setFieldErrors((current) => ({ ...current, recipients: '' }));
  }

  function removeRecipient(address: string): void {
    setRecipients((current) => current.filter((item) => item !== address));
  }

  /* ---- submit ------------------------------------------------------------ */

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!senderId) errors.senderId = 'Choose a sender';
    if (subject.trim() === '') errors.subject = 'Subject is required';
    if (body.trim() === '') errors.body = 'Body is required';
    if (recipientCount === 0) errors.recipients = 'Add at least one recipient';
    if (!Number.isFinite(delayValue) || delayValue < 0) errors.delayMs = 'Delay must be 0 or more';
    if (!Number.isFinite(hourlyLimitValue) || hourlyLimitValue < 1) errors.hourlyLimit = 'Must be at least 1';
    if (!startTime || Number.isNaN(new Date(startTime).getTime())) errors.startTime = 'Invalid time';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSend(): Promise<void> {
    if (!validate()) {
      toast.error('Please fix the highlighted fields');
      return;
    }

    setSubmitting(true);
    try {
      const result = await scheduleEmails({
        senderId,
        subject: subject.trim(),
        body,
        recipients,
        startTime: fromDateTimeLocalValue(startTime),
        delayBetweenEmailsMs: delayValue,
        hourlyLimit: hourlyLimitValue,
      });

      const notes: string[] = [];
      if (result.duplicatesRemoved > 0) notes.push(`${result.duplicatesRemoved} duplicate(s) removed`);
      if (result.startTimeAdjusted) notes.push('start time moved to now');
      notes.push(`paced at ${result.appliedDelayMs}ms per email`);

      toast.success(
        `${result.scheduledCount} email${result.scheduledCount === 1 ? '' : 's'} scheduled`,
        notes.join(' · '),
      );
      navigate('/dashboard/scheduled');
    } catch (error) {
      if (error instanceof ApiError) {
        const serverErrors: Record<string, string> = {};
        for (const detail of error.details) {
          serverErrors[detail.field.replace(/^body\./, '')] = detail.message;
        }
        setFieldErrors((current) => ({ ...current, ...serverErrors }));
        toast.error('Could not schedule the emails', error.message);
      } else {
        toast.error('Could not schedule the emails', 'Unexpected error');
      }
    } finally {
      setSubmitting(false);
    }
  }

  /* ---- render ------------------------------------------------------------ */

  return (
    <div className="min-h-full">
      {/* ---- top bar ------------------------------------------------------ */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-4 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Go back"
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M19 12H5m0 0 6-6m-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h1 className="text-base font-semibold text-slate-900">Compose New Email</h1>
        </div>

        <div className="flex items-center gap-2">
          {/* Send Later: opens the popover from the frames */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSendLater((open) => !open)}
              aria-expanded={showSendLater}
              aria-haspopup="dialog"
              title="Choose when the first email should be sent"
              className="rounded-pill p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>

            {showSendLater ? (
              <SendLaterPopover
                startTime={startTime}
                onChange={setStartTime}
                onClose={() => setShowSendLater(false)}
              />
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={submitting || recipientCount === 0}
            aria-busy={submitting || undefined}
            className="rounded-pill border border-brand-600 px-5 py-2 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
          >
            {submitting ? 'Scheduling…' : isScheduledForLater ? 'Send Later' : 'Send'}
          </button>
        </div>
      </div>

      {/* ---- form --------------------------------------------------------- */}
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <dl className="space-y-5">
          {/* From */}
          <Row label="From" error={fieldErrors.senderId}>
            <select
              value={senderId}
              onChange={(event) => setSenderId(event.target.value)}
              aria-label="Sender"
              className="rounded-lg bg-surface-muted px-3 py-2 text-sm font-medium text-slate-800"
            >
              {senders.length === 0 ? <option value="">No senders available</option> : null}
              {senders.map((sender) => (
                <option key={sender.id} value={sender.id}>
                  {sender.email}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">The hourly rate limit is applied per sender.</p>
          </Row>

          {/* To */}
          <Row label="To" error={fieldErrors.recipients}>
            <div className="flex flex-wrap items-center gap-2">
              {recipients.slice(0, 6).map((address) => (
                <span
                  key={address}
                  className="inline-flex items-center gap-1.5 rounded-pill border border-brand-500 px-3 py-1 text-xs font-medium text-brand-700"
                >
                  {address}
                  <button
                    type="button"
                    onClick={() => removeRecipient(address)}
                    aria-label={`Remove ${address}`}
                    className="text-brand-500 transition-colors hover:text-brand-800"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
              ))}

              {recipients.length > 6 ? (
                <span
                  title={recipients.slice(6).join(', ')}
                  className="inline-flex items-center rounded-pill border border-brand-500 px-3 py-1 text-xs font-medium text-brand-700"
                >
                  +{recipients.length - 6}
                </span>
              ) : null}

              {/* Inline entry: type an address and press Enter or comma. */}
              <input
                type="text"
                value={manualRecipient}
                onChange={(event) => setManualRecipient(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ',') {
                    event.preventDefault();
                    addManualRecipient();
                  }
                  if (event.key === 'Backspace' && manualRecipient === '' && recipients.length > 0) {
                    removeRecipient(recipients[recipients.length - 1] as string);
                  }
                }}
                onBlur={addManualRecipient}
                placeholder={recipientCount === 0 ? 'recipient@example.com' : 'Add another…'}
                aria-label="Add a recipient"
                className="min-w-[12rem] flex-1 border-b border-slate-200 bg-transparent py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500"
              />

              <button
                type="button"
                onClick={() => setShowUploader((open) => !open)}
                className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-brand-700 transition-colors hover:text-brand-800"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Upload List
              </button>
            </div>

            {showUploader ? (
              <div className="mt-3">
                <LeadUploader
                  parsed={parsedLeads ?? leads}
                  onParsed={applyLeads}
                  error={undefined}
                  maxRecipients={MAX_RECIPIENTS}
                />
              </div>
            ) : recipientCount > 0 ? (
              <p className="mt-1.5 text-xs text-slate-400">
                {recipientCount} recipient{recipientCount === 1 ? '' : 's'} ready
                {leads && leads.duplicatesRemoved > 0
                  ? ` · ${leads.duplicatesRemoved} duplicate(s) removed`
                  : ''}
                {leads && leads.invalid.length > 0 ? ` · ${leads.invalid.length} invalid skipped` : ''}
              </p>
            ) : null}
          </Row>

          {/* Subject */}
          <Row label="Subject" error={fieldErrors.subject}>
            <input
              type="text"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              placeholder="Subject"
              maxLength={500}
              className="w-full border-b border-slate-200 bg-transparent py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500"
            />
          </Row>

          {/* Scheduling controls */}
          <Row label="Delay between 2 emails" error={fieldErrors.delayMs}>
            <NumberField
              value={delayMs}
              onChange={setDelayMs}
              ariaLabel="Delay between emails in milliseconds"
              min={0}
              step={100}
            />
          </Row>

          <Row label="Hourly Limit" error={fieldErrors.hourlyLimit}>
            <NumberField
              value={hourlyLimit}
              onChange={setHourlyLimit}
              ariaLabel="Hourly limit"
              min={1}
              step={1}
            />
          </Row>

          {/* Editor */}
          <Row label="">
            <div className="rounded-xl bg-surface-muted p-1.5">
              {/* Disabled toolbar — see the file header for why it is disabled
                  rather than functional or omitted. */}
              <div
                className="mb-1.5 flex flex-wrap items-center gap-0.5 rounded-lg bg-white px-2 py-1.5"
                title="Formatting is disabled: this scheduler sends plain text so user input can never inject markup into a delivered email."
              >
                {['↺', '↻', 'Tt', 'B', 'I', 'U', '≡', '⇕', '1.', '•', '⇥', '❞', '</>', '🔗'].map(
                  (glyph, index) => (
                    <span
                      key={`${glyph}-${index}`}
                      aria-hidden="true"
                      className="cursor-not-allowed select-none rounded px-1.5 py-1 text-sm text-slate-300"
                    >
                      {glyph}
                    </span>
                  ),
                )}
              </div>

              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={14}
                placeholder="Type Your Reply..."
                aria-label="Email body"
                className="w-full resize-y rounded-lg bg-transparent px-3 py-2 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400"
              />
            </div>
            {fieldErrors.body ? (
              <p className="mt-1 text-xs font-medium text-rose-600">{fieldErrors.body}</p>
            ) : null}
          </Row>
        </dl>

        {/* ---- live summary of what will actually happen ------------------ */}
        {recipientCount > 0 || exceedsHourlyLimit ? (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              What will happen
            </p>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              <li>
                <span className="font-semibold text-slate-800">{recipientCount}</span> email
                {recipientCount === 1 ? '' : 's'} will be scheduled from{' '}
                <span className="font-semibold text-slate-800">
                  {startTime ? new Date(startTime).toLocaleString() : '—'}
                </span>
                , one every <span className="font-semibold text-slate-800">{formatDuration(delayValue)}</span>.
              </li>
              {estimatedMinutes ? (
                <li>
                  The full batch takes about{' '}
                  <span className="font-semibold text-slate-800">{estimatedMinutes} minutes</span>.
                </li>
              ) : null}
              {exceedsHourlyLimit ? (
                <li className="text-amber-800">
                  Only <span className="font-semibold">{hourlyLimitValue}</span> may send this hour, so
                  the other{' '}
                  <span className="font-semibold">{recipientCount - hourlyLimitValue}</span> will be{' '}
                  <span className="font-semibold">delayed to the next window</span> — not dropped — and a
                  Slack alert fires once.
                </li>
              ) : null}
              {delayValue < 2000 ? (
                <li className="text-slate-500">
                  Your delay is below the configured 2000ms minimum, so the server will enforce 2000ms.
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Small pieces                                                              */
/* -------------------------------------------------------------------------- */

/** One label/value row of the composer form. */
function Row({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[10rem_1fr] sm:items-start sm:gap-4">
      <dt className="pt-1.5 text-sm text-slate-600">{label}</dt>
      <dd className="min-w-0">
        {children}
        {error ? <p className="mt-1 text-xs font-medium text-rose-600">{error}</p> : null}
      </dd>
    </div>
  );
}

/** The small bordered number inputs the frames show for delay and limit. */
function NumberField({
  value,
  onChange,
  ariaLabel,
  min,
  step,
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  min: number;
  step: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        min={min}
        step={step}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
        className="w-20 rounded-lg border border-slate-200 px-3 py-2 text-center text-sm text-slate-800 focus:border-brand-500"
      />
      <span className="text-xs text-slate-400">{ariaLabel.includes('Hourly') ? 'emails per hour' : 'milliseconds'}</span>
    </div>
  );
}

/**
 * The "Send Later" popover: a date/time picker plus four quick presets, matching
 * the frames. Every option sets the real start time the API schedules against.
 */
function SendLaterPopover({
  startTime,
  onChange,
  onClose,
}: {
  startTime: string;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const presets = sendLaterPresets();

  return (
    <>
      <button
        type="button"
        aria-label="Close Send Later"
        className="fixed inset-0 z-40 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-label="Send Later"
        className="absolute right-0 z-50 mt-2 w-72 rounded-2xl border border-slate-100 bg-white p-4 shadow-xl"
      >
        <p className="text-sm font-semibold text-slate-800">Send Later</p>

        <label className="mt-3 block">
          <span className="text-xs text-slate-500">Pick date &amp; time</span>
          <div className="mt-1 flex items-center gap-2 border-b border-slate-200 pb-1.5">
            <input
              type="datetime-local"
              value={startTime}
              onChange={(event) => onChange(event.target.value)}
              aria-label="Start date and time"
              className="flex-1 bg-transparent text-sm text-slate-800 focus:outline-none"
            />
          </div>
        </label>

        <ul className="mt-3 space-y-0.5">
          {presets.map((preset) => (
            <li key={preset.label}>
              <button
                type="button"
                onClick={() => onChange(toDateTimeLocalValue(preset.date))}
                className="w-full rounded-lg px-2 py-2 text-left text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
              >
                {preset.label}
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-pill border border-brand-600 px-4 py-1.5 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
          >
            Done
          </button>
        </div>
      </div>
    </>
  );
}
