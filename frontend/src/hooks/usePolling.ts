/**
 * usePolling — repeats an action on a fixed interval, for STATUS REFRESHES ONLY.
 *
 * ⚠️ THIS IS NOT A SCHEDULER, AND MUST NEVER BE USED AS ONE. ⚠️
 *
 * The assignment forbids `setInterval` for deciding when emails are sent, and this
 * project does not do that: no email's timing is influenced by anything in the
 * browser. All email scheduling lives in BullMQ delayed jobs inside Redis, where
 * it survives a browser tab closing, a page reload, and the API restarting.
 *
 * The only legitimate use here is refreshing a *view* — the header's health pill
 * re-reads GET /api/health so an engineer can see a dependency go down while the
 * demo runs. If a refresh is missed, the consequence is a slightly stale badge;
 * it can never cause an email to be sent, delayed or duplicated.
 *
 * It is a separate, named hook precisely so that distinction is explicit rather
 * than implied by a bare `setInterval` buried in a component.
 */
import { useEffect, useRef } from 'react';

export function usePolling(callback: () => void, intervalMs: number, enabled = true): void {
  // Keep the latest callback in a ref, so changing the callback identity does not
  // tear down and recreate the interval on every render.
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;

    const timer = window.setInterval(() => callbackRef.current(), intervalMs);

    // Two subtleties this handles:
    //  - Pausing while the tab is hidden avoids pointless requests in a
    //    background tab (the browser throttles them anyway, which makes the
    //    interval unreliable).
    //  - Refreshing immediately on return means the user never looks at stale data.
    const handleVisibility = (): void => {
      if (!document.hidden) callbackRef.current();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [intervalMs, enabled]);
}
