/**
 * ComposeEmailModal — where a campaign is created.
 *
 * Collects: sender, subject, body, recipients (uploaded or pasted), start time,
 * delay between emails, and the hourly limit.
 *
 * THE INTERACTION THAT MATTERS: the recipient list is parsed and shown BEFORE
 * anything is sent to the server ("14 addresses detected · 2 duplicates removed ·
 * 1 invalid"), so the user can see exactly what will be scheduled. Invalid
 * addresses are never submitted — the backend rejects the whole request if it
 * receives one, and the modal stays open with the problem visible.
 *
 * The start time uses <input type="datetime-local">, whose value is LOCAL wall
 * clock. utils/format.ts converts to/from ISO at the edges so no timezone
 * conversion happens in the UI layer.
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Input, Select, Textarea } from './ui/Input';
import { Alert } from './ui/Feedback';
import { LeadUploader } from './LeadUploader';
import { scheduleEmails } from '../services/emails.api';
import { ApiError } from '../services/api';
import { fromDateTimeLocalValue, toDateTimeLocalValue, formatDuration } from '../utils/format';
import { MAX_RECIPIENTS } from '../utils/parseLeads';
import type { ParsedLeadsResult } from '../utils/parseLeads';
import type { Sender, ScheduleEmailResponse } from '../types';

interface ComposeEmailModalProps {
  open: boolean;
  onClose: () => void;
  senders: Sender[];
  /** Sensible defaults come from the server's own configuration. */
  defaults: { minDelayMs: number; hourlyLimit: number };
  onScheduled: (result: ScheduleEmailResponse) => void;
  onError: (message: string, detail?: string) => void;
}

/** Empty form state, extracted so the reset path cannot drift from the initial one. */
function emptyForm(defaults: ComposeEmailModalProps['defaults']) {
  return {
    senderId: '',
    subject: '',
    body: '',
    startTime: toDateTimeLocalValue(new Date(Date.now() + 60_000)), // one minute from now
    delayBetweenEmailsMs: String(defaults.minDelayMs),
    hourlyLimit: String(defaults.hourlyLimit),
  };
}

