/**
 * Button — the single source of truth for every clickable action in the app.
 *
 * WHY A COMPONENT AND NOT TAILWIND CLASSES INLINE
 * A button has five visual variants, three sizes, a loading state and a disabled
 * state. Inlined, that is ~200 combinations spread over 20 files and they drift
 * apart within a week. Here it is one file, and `variant="primary"` reads better
 * than twelve utility classes at each call site.
 *
 * The loading state disables the button AND swaps the label for a spinner, which
 * prevents the double-submit bug: clicking "Schedule" twice would otherwise create
 * two batches.
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Rendered before the label (typically a 16px inline SVG). */
  icon?: ReactNode;
  fullWidth?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300 shadow-sm',
  secondary:
    'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 active:bg-slate-100 disabled:text-slate-400 disabled:bg-slate-50',
  ghost:
    'bg-transparent text-slate-600 hover:bg-slate-100 active:bg-slate-200 disabled:text-slate-400',
  danger:
    'bg-white text-rose-600 border border-rose-200 hover:bg-rose-50 active:bg-rose-100 disabled:text-rose-300',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-sm',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 text-xs gap-1.5',
  md: 'px-3.5 py-2 text-sm gap-2',
  lg: 'px-5 py-2.5 text-sm gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  fullWidth = false,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      // Defaulting to type="button" matters: inside a <form>, an unset type
      // defaults to "submit", so a Cancel button would unexpectedly submit.
      type={type}
      disabled={disabled || loading}
      // aria-busy tells screen readers the action is in progress; without it the
      // button just appears broken for a few seconds.
      aria-busy={loading || undefined}
      className={[
        'inline-flex items-center justify-center font-medium rounded-lg',
        'transition-colors duration-150',
        'disabled:cursor-not-allowed',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        fullWidth ? 'w-full' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? (
        <>
          <Spinner />
          <span>Working…</span>
        </>
      ) : (
        <>
          {icon}
          {children}
        </>
      )}
    </button>
  );
}

/** Inline spinner sized to match the button text. */
function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}
