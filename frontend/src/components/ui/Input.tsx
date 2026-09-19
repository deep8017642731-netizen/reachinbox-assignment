/**
 * Form primitives: Field wrapper, Input, Textarea, Select.
 *
 * All four share one concern — showing a label, a hint, and a validation error in
 * a consistent layout — so the layout lives in `Field` and the others only style
 * the control itself.
 *
 * ACCESSIBILITY: the label is linked to the control via htmlFor/id, and an error
 * is announced through aria-invalid + aria-describedby. A red border alone is
 * invisible to a screen reader and to a colour-blind user.
 *
 * The `id` is generated with React's useId when the caller does not supply one, so
 * no caller can accidentally break the label association.
 */
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface FieldProps {
  label: string;
  htmlFor: string;
  error?: string | undefined;
  hint?: string | undefined;
  required?: boolean;
  children: ReactNode;
}

export function Field({ label, htmlFor, error, hint, required, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
      </label>

      {children}

      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs font-medium text-rose-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Shared control styling, so Input/Textarea/Select stay visually identical. */
function controlClasses(hasError: boolean, extra = ''): string {
  return [
    'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900',
    'placeholder:text-slate-400',
    'disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed',
    hasError ? 'border-rose-300 focus:border-rose-500' : 'border-slate-300 focus:border-brand-500',
    extra,
  ].join(' ');
}

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  id?: string;
}

export function Input({ label, error, hint, id, required, ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <Field label={label} htmlFor={inputId} error={error} hint={hint} required={required}>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
        className={controlClasses(Boolean(error))}
        {...rest}
      />
    </Field>
  );
}

interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'id'> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  id?: string;
}

export function Textarea({ label, error, hint, id, required, rows = 6, ...rest }: TextareaProps) {
  const generatedId = useId();
  const textareaId = id ?? generatedId;

  return (
    <Field label={label} htmlFor={textareaId} error={error} hint={hint} required={required}>
      <textarea
        id={textareaId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${textareaId}-error` : hint ? `${textareaId}-hint` : undefined}
        className={controlClasses(Boolean(error), 'resize-y font-sans')}
        {...rest}
      />
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'id'> {
  label: string;
  options: SelectOption[];
  error?: string | undefined;
  hint?: string | undefined;
  id?: string;
  placeholder?: string;
}

export function Select({
  label,
  options,
  error,
  hint,
  id,
  required,
  placeholder,
  ...rest
}: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <Field label={label} htmlFor={selectId} error={error} hint={hint} required={required}>
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined}
        className={controlClasses(Boolean(error), 'pr-8')}
        {...rest}
      >
        {placeholder ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
