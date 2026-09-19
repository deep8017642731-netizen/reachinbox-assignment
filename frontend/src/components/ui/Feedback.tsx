/**
 * Feedback primitives: Spinner, LoadingState, EmptyState, ErrorState, Alert.
 *
 * These exist because the assignment explicitly requires loading, empty and error
 * states on every data view. Making them reusable components means a new table
 * gets all three by writing one line each, so "I forgot the empty state" stops
 * being possible.
 */
import type { ReactNode } from 'react';
import { Button } from './Button';

/* -------------------------------------------------------------------------- */
/*  Spinner + loading skeleton                                                */
/* -------------------------------------------------------------------------- */

export function Spinner({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`animate-spin text-slate-400 ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

/** Full-panel loading state with optional message. */
export function LoadingState({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16" role="status">
      <Spinner size={28} />
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}

/**
 * Skeleton rows that match the table layout.
 *
 * Preferred over a spinner for tables: the page keeps its shape instead of
 * collapsing and then jumping when data arrives.
 */
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="animate-pulse divide-y divide-slate-100" aria-hidden="true">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <div
              key={columnIndex}
              className="h-3.5 rounded bg-slate-200"
              style={{ width: columnIndex === 0 ? '26%' : columnIndex === columns - 1 ? '12%' : '20%' }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Empty + error states                                                      */
/* -------------------------------------------------------------------------- */

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        {icon ?? <InboxIcon />}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        {description ? (
          <p className="mx-auto max-w-md text-sm text-slate-500">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
  /** Shown for 503s: the API is up but a dependency is missing. */
  hint?: string;
}

export function ErrorState({ message, onRetry, hint }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-50 text-rose-500">
        <AlertIcon />
      </div>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-slate-800">Something went wrong</p>
        <p className="mx-auto max-w-lg text-sm text-slate-600">{message}</p>
        {hint ? <p className="mx-auto max-w-lg text-xs text-slate-500">{hint}</p> : null}
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Alert (inline, non-blocking)                                              */
/* -------------------------------------------------------------------------- */

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

const ALERT_TONES: Record<AlertTone, string> = {
  info: 'bg-sky-50 border-sky-200 text-sky-900',
  success: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  warning: 'bg-amber-50 border-amber-200 text-amber-900',
  error: 'bg-rose-50 border-rose-200 text-rose-900',
};

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: AlertTone;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div
      // role="status" announces politely; errors use alert() for immediacy.
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg border px-3.5 py-3 text-sm ${ALERT_TONES[tone]}`}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Icons (inline SVG: no icon dependency, no extra network request)          */
/* -------------------------------------------------------------------------- */

function InboxIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 13h4l1.5 3h7L17 13h4M5 5h14l2 8v6H3v-6l2-8Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
