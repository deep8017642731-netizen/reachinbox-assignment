/**
 * Hourly rate limiting — enforced in Redis, shared by every worker.
 *
 * WHY THIS CANNOT BE AN IN-MEMORY COUNTER
 * A variable like `let sentThisHour = 0` lives inside one Node process. With two
 * processes (or two containers, or two machines) each keeps its own count, so a
 * "50 per hour" limit silently becomes 100 per hour. Restarting the process also
 * resets it to zero. Redis gives every worker one shared, atomic counter.
 *
 * KEY DESIGN (matches the assignment brief):
 *   sender:<senderId>:hour:<YYYY-MM-DDTHH>      (UTC hour bucket)
 *
 * WHY A TIME BUCKET INSTEAD OF A SLIDING WINDOW
 * A bucket key needs no cleanup: it simply expires when the window ends
 * (`EXPIRE` = remaining window + 1 hour). A sliding window would need sorted sets
 * and trimming on every request. The trade-off, stated honestly: an hour bucket
 * allows up to 2× the limit across a bucket boundary (50 at 15:59 + 50 at 16:00),
 * which is acceptable for an outbound-email quota and is a common industry
 * pattern (it is how many API quotas work). A rolling window would be the choice
 * if the provider counted strictly per rolling hour.
 *
 * ATOMICITY
 * The check and the increment happen inside ONE Lua script, so Redis executes
 * them as a single unit. Doing `GET` then `INCR` from Node would let two workers
 * read "49" simultaneously and both increment to 50 — two sends past the limit.
 * Because Redis runs commands one at a time, the script cannot interleave.
 */
import { getRedis } from '../lib/redis';
import { createLogger } from '../lib/logger';

const log = createLogger('RateLimit');

/**
 * Atomically reserves one send slot for the given window key.
 *
 * KEYS[1] = counter key
 * ARGV[1] = limit
 * ARGV[2] = TTL in seconds
 *
 * Returns { 1, used } when the send may proceed, { 0, used } when the limit is
 * already reached. Nothing is incremented in the denied case, so a blocked email
 * never consumes quota.
 */
const RESERVE_SCRIPT = `
local key   = KEYS[1]
local limit = tonumber(ARGV[1])
local ttl   = tonumber(ARGV[2])

local used = tonumber(redis.call('GET', key) or '0')

if used < limit then
  local newValue = redis.call('INCR', key)
  if newValue == 1 then
    redis.call('EXPIRE', key, ttl)
  end
  return { 1, newValue }
end

return { 0, used }
`;

export interface RateLimitWindow {
  /**
   * Sortable UTC bucket label, e.g. `2026-09-19T15`.
   * The full Redis key is built by `rateLimitKey(senderId, window)` — deliberately
   * NOT stored here, because the same window is shared by every sender and a
   * `key` field without a sender in it is a footgun.
   */
  label: string;
  /** Inclusive start of the window (UTC). */
  startUtc: Date;
  /** Exclusive end of the window (UTC) — also the next window's start. */
  endUtc: Date;
}

export interface RateLimitReservation {
  allowed: boolean;
  /** Counter value after this call (the reserved count when allowed). */
  used: number;
  limit: number;
  window: RateLimitWindow;
  /** When denied: the earliest moment quota becomes available again. */
  retryAtUtc: Date | null;
  /** When denied: milliseconds until `retryAtUtc`. */
  retryInMs: number | null;
}

/** Formats a Date as the UTC hour bucket `YYYY-MM-DDTHH`. */
function hourLabel(date: Date): string {
  const iso = date.toISOString(); // 2026-09-19T15:04:05.123Z
  return iso.slice(0, 13);
}

/** The hour bucket containing `now`. */
export function utcHourWindow(now: Date = new Date()): RateLimitWindow {
  const startUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0, 0),
  );
  const endUtc = new Date(startUtc.getTime() + 60 * 60 * 1000);
  const label = hourLabel(startUtc);
  return { label, startUtc, endUtc };
}

/** The window that follows `window` (where a rate-limited email waits). */
export function nextHourWindow(window: RateLimitWindow): RateLimitWindow {
  const startUtc = window.endUtc;
  const endUtc = new Date(startUtc.getTime() + 60 * 60 * 1000);
  const label = hourLabel(startUtc);
  return { label, startUtc, endUtc };
}

