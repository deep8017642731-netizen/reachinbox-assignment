/**
 * AppShell — the sidebar + top bar layout used by every dashboard route.
 *
 * Matches the supplied frames: a fixed left sidebar (wordmark, user card,
 * Compose pill, CORE section with live counts) and a main column whose top bar
 * holds a pill-shaped search field plus filter and refresh controls.
 *
 * THE COUNTS IN THE SIDEBAR ARE REAL DATA
 * "Scheduled 12 / Sent 785" in the frames is a counter in the navigation. Here it
 * comes from GET /api/emails/stats, which is the same grouped query that used to
 * feed the stat cards — so the navigation doubles as the dashboard summary and
 * there is only one source for those numbers.
 *
 * The user card opens a small menu with sign-out, which is why the sidebar owns
 * it rather than a separate header component.
 */
import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { SlackConnectionCard, type SlackRedirectResult } from './SlackConnectionCard';
import { SenderLimitMeter } from './SenderLimitMeter';
import { useAuth } from '../context/AuthContext';
import { useAsync, usePolling } from '../hooks/useAsync';
import { fetchEmailStats } from '../services/emails.api';
import { fetchHealth } from '../services/misc.api';
import type { HealthReport } from '../types';

interface AppShellProps {
  children: ReactNode;
  /** Search value lives here so the field survives route changes. */
  searchValue: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  refreshing?: boolean;
  slackRedirect?: SlackRedirectResult;
  onSlackRedirectHandled?: () => void;
}

export function AppShell({
  children,
  searchValue,
  onSearchChange,
  onRefresh,
  refreshing = false,
  slackRedirect = null,
  onSlackRedirectHandled,
}: AppShellProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [typeFilter, setTypeFilter] = useState<'all' | 'scheduled' | 'sent'>('all');

  // Live counts for the navigation, refreshed while something is pending.
  const statsState = useAsync((signal) => fetchEmailStats(signal), []);
  const healthState = useAsync((signal) => fetchHealth(signal), []);

  const hasPending =
    (statsState.data?.stats.scheduled ?? 0) + (statsState.data?.stats.processing ?? 0) > 0;

  // Refreshes the counters while work is in flight so the numbers move on their
  // own during a demo. This is a view refresh, not a scheduler — email timing is
  // owned by BullMQ in Redis (see usePolling.ts).
  usePolling(() => {
    statsState.reload();
    healthState.reload();
  }, hasPending ? 5_000 : 30_000);

  if (!user) return null;

  const stats = statsState.data?.stats;

  /** The filter control narrows the current list without a round trip. */
  const applyFilter = (next: 'all' | 'scheduled' | 'sent'): void => {
    setTypeFilter(next);
    if (next === 'scheduled') navigate('/dashboard/scheduled');
    if (next === 'sent') navigate('/dashboard/sent');
  };

  return (
    <div className="flex min-h-screen bg-white">
      {/* ================= sidebar ================= */}
      <aside className="hidden w-[248px] shrink-0 border-r border-slate-100 lg:flex lg:flex-col">
        {/* wordmark */}
        <div className="px-6 py-5">
          <span className="text-[26px] font-black uppercase leading-none tracking-tight text-slate-900">
            Reach<span className="text-brand-600">Inbox</span>
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-5 px-4 pb-4">
          {/* user card */}
          <UserCard
            name={user.name}
            email={user.email}
            avatar={user.avatar}
            onSignOut={signOut}
          />

          {/* compose */}
          <button
            type="button"
            onClick={() => navigate('/dashboard/compose')}
            className="w-full rounded-pill border border-brand-600 px-4 py-2 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
          >
            Compose
          </button>

          {/* navigation */}
          <nav className="flex flex-col gap-1">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Core
            </p>

            <NavItem
              to="/dashboard/scheduled"
              label="Scheduled"
              count={stats?.scheduled}
              icon={<ClockIcon />}
            />
            <NavItem
              to="/dashboard/sent"
              label="Sent"
              count={stats?.sent}
              icon={<SendIcon />}
            />
          </nav>

          {/*
            Footer of the sidebar: how much of the hourly allowance has been used
            (reads the same Redis counter the worker gates on), then Slack.
          */}
          <div className="mt-auto flex flex-col gap-3">
            <SenderLimitMeter />
            <SlackConnectionCard
              redirectResult={slackRedirect}
              onRedirectHandled={onSlackRedirectHandled ?? (() => undefined)}
            />
          </div>
        </div>
      </aside>

      {/* ================= main column ================= */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* top bar */}
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 sm:px-6">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <input
              type="search"
              value={searchValue}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search"
              aria-label="Search emails"
              className="w-full rounded-pill bg-surface-muted py-2.5 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 focus:bg-white focus:ring-1 focus:ring-slate-200"
            />
          </div>

          {/* filter */}
          <div className="relative">
            <select
              value={typeFilter}
              onChange={(event) => applyFilter(event.target.value as 'all' | 'scheduled' | 'sent')}
              aria-label="Filter by view"
              className="appearance-none rounded-lg px-2.5 py-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
            >
              <option value="all">All</option>
              <option value="scheduled">Scheduled</option>
              <option value="sent">Sent</option>
            </select>
          </div>

          {/* refresh */}
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh"
            title="Refresh the list"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
              className={refreshing ? 'animate-spin' : ''}
            >
              <path
                d="M20 11a8 8 0 0 0-14-4.5M4 13a8 8 0 0 0 14 4.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path d="M6 3v4h4M18 21v-4h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>

          {/* mobile: the sidebar is hidden below lg, so expose the key routes here */}
          <nav className="flex gap-1 lg:hidden">
            <NavItem to="/dashboard/scheduled" label="Scheduled" compact icon={<ClockIcon />} />
            <NavItem to="/dashboard/sent" label="Sent" compact icon={<SendIcon />} />
          </nav>
        </div>

        {/* system status strip: appears only when something is wrong, so a healthy
            system stays visually quiet */}
        <SystemStatusStrip report={healthState.data} />

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Sidebar user card                                                         */
/* -------------------------------------------------------------------------- */

function UserCard({
  name,
  email,
  avatar,
  onSignOut,
}: {
  name: string;
  email: string;
  avatar: string | null;
  onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const initials = name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-slate-50"
      >
        {avatar ? (
          <img
            src={avatar}
            alt=""
            width={34}
            height={34}
            className="h-[34px] w-[34px] rounded-full object-cover ring-1 ring-slate-200"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">
            {initials || 'U'}
          </span>
        )}

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-800">{name}</span>
          <span className="block truncate text-xs text-slate-400">{email}</span>
        </span>

        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0 text-slate-400" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute left-0 right-0 z-50 mt-1 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
          >
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
                  setOpen(false);
                }
              }}
              className="w-full rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60"
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Navigation item                                                           */
/* -------------------------------------------------------------------------- */

function NavItem({
  to,
  label,
  count,
  icon,
  compact = false,
}: {
  to: string;
  label: string;
  count?: number | undefined;
  icon: ReactNode;
  compact?: boolean;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [
          'flex items-center gap-2.5 rounded-pill px-3 py-2 text-sm font-medium transition-colors',
          compact ? 'text-xs' : '',
          isActive
            ? 'bg-brand-50 text-brand-700'
            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
        ].join(' ')
      }
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {typeof count === 'number' ? <span className="shrink-0 text-xs tabular-nums">{count}</span> : null}
    </NavLink>
  );
}