export function ComposeEmailModal({
  open,
  onClose,
  senders,
  defaults,
  onScheduled,
  onError,
}: ComposeEmailModalProps) {
  const [form, setForm] = useState(() => emptyForm(defaults));
  const [leads, setLeads] = useState<ParsedLeadsResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Reset whenever the dialog opens: a half-filled form from a previous attempt
  // would otherwise reappear, and the user would resubmit stale content.
  useEffect(() => {
    if (open) {
      setForm(emptyForm(defaults));
      setLeads(null);
      setFieldErrors({});
      setSubmitting(false);
    }
  }, [open, defaults]);

  // Default to the first sender so a one-sender account can schedule immediately.
  useEffect(() => {
    if (open && form.senderId === '' && senders.length > 0) {
      setForm((current) => ({ ...current, senderId: senders[0]?.id ?? '' }));
    }
  }, [open, senders, form.senderId]);

  const delayValue = Number(form.delayBetweenEmailsMs);
  const hourlyLimitValue = Number(form.hourlyLimit);
  const recipientCount = leads?.valid.length ?? 0;

  /** Warn when the batch cannot finish inside one hour at the chosen pace. */
  const estimatedMinutes = useMemo(() => {
    if (!leads || delayValue <= 0) return null;
    const seconds = (recipientCount * delayValue) / 1000;
    if (seconds < 60) return null;
    return Math.ceil(seconds / 60);
  }, [leads, delayValue, recipientCount]);

  const exceedsHourlyLimit = recipientCount > hourlyLimitValue && hourlyLimitValue > 0;

  function validate(): boolean {
    const errors: Record<string, string> = {};

    if (!form.senderId) errors.senderId = 'Choose a sender';
    if (form.subject.trim() === '') errors.subject = 'Subject is required';
    if (form.body.trim() === '') errors.body = 'Body is required';
    if (recipientCount === 0) errors.recipients = 'Add at least one valid recipient';

    if (!Number.isFinite(delayValue) || delayValue < 0) {
      errors.delayBetweenEmailsMs = 'Delay must be zero or more milliseconds';
    }
    if (!Number.isFinite(hourlyLimitValue) || hourlyLimitValue < 1) {
      errors.hourlyLimit = 'Hourly limit must be at least 1';
    }
    if (!form.startTime || Number.isNaN(new Date(form.startTime).getTime())) {
      errors.startTime = 'Choose a valid start time';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(): Promise<void> {
    if (!validate() || !leads) return;

    setSubmitting(true);
    try {
      const result = await scheduleEmails({
        senderId: form.senderId,
        subject: form.subject.trim(),
        body: form.body,
        recipients: leads.valid,
        // datetime-local is local wall clock; convert to ISO for the API.
        startTime: fromDateTimeLocalValue(form.startTime),
        delayBetweenEmailsMs: delayValue,
        hourlyLimit: hourlyLimitValue,
      });

      onScheduled(result);
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        // Attach server-side field errors to the matching inputs so the user can
        // see precisely which value the API rejected.
        const serverErrors: Record<string, string> = {};
        for (const detail of error.details) {
          const key = detail.field.replace(/^body\./, '');
          serverErrors[key] = detail.message;
        }
        setFieldErrors((current) => ({ ...current, ...serverErrors }));
        onError('Could not schedule the emails', error.message);
      } else {
        onError('Could not schedule the emails', 'Unexpected error — check the browser console.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Compose new email"
      description="Each recipient becomes one scheduled job in BullMQ."
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={recipientCount === 0}>
            {recipientCount > 0
              ? `Schedule ${recipientCount} email${recipientCount === 1 ? '' : 's'}`
              : 'Schedule'}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        {/* ------------------------------- left: content -------------------- */}
        <div className="space-y-4">
          <Select
            label="Sender"
            required
            value={form.senderId}
            error={fieldErrors.senderId}
            placeholder={senders.length === 0 ? 'No senders available' : undefined}
            onChange={(event) => setForm((c) => ({ ...c, senderId: event.target.value }))}
            options={senders.map((sender) => ({
              value: sender.id,
              label: sender.displayName ? `${sender.displayName} <${sender.email}>` : sender.email,
            }))}
            hint="The hourly rate limit is applied per sender."
          />

          <Input
            label="Subject"
            required
            placeholder="Welcome to our platform"
            value={form.subject}
            error={fieldErrors.subject}
            maxLength={500}
            onChange={(event) => setForm((c) => ({ ...c, subject: event.target.value }))}
          />

          <Textarea
            label="Body"
            required
            rows={9}
            placeholder={'Hi there,\n\nThanks for signing up…'}
            value={form.body}
            error={fieldErrors.body}
            onChange={(event) => setForm((c) => ({ ...c, body: event.target.value }))}
            hint="Plain text. Sent exactly as written."
          />
        </div>

        {/* ------------------------------- right: leads + schedule ---------- */}
        <div className="space-y-4">
          <LeadUploader
            parsed={leads}
            onParsed={setLeads}
            error={fieldErrors.recipients}
            maxRecipients={MAX_RECIPIENTS}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Start time"
              required
              type="datetime-local"
              value={form.startTime}
              error={fieldErrors.startTime}
              onChange={(event) => setForm((c) => ({ ...c, startTime: event.target.value }))}
              hint="Your local timezone."
            />

            <Input
              label="Delay between emails"
              required
              type="number"
              min={0}
              step={100}
              value={form.delayBetweenEmailsMs}
              error={fieldErrors.delayBetweenEmailsMs}
              onChange={(event) =>
                setForm((c) => ({ ...c, delayBetweenEmailsMs: event.target.value }))
              }
              hint={`ms · enforced minimum ${defaults.minDelayMs}ms`}
            />
          </div>

          <Input
            label="Hourly limit"
            required
            type="number"
            min={1}
            value={form.hourlyLimit}
            error={fieldErrors.hourlyLimit}
            onChange={(event) => setForm((c) => ({ ...c, hourlyLimit: event.target.value }))}
            hint="Emails that exceed this are delayed to the next hour, never dropped."
          />

          {/* ---- live summary: shows the consequences of the chosen values --- */}
          {leads && recipientCount > 0 ? (
            <Alert tone={exceedsHourlyLimit ? 'warning' : 'info'}>
              <p>
                <span className="font-semibold">{recipientCount}</span> emails will be queued from{' '}
                <span className="font-semibold">
                  {new Date(form.startTime || Date.now()).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                , one every <span className="font-semibold">{formatDuration(delayValue)}</span>.
              </p>

              {estimatedMinutes ? (
                <p className="mt-1">
                  Full batch takes about{' '}
                  <span className="font-semibold">{estimatedMinutes} minutes</span>.
                </p>
              ) : null}

              {exceedsHourlyLimit ? (
                <p className="mt-1">
                  Only {hourlyLimitValue} can send this hour, so the remaining{' '}
                  <span className="font-semibold">{recipientCount - hourlyLimitValue}</span> will be
                  delayed into the next window and a Slack alert will fire.
                </p>
              ) : null}

              {delayValue < defaults.minDelayMs ? (
                <p className="mt-1">
                  Your delay is below the configured minimum of {defaults.minDelayMs}ms, so the
                  server will use {defaults.minDelayMs}ms instead.
                </p>
              ) : null}
            </Alert>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
