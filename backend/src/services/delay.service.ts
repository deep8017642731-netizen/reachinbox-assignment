/**
 * Minimum delay between sends — a Redis-backed "send gate".
 *
 * THE PROBLEM
 * `MIN_EMAIL_DELAY_MS` (default 2000) means "at least two seconds between two
 * emails". With `WORKER_CONCURRENCY=5`, five jobs are processed at the same
 * instant. A `sleep()` inside the worker does not enforce anything globally: five
 * concurrent handlers would sleep and then all send, so the real gap could be
 * zero. A module-level `let lastSentAt` has the same problem as an in-memory rate
 * counter — each process (and each concurrent handler) has its own copy.
 *
 * THE SOLUTION
 * One Redis key per sender holds the timestamp of the last admitted send. A Lua
 * script performs check-and-reserve atomically:
 *
 *   wait = lastSendAt + gap - now
 *     wait <= 0  ->  store now, return 0     (this job may send immediately)
 *     wait >  0  ->  change nothing, return wait   (caller must come back later)
 *
 * Because Redis executes the script as a single unit, two workers can never both
 * believe they own the current slot.
 *
 * WHY PER SENDER AND NOT GLOBAL
 * A global gate would mean one user's 1000-email campaign throttles every other
 * user's single email, which is unfair in a multi-tenant product and would make
 * `MIN_EMAIL_DELAY_MS` behave like a global throughput cap rather than a pacing
 * control. Per sender matches the business intent ("space out this campaign's
 * emails") and lets different senders proceed in parallel. The trade-off is
 * documented in the README: total system throughput scales with the number of
 * active senders, not with a global constant.
 *
 * HONEST LIMITATION
 * The slot is reserved at admission time, a few milliseconds before the SMTP call
 * completes. Retries of a failed send do not bypass the gate (they go through it
 * again), which is the behaviour we want, but the enforced spacing is
 * "time between admitted sends", not "time between successfully delivered
 * messages".
 */
import { getRedis } from '../lib/redis';
import { createLogger } from '../lib/logger';

const log = createLogger('DelayGate');

/**
 * Atomic check-and-reserve.
 * KEYS[1] = gate key for one sender
 * ARGV[1] = current time (ms since epoch)
 * ARGV[2] = required gap (ms)
 * ARGV[3] = key TTL (ms) — keeps stale keys from living forever
 * Returns 0 when the slot was acquired, otherwise the ms remaining to wait.
 */
const ACQUIRE_SCRIPT = `
local key  = KEYS[1]
local now  = tonumber(ARGV[1])
local gap  = tonumber(ARGV[2])
local ttl  = tonumber(ARGV[3])

local last = tonumber(redis.call('GET', key) or '0')
local waitMs = last + gap - now

if waitMs <= 0 then
  redis.call('SET', key, now, 'PX', ttl)
  return 0
end

return waitMs
`;

export function delayGateKey(senderId: string): string {
  return `sender:${senderId}:last-send`;
}

/**
 * Attempts to claim the next send slot for a sender.
 *
 * @returns 0 when the caller may send now; otherwise the number of milliseconds
 *          to wait before trying again. Never throws when the gate is closed —
 *          "closed" is a normal outcome, not an error.
 */
export async function acquireSendSlot(
  senderId: string,
  gapMs: number,
  now: number = Date.now(),
): Promise<number> {
  // Nothing to enforce.
  if (gapMs <= 0) return 0;

  // Expire well after the gap so a stopped worker does not block sends forever,
  // while still preventing an unnecessary round trip on the next send.
  const ttlMs = Math.max(gapMs * 4, 60_000);

  const raw = await getRedis().eval(
    ACQUIRE_SCRIPT,
    1,
    delayGateKey(senderId),
    String(now),
    String(gapMs),
    String(ttlMs),
  );

  return Number(raw);
}

/** Read-only inspection of the last admitted send (used by /api/health and logs). */
export async function peekLastSendAt(senderId: string): Promise<Date | null> {
  const raw = await getRedis().get(delayGateKey(senderId));
  if (raw === null) return null;
  const ms = Number.parseInt(raw, 10);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * Computes the effective gap for an email: the value requested at scheduling
 * time, raised to the configured floor. A request asking for 100 ms cannot go
 * faster than MIN_EMAIL_DELAY_MS.
 */
export function effectiveDelayMs(requestedMs: number, floorMs: number): number {
  const effective = Math.max(requestedMs, floorMs);
  if (effective !== requestedMs) {
    log.debug('Raised requested delay to the configured floor', { requestedMs, floorMs });
  }
  return effective;
}