export function rateLimitKey(senderId: string, window: RateLimitWindow): string {
  // Exactly the shape specified in the brief: sender:<id>:hour:<utc-hour>
  return `sender:${senderId}:hour:${window.label}`;
}

/** Human-readable window, used in Slack messages and logs: "15:00–16:00 UTC". */
export function describeWindow(window: RateLimitWindow): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  const from = `${pad(window.startUtc.getUTCHours())}:${pad(window.startUtc.getUTCMinutes())}`;
  const to = `${pad(window.endUtc.getUTCHours())}:${pad(window.endUtc.getUTCMinutes())}`;
  const day = window.startUtc.toISOString().slice(0, 10);
  return `${from}–${to} UTC (${day})`;
}

/**
 * Atomically checks the limit and, if there is room, consumes one slot.
 *
 * The reservation happens BEFORE the SMTP call on purpose: reserving after a
 * successful send would let concurrent workers all pass the check first and
 * collectively exceed the limit.
 *
 * Consequence, stated honestly: a reservation is consumed even if the subsequent
 * SMTP attempt fails. That is the safe direction — we would rather under-send
 * than breach a provider's quota.
 */
export async function reserveEmailSend(
  senderId: string,
  limit: number,
  now: Date = new Date(),
): Promise<RateLimitReservation> {
  const window = utcHourWindow(now);
  const key = rateLimitKey(senderId, window);
  const ttlSeconds = Math.ceil((window.endUtc.getTime() - now.getTime()) / 1000) + 3600;

  const raw = (await getRedis().eval(RESERVE_SCRIPT, 1, key, String(limit), String(ttlSeconds))) as
    | [number, number]
    | number[];

  const allowedFlag = Number(raw[0]);
  const used = Number(raw[1]);
  const allowed = allowedFlag === 1;

  if (allowed) {
    return { allowed: true, used, limit, window, retryAtUtc: null, retryInMs: null };
  }

  // Denied: point at the next bucket. Callers must RESCHEDULE, never drop.
  const retryWindow = nextHourWindow(window);
  const retryAtUtc = retryWindow.startUtc;

  log.warn('Hourly limit reached', {
    senderId,
    used,
    limit,
    window: describeWindow(window),
    rescheduleTo: retryAtUtc.toISOString(),
  });

  return {
    allowed: false,
    used,
    limit,
    window,
    retryAtUtc,
    retryInMs: Math.max(retryAtUtc.getTime() - now.getTime(), 0),
  };
}

/** Read-only usage for the API/dashboard (does not consume a slot). */
export async function peekUsage(
  senderId: string,
  limit: number,
  now: Date = new Date(),
): Promise<{ used: number; limit: number; window: RateLimitWindow; resetsAtUtc: string }> {
  const window = utcHourWindow(now);
  const raw = await getRedis().get(rateLimitKey(senderId, window));
  const used = raw === null ? 0 : Number.parseInt(raw, 10);
  return {
    used: Number.isNaN(used) ? 0 : used,
    limit,
    window,
    resetsAtUtc: window.endUtc.toISOString(),
  };
}

/**
 * "Has this window already been reported to Slack?" — SET NX, so exactly one
 * worker among all concurrent workers wins the race and sends the notification.
 *
 * Without this, hitting the limit with 25 queued emails would post 25 identical
 * Slack messages. The notification represents the *event* (a sender exhausted its
 * hourly quota), not each blocked job.
 *
 * The key expires shortly after the window ends, so the next hour notifies again
 * while old keys clean themselves up.
 */
export async function claimRateLimitNotification(
  senderId: string,
  window: RateLimitWindow,
): Promise<boolean> {
  const key = `rate-limit:notified:${senderId}:${window.label}`;
  const ttlSeconds = Math.ceil((window.endUtc.getTime() - Date.now()) / 1000) + 3600;

  const result = await getRedis().set(key, new Date().toISOString(), 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}

/** Clears the notification claim (used when a Slack send fails, so we can retry later). */
export async function releaseNotificationClaim(
  senderId: string,
  window: RateLimitWindow,
): Promise<void> {
  await getRedis().del(`rate-limit:notified:${senderId}:${window.label}`);
}
