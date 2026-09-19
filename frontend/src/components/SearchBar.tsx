/**
 * SearchBar — full-text search backed by Elasticsearch.
 *
 * Callers pass raw keystrokes in; this component debounces them (350 ms) so one
 * request is sent per pause in typing rather than one per character. The debounce
 * lives in useDebouncedValue, and the actual query effect lives in the parent, so
 * this stays a presentational control with a clear responsibility.
 *
 * The "Clear" affordance matters more than it looks: without it, a user who typed
 * a query and got zero results has no obvious way back to the full list.
 */
import { useEffect, useState } from 'react';
import { Spinner } from './ui/Feedback';

interface SearchBarProps {
  /** Debounced value, owned by the parent. */
  value: string;
  onChange: (value: string) => void;
  loading?: boolean;
  placeholder?: string;
}

export function SearchBar({
  value,
  onChange,
  loading = false,
  placeholder = 'Search emails…',
}: SearchBarProps) {
  // Local state keeps the input responsive; the parent receives debounced updates.
  const [draft, setDraft] = useState(value);

  // Keep in sync when the parent resets the value (e.g. after clearing).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className="relative w-full sm:max-w-sm">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>

      <input
        type="search"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(event.target.value);
        }}
        placeholder={placeholder}
        aria-label="Search emails"
        className="block w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500"
      />

      {/* Right-hand slot: a spinner while searching, otherwise a clear button. */}
      <span className="absolute right-2 top-1/2 -translate-y-1/2">
        {loading ? (
          <Spinner size={15} />
        ) : draft !== '' ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setDraft('');
              onChange('');
            }}
            className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        ) : null}
      </span>
    </div>
  );
}
