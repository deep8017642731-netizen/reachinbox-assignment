/**
 * StatCards — the four counters above the table.
 *
 * WHY FOUR AND NOT TEN: each card answers a question the user actually has while
 * running a campaign — what is waiting, what is happening now, what succeeded,
 * what failed. A failure count is deliberately given equal prominence to the
 * success count, because silently hiding failures is how people lose trust in a
 * scheduler.
 *
 * The "processing" and "failed" cards only appear when non-zero, so a healthy
 * system shows a calm two-card row rather than four cards of mostly zeroes.
 */
import { formatNumber } from '../utils/format';
import type { EmailStats } from '../types';

interface StatCardsProps {
  stats: EmailStats | null;
  loading: boolean;
  /** Highlight the failed card (used after a failure is detected). */
  emphasiseFailures?: boolean;
}

export function StatCards({ stats, loading, emphasiseFailures = false }: StatCardsProps) {
  if (loading && !stats) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="animate-pulse rounded-xl border border-slate-200 bg-white p-4"
            aria-hidden="true"
          >
            <div className="h-3 w-20 rounded bg-slate-200" />
            <div className="mt-2.5 h-6 w-12 rounded bg-slate-200" />
          </div>
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const cards = [
    {
      key: 'scheduled',
      label: 'Scheduled',
      value: stats.scheduled,
      tone: 'sky' as const,
      hint: 'Waiting in the BullMQ delayed set',
      always: true,
    },
    {
      key: 'processing',
      label: 'Processing',
      value: stats.processing,
      tone: 'amber' as const,
      hint: 'Being sent right now',
      always: false,
    },
    {
      key: 'sent',
      label: 'Sent',
      value: stats.sent,
      tone: 'emerald' as const,
      hint: 'Accepted by SMTP',
      always: true,
    },
    {
      key: 'failed',
      label: 'Failed',
      value: stats.failed,
      tone: 'rose' as const,
      hint: 'Retries exhausted',
      always: false,
    },
  ];

  const visible = cards.filter((card) => card.always || card.value > 0);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {visible.map((card) => (
        <div
          key={card.key}
          className={`rounded-xl border bg-white p-4 ${
            emphasiseFailures && card.key === 'failed'
              ? 'border-rose-300 ring-1 ring-rose-200'
              : 'border-slate-200'
          }`}
        >
          <p className="text-xs font-medium text-slate-500">{card.label}</p>
          <p className={`mt-1 text-2xl font-semibold tabular-nums ${VALUE_TONES[card.tone]}`}>
            {formatNumber(card.value)}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">{card.hint}</p>
        </div>
      ))}
    </div>
  );
}

const VALUE_TONES = {
  sky: 'text-sky-700',
  amber: 'text-amber-600',
  emerald: 'text-emerald-600',
  rose: 'text-rose-600',
} as const;
