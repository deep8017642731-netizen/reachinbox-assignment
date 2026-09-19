/**
 * Toasts — transient success/failure messages.
 *
 * WHY THIS EXISTS: the assignment requires that the UI never fails silently. A
 * click that "does nothing" is the worst outcome in a demo, so every mutation
 * reports its result here — scheduling succeeded, Slack disconnected, the API
 * rejected the request, etc.
 *
 * IMPLEMENTATION NOTES
 *  - The provider lives at the app root, so any component can call `useToast()`
 *    without prop-drilling a callback down the tree.
 *  - Auto-dismiss timers are tracked and cleared on unmount; otherwise a timer
 *    fires after the provider is gone and React logs a state-update warning.
 *  - Errors are announced with role="alert" and do not auto-dismiss as quickly as
 *    successes, because a user needs time to read what went wrong.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  /** Optional second line with detail (e.g. the API's error message). */
  detail?: string;
}

interface ToastContextValue {
  toasts: Toast[];
  push: (tone: ToastTone, message: string, detail?: string) => void;
  success: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
  info: (message: string, detail?: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Errors linger; confirmations get out of the way quickly. */
const DISMISS_AFTER_MS: Record<ToastTone, number> = {
  success: 4000,
  info: 5000,
  error: 8000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string, detail?: string) => {
      const id = nextId.current++;
      // Cap the stack at four: more than that covers the page and hides the very
      // content the user is trying to read.
      setToasts((current) => [...current.slice(-3), { id, tone, message, detail }]);
      const timer = window.setTimeout(() => dismiss(id), DISMISS_AFTER_MS[tone]);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  // Clear every pending timer when the provider unmounts.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer));
      pending.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      push,
      dismiss,
      success: (message, detail) => push('success', message, detail),
      error: (message, detail) => push('error', message, detail),
      info: (message, detail) => push('info', message, detail),
    }),
    [toasts, push, dismiss],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast() must be used inside <ToastProvider>');
  }
  return context;
}

/* -------------------------------------------------------------------------- */
/*  Viewport                                                                  */
/* -------------------------------------------------------------------------- */

const TONE_STYLES: Record<ToastTone, { wrap: string; icon: ReactNode }> = {
  success: {
    wrap: 'border-emerald-200 bg-white',
    icon: (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 12.5 9.5 18 20 6.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    ),
  },
  error: {
    wrap: 'border-rose-200 bg-white',
    icon: (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </span>
    ),
  },
  info: {
    wrap: 'border-sky-200 bg-white',
    icon: (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 8h.01M11 12h1v4h1" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      </span>
    ),
  },
};

/** Rendered once, near the app root. */
export function ToastViewport() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2"
      // aria-live="polite" so messages are announced without interrupting.
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const style = TONE_STYLES[toast.tone];
        return (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 rounded-xl border px-3.5 py-3 shadow-lg ${style.wrap}`}
          >
            {style.icon}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800">{toast.message}</p>
              {toast.detail ? (
                <p className="mt-0.5 break-words text-xs text-slate-500">{toast.detail}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
