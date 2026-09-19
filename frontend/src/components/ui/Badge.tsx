/**
 * Badge — status pills.
 *
 * The email status colours are defined ONCE here, so "what does SCHEDULED look
 * like?" has exactly one answer across the dashboard.
 *
 * Each status also gets a distinct icon shape in addition to its colour. That is
 * an accessibility requirement, not a flourish: colour alone fails for the ~8% of
 * men with red/green colour blindness, who would otherwise be unable to tell
 * SENT from FAILED.
 */
import type { EmailStatus } from '../../types';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-sky-50 text-sky-700 ring-sky-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  error: 'bg-rose-50 text-rose-700 ring-rose-200',
};

export function Badge({
  tone = 'neutral',
  children,
  icon,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_CLASSES[tone]}`}
    >
      {icon}
      {children}
    </span>
  );
}

interface StatusPresentation {
  tone: BadgeTone;
  label: string;
  /** Short explanation shown as a tooltip — useful when demoing. */
  description: string;
  icon: React.ReactNode;
}

/** One place that decides how every email status looks and reads. */
const STATUS_PRESENTATION: Record<EmailStatus, StatusPresentation> = {
  SCHEDULED: {
    tone: 'info',
    label: 'Scheduled',
    description: 'Waiting in the BullMQ delayed set — nothing has been sent yet.',
    icon: <ClockIcon />,
  },
  PROCESSING: {
    tone: 'warning',
    label: 'Processing',
    description: 'A worker has picked this up and is contacting SMTP right now.',
    icon: <ArrowPathIcon />,
  },
  SENT: {
    tone: 'success',
    label: 'Sent',
    description: 'SMTP accepted the message.',
    icon: <CheckIcon />,
  },
  FAILED: {
    tone: 'error',
    label: 'Failed',
    description: 'All retry attempts were exhausted. See the error message.',
    icon: <CrossIcon />,
  },
  CANCELLED: {
    tone: 'neutral',
    label: 'Cancelled',
    description: 'Cancelled before delivery.',
    icon: <SlashIcon />,
  },
};

export function StatusBadge({ status }: { status: EmailStatus }) {
  const presentation = STATUS_PRESENTATION[status];
  return (
    <span title={presentation.description} className="inline-flex">
      <Badge tone={presentation.tone} icon={presentation.icon}>
        {presentation.label}
      </Badge>
    </span>
  );
}

/* ---- tiny inline icons (kept local so the badge is self-contained) -------- */

function ClockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function ArrowPathIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M20 11a8 8 0 0 0-14-4.5M4 13a8 8 0 0 0 14 4.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path d="M6 3v4h4M18 21v-4h-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 12.5 9.5 18 20 6.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function SlashIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.2" />
      <path d="M6 18 18 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
