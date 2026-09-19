/**
 * DashboardLayout — the shell for the list routes.
 *
 * It owns the two pieces of state that live in the TOP BAR but are needed by the
 * page below it: the search text and a refresh trigger. React Router's outlet
 * context passes them down without prop-drilling through every route, which keeps
 * the child pages addressable by URL (`/dashboard/scheduled`, `/dashboard/sent`)
 * exactly as the frames and the OAuth redirects require.
 *
 * The debounce lives here, not in the search field, so a single debounced value is
 * shared by every child route: typing while navigating does not fire two requests.
 */
import { useCallback, useEffect, useState } from 'react';
import { Outlet, useOutletContext } from 'react-router-dom';
import { AppShell } from '../components/AppShell';
import { useAsync, useDebouncedValue } from '../hooks/useAsync';
import { fetchEmailStats } from '../services/emails.api';
import type { SlackRedirectResult } from '../components/SlackConnectionCard';

export interface DashboardOutletContext {
  /** Debounced search text — empty string means "not searching". */
  searchQuery: string;
  /** Increments when the user asks for a refresh; children reload on change. */
  refreshToken: number;
  requestRefresh: () => void;
}

/** Typed accessor for children, so the context shape is declared once. */
export function useDashboardContext(): DashboardOutletContext {
  return useOutletContext<DashboardOutletContext>();
}

export function DashboardLayout() {
  const [searchInput, setSearchInput] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);
  const [slackRedirect, setSlackRedirect] = useState<SlackRedirectResult>(null);

  const searchQuery = useDebouncedValue(searchInput.trim(), 350);

  // Stats are used only to drive the refresh spinner in the top bar.
  const statsState = useAsync((signal) => fetchEmailStats(signal), [refreshToken]);

  const requestRefresh = useCallback(() => {
    setRefreshToken((token) => token + 1);
    statsState.reload();
  }, [statsState]);

  // Read ?slack=… once when returning from Slack's consent screen.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('slack');
    if (result) {
      setSlackRedirect(result as SlackRedirectResult);
      params.delete('slack');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    }
  }, []);

  return (
    <AppShell
      searchValue={searchInput}
      onSearchChange={setSearchInput}
      onRefresh={requestRefresh}
      refreshing={statsState.loading}
      slackRedirect={slackRedirect}
      onSlackRedirectHandled={() => setSlackRedirect(null)}
    >
      <Outlet context={{ searchQuery, refreshToken, requestRefresh } satisfies DashboardOutletContext} />
    </AppShell>
  );
}
