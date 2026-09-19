/**
 * Formatting helpers.
 *
 * All timestamps from the API are ISO-8601 UTC strings. They are rendered in the
 * viewer's LOCAL timezone, because "scheduled 14:04" is meaningless to a user in
 * IST if it is actually UTC. The timezone is shown explicitly on absolute dates so
 * there is never ambiguity about which clock is being displayed.
 */

/** "19 Sep 2026, 17:34" in the viewer's timezone. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** "17:34" — used in dense table cells where the date is already obvious. */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(date);
}

/**
 * Relative description of a future timestamp: "in 2 min", "in 45 s".
 * Used for scheduled emails so the user can see at a glance how soon it fires.
 */
export function formatRelativeFuture(iso: string): string {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return '';

  const diffMs = target - Date.now();
  if (diffMs <= 0) return 'due now';

  const seconds = Math.round(diffMs / 1000);
  if (seconds < 60) return `in ${seconds}s`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;

  return `in ${Math.round(hours / 24)} d`;
}

/** "2 minutes ago" for sent emails. */
export function formatRelativePast(iso: string | null | undefined): string {
  if (!iso) return '';
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return '';

  const seconds = Math.round((Date.now() - target) / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;

  return `${Math.round(hours / 24)} d ago`;
}

/** Truncates long text for table cells, with an ellipsis. */
export function truncate(value: string, max = 60): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Converts a Date to the exact string an <input type="datetime-local"> expects
 * ("YYYY-MM-DDTHH:mm") in LOCAL time.
 *
 * The naive approach (`toISOString().slice(0,16)`) is a classic bug: it formats
 * the value as UTC, so a user in IST sees their intended time shifted by 5.5
 * hours. Building the string from the local getters avoids that entirely.
 */
export function toDateTimeLocalValue(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join('T');
}

/**
 * Converts an <input type="datetime-local"> value back to an ISO string.
 * The input gives local wall-clock time with no timezone, so `new Date(value)`
 * interprets it as local — which is exactly what the user intended.
 */
export function fromDateTimeLocalValue(value: string): string {
  return new Date(value).toISOString();
}

/** "1,250" for the stats cards. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

/** "2s" / "500ms" / "1 min" for configured millisecond values. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  const minutes = seconds / 60;
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} min`;
}
