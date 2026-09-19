/**
 * DashboardHeader — logo, system status, and the user menu.
 *
 * THE STATUS PILL IS NOT DECORATION: it reads GET /api/health and shows whether
 * PostgreSQL, Redis and Elasticsearch are reachable. During a demo it answers
 * "is the system healthy?" at a glance, and it distinguishes a DEGRADED system
 * (Elasticsearch down: search unavailable, sending fine) from a BROKEN one
 * (Redis down: nothing schedules). That distinction is the reason health returns
 * three separate states rather than one boolean.
 */
import { useState } from 'react';
import { Badge } from './ui/Badge';
import { useAsync, usePolling } from '../hooks/useAsync';
import { fetchHealth } from '../services/misc.api';
import type { AuthUser, HealthReport } from '../types';

interface DashboardHeaderProps {
  user: AuthUser;
  onSignOut: () => Promise<void>;
}

export function DashboardHeader({ user, onSignOut }: DashboardHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Refetch every 30s so the pill reflects a service going down mid-demo.
  //
  // IMPORTANT DISTINCTION: this timer refreshes a STATUS INDICATOR in the browser.
  // It is not a scheduler — no email is ever triggered from a browser timer. All
  // email timing lives in BullMQ delayed jobs on the server (see README →
  // "Why not cron"). This is the only interval in the frontend.
  const { data: health, reload: reloadHealth } = useAsync((signal) => fetchHealth(signal), []);
  usePolling(reloadHealth, 30_000);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* ---- brand -------------------------------------------------------- */}
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="white" strokeWidth="2" />
              <path d="m4 7.5 8 5.5 8-5.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-sm font-semibold text-slate-900">ReachInbox</span>
          <span className="hidden text-xs text-slate-400 sm:inline">Email Scheduler</span>
        </div>

        {/* ---- status + user ----------------------------------------------- */}
        <div className="flex items-center gap-3">
          <HealthPillReport report={health} />

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-slate-100"
            >
              <Avatar user={user} />
              <span className="hidden text-left sm:block">
                <span className="block text-xs font-medium leading-tight text-slate-800">
                  {user.name}
                </span>
                <span className="block text-[11px] leading-tight text-slate-400">{user.email}</span>
              </span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-slate-400" aria-hidden="true">
                <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {menuOpen ? (
              <>
                {/* Click-outside layer: a full-screen transparent button is the
                    simplest reliable way to dismiss without a global listener. */}
                <button
                  type="button"
                  aria-label="Close menu"
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div
                  role="menu"
                  className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
                >
                  <div className="border-b border-slate-100 px-2.5 py-2">
                    <p className="text-xs font-medium text-slate-800">{user.name}</p>
                    <p className="truncate text-[11px] text-slate-400">{user.email}</p>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={signingOut}
                    onClick={async () => {
                      setSigningOut(true);
                      try {
                        await onSignOut();
                      } finally {
                        setSigningOut(false);
                        setMenuOpen(false);
                      }
                    }}
                    className="mt-1 w-full rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60"
                  >
                    {signingOut ? 'Signing out…' : 'Sign out'}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

/* -------------------------------------------------------------------------- */
/*  Health pill                                                               */
/* -------------------------------------------------------------------------- */

/** Grey when unknown, green when ok, amber when degraded, red when down. */
function HealthPillReport({ report }: { report: HealthReport | null }) {
  // `error` from useAsync is intentionally unused here: a missing health response
  // is itself the signal, and the pill already communicates it as "Unknown".
  if (!report) {
    return (
      <span className="hidden items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-500 sm:inline-flex">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
        Checking…
      </span>
    );
  }

  const tone = report.status === 'ok' ? 'success' : report.status === 'degraded' ? 'warning' : 'error';
  const label =
    report.status === 'ok' ? 'All systems go' : report.status === 'degraded' ? 'Degraded' : 'Down';

  const broken: string[] = [];
  if (report.services.database !== 'ok') broken.push('PostgreSQL');
  if (report.services.redis !== 'ok') broken.push('Redis');
  if (report.services.elasticsearch !== 'ok') broken.push('Elasticsearch');

  const detail =
    report.status === 'ok'
      ? `Queue: ${report.queue.delayed ?? 0} delayed · ${report.queue.active ?? 0} active · ${report.queue.completed ?? 0} completed`
      : `Unavailable: ${broken.join(', ')}`;

  return (
    <span title={detail} className="hidden sm:inline-flex">
      <Badge
        tone={tone}
        icon={<span className={`h-1.5 w-1.5 rounded-full ${dotClass(report.status)}`} />}
      >
        {label}
      </Badge>
    </span>
  );
}

function dotClass(status: HealthReport['status']): string {
  if (status === 'ok') return 'bg-emerald-500';
  if (status === 'degraded') return 'bg-amber-500';
  return 'bg-rose-500';
}

function Avatar({ user }: { user: AuthUser }) {
  const initials = user.name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  if (user.avatar) {
    return (
      <img
        src={user.avatar}
        alt=""
        width={28}
        height={28}
        className="h-7 w-7 rounded-full ring-1 ring-slate-200"
        // Google avatar URLs can expire; falling back to initials avoids a broken
        // image icon in the header.
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />
    );
  }

  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700">
      {initials || 'U'}
    </span>
  );
}
