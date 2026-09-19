/**
 * A small data-fetching hook that makes the three states the assignment requires
 * impossible to forget: loading, error and data (with an explicit empty check
 * handled by components).
 *
 * WHY NOT A DATA LIBRARY (React Query/SWR)?
 * Those are excellent, but they add a dependency and a mental model to explain for
 * what is fundamentally `useEffect` + three `useState`s. This hook is ~60 lines,
 * has no magic, and can be described in one interview sentence. If the app grew
 * caching/refetch requirements, React Query would be the right next step.
 *
 * THREE DETAILS THAT PREVENT REAL BUGS:
 *  1. Requests are ABORTED on unmount/dependency change. Without an AbortSignal,
 *     switching tabs quickly leaves an in-flight request that resolves later and
 *     overwrites fresh state with stale data (a race).
 *  2. Results are only applied if the request is still the latest one, guarding
 *     against out-of-order responses.
 *  3. `reload()` lets a caller refresh after a mutation (e.g. after scheduling).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../services/api';

// Re-exported so callers can `import { useAsync, usePolling } from '../hooks/useAsync'`.
// The implementation lives in its own file because it has a different purpose
// (refreshing a view) from this one (fetching data).
export { usePolling } from './usePolling';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  /** HTTP status of the failure, when there was one (401 vs 503 matters to callers). */
  status: number | null;
  /** Runs the request again, keeping the previous data visible while loading. */
  reload: () => void;
}

export function useAsync<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[] = [],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  /**
   * The fetcher is usually an inline arrow function, so it is a new reference on
   * every render. Storing it in a ref keeps the effect dependent only on the
   * caller's explicit `deps`, instead of re-fetching on every render.
   */
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Tracks which request is newest, so a slow earlier response cannot win.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    let cancelled = false;

    setLoading(true);
    setError(null);

    fetcherRef
      .current(controller.signal)
      .then((result) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setData(result);
        setStatus(null);
      })
      .catch((caught: unknown) => {
        // An abort is a normal lifecycle event, not a failure to show the user.
        if (controller.signal.aborted || cancelled) return;
        if (requestId !== requestIdRef.current) return;

        const apiError = caught instanceof ApiError ? caught : null;
        setError(
          apiError?.message ??
            (caught instanceof Error ? caught.message : 'Something went wrong'),
        );
        setStatus(apiError?.status ?? null);
      })
      .finally(() => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { data, loading, error, status, reload };
}

/**
 * Delays a rapidly-changing value — used by the search box so a request is not
 * fired for every keystroke. 350 ms is long enough to batch fast typing and short
 * enough to feel immediate.
 */
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    // Clearing on every change means only the final value in a burst survives —
    // this is debouncing, not a polling interval.
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