/* -------------------------------------------------------------------------- */
/*  Degraded-mode banner                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Shown ONLY when a dependency is down.
 *
 * The distinction matters: Elasticsearch down means search is unavailable while
 * scheduling and sending still work. Collapsing that into "something is broken"
 * would send someone hunting for a bug in the wrong place.
 */
function SystemStatusStrip({ report }: { report: HealthReport | null }) {
  if (!report || report.status === 'ok') return null;

  const down: string[] = [];
  if (report.services.database !== 'ok') down.push('PostgreSQL');
  if (report.services.redis !== 'ok') down.push('Redis');
  if (report.services.elasticsearch !== 'ok') down.push('Elasticsearch');

  const isDegraded = report.status === 'degraded';

  return (
    <div
      role="status"
      className={`flex items-center gap-2 border-b px-4 py-2 text-xs sm:px-6 ${
        isDegraded
          ? 'border-amber-100 bg-amber-50 text-amber-900'
          : 'border-rose-100 bg-rose-50 text-rose-900'
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isDegraded ? 'bg-amber-500' : 'bg-rose-500'}`} />
      <span>
        <span className="font-semibold">
          {isDegraded ? 'Running in degraded mode' : 'Service unavailable'}:
        </span>{' '}
        {down.join(', ')} {down.length === 1 ? 'is' : 'are'} unreachable.{' '}
        {isDegraded
          ? 'Emails still schedule and send; search is temporarily unavailable.'
          : 'Scheduling and sending will not work until this is restored.'}
      </span>
    </div>
  );
}

/* ---- icons --------------------------------------------------------------- */

function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.9" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 3 10.5 13.5M21 3l-6.5 18-4-8-8-4L21 3Z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
