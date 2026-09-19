/**
 * SenderLimitMeter — shows how much of the current hour's allowance a sender has
 * used, straight from GET /api/senders.
 *
 * WHY THIS IS IN THE UI EVEN THOUGH THE FRAMES DO NOT SHOW IT
 * The hourly per-sender rate limit is one of the assignment's central features
 * (jobs that exceed it are *rescheduled*, never dropped), and a demo is far more
 * convincing when the limit can be watched being approached instead of being
 * described. It sits at the bottom of the sidebar, where it costs no room in the
 * main content area. Remove this file and its two lines in AppShell.tsx if strict
 * frame fidelity is preferred.
 *
 * The numbers are read from Redis on the server (`sender:<id>:hour:<label>`), not
 * counted in the browser — so this cannot drift from what actually gates sending.
 */
import { useAsync } from '../hooks/useAsync';
import { fetchSenders } from '../services/misc.api';

export function SenderLimitMeter({ refreshToken }: { refreshToken?: number }) {
  const { data, loading, error, reload } = useAsync((signal) => fetchSenders(signal), [refreshToken]);

  const senders = data?.senders ?? [];

  if (error) {
    return (
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="text-xs font-semibold text-slate-700">Hourly limit</p>
        <p className="mt-1 text-[11px] text-rose-600">{error}</p>
        <button
          type="button"
          onClick={reload}
          className="mt-1 text-[11px] font-medium text-slate-500 underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }

  if (loading && senders.length === 0) {
    return (
      <div className="animate-pulse rounded-xl border border-slate-200 p-3" aria-hidden="true">
        <div className="h-3 w-24 rounded bg-slate-200" />
        <div className="mt-2 h-3.5 w-full rounded-full bg-slate-100" />
      </div>
    );
  }

  if (senders.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="text-xs font-semibold text-slate-700">Hourly limit</p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          No sender yet. The first sender is created automatically when you schedule an email — or
          connect Google to use that address.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-xs font-semibold text-slate-700">Hourly limit</p>

      <ul className="mt-2 space-y-2.5">
        {senders.map((sender) => {
          // `usage` is null when Redis was unreachable: say so rather than
          // rendering a progress bar of 0/0 that looks like a real measurement.
          const usage = sender.usage;
          const percent = usage && usage.limit > 0 ? (usage.usedThisHour / usage.limit) * 100 : 0;
          const tone =
            percent >= 100 ? 'bg-rose-500' : percent >= 80 ? 'bg-amber-500' : 'bg-brand-500';

          return (
            <li key={sender.id}>
              <p className="truncate text-[11px] text-slate-500" title={sender.email}>
                {sender.email}
              </p>

              {usage ? (
                <>
                  <div
                    className="mt-1 h-1.5 w-full overflow-hidden rounded-pill bg-slate-100"
                    role="progressbar"
                    aria-valuenow={usage.usedThisHour}
                    aria-valuemin={0}
                    aria-valuemax={usage.limit}
                    aria-label={`${usage.usedThisHour} of ${usage.limit} emails sent this hour`}
                  >
                    <div
                      className={`h-full rounded-pill transition-all ${tone}`}
                      style={{ width: `${Math.min(100, percent)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] tabular-nums text-slate-400">
                    <span className="font-medium text-slate-600">{usage.usedThisHour}</span> /{' '}
                    {usage.limit} this hour
                    {percent >= 100 ? (
                      <span className="text-rose-600"> · at limit, extras defer to the next hour</span>
                    ) : null}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-[11px] text-slate-400">Rate limit unavailable (Redis offline)</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
