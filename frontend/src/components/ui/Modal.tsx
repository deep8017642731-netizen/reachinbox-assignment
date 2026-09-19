/**
 * Modal — the shell used by "Compose new email".
 *
 * WHY NOT <dialog> DIRECTLY
 * The native <dialog> element is attractive, but its showModal/close lifecycle
 * does not compose cleanly with React's render loop without extra effects, and
 * styling `::backdrop` varies. This implementation uses a fixed-position overlay
 * and reimplements the three behaviours that actually matter:
 *
 *   1. Escape closes it.
 *   2. Clicking the backdrop closes it, but clicking inside does not.
 *   3. While open, the page behind cannot scroll, and focus moves into the dialog
 *      (`role="dialog"` + `aria-modal`) so keyboard and screen-reader users are
 *      not left behind the overlay.
 *
 * Focus is returned to whatever was focused before opening, which is what makes
 * the keyboard experience feel correct after closing.
 */
import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Footer actions (buttons). */
  footer?: ReactNode;
  /** Tailwind max-width class. Compose is wide because it holds a form + preview. */
  size?: 'md' | 'lg' | 'xl';
}

const SIZE_CLASSES = {
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'lg',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Escape to close + body scroll lock + focus management.
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus into the dialog so Tab does not walk the page behind it.
    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center"
      // The backdrop handler checks the event target so a click that started
      // inside the panel and ended on the backdrop (text selection drag) does not
      // close the dialog and lose the user's typing.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`my-8 w-full ${SIZE_CLASSES[size]} rounded-xl bg-white shadow-xl ring-1 ring-slate-900/5 outline-none`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="px-5 py-4">{children}</div>

        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5 rounded-b-xl">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
