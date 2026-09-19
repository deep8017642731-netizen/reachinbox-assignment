import { beforeEach, describe, expect, it } from 'vitest';
import {
  utcHourWindow,
  nextHourWindow,
  rateLimitKey,
  describeWindow,
  reserveEmailSend,
} from '../src/services/rate-limit.service';
import { getRedis } from '../src/lib/redis';

describe('rate-limit service', () => {
  const senderId = 'test-sender-123';

  beforeEach(async () => {
  const redis = getRedis();

  const keys = [
    `sender:${senderId}:hour:2026-09-19T15`,
    `sender:${senderId}:hour:2026-09-19T16`,
  ];

  if (keys.length > 0) {
    await redis.del(...keys);
  }
});

  describe('UTC hour windows', () => {
    it('creates the correct UTC hour bucket', () => {
      const now = new Date('2026-09-19T15:37:42.123Z');
      const window = utcHourWindow(now);

      expect(window.label).toBe('2026-09-19T15');
      expect(window.startUtc.toISOString()).toBe(
        '2026-09-19T15:00:00.000Z',
      );
      expect(window.endUtc.toISOString()).toBe(
        '2026-09-19T16:00:00.000Z',
      );
    });

    it('calculates the following hour', () => {
      const window = utcHourWindow(
        new Date('2026-09-19T15:37:42.123Z'),
      );

      const next = nextHourWindow(window);

      expect(next.label).toBe('2026-09-19T16');
      expect(next.startUtc.toISOString()).toBe(
        '2026-09-19T16:00:00.000Z',
      );
      expect(next.endUtc.toISOString()).toBe(
        '2026-09-19T17:00:00.000Z',
      );
    });
  });

  describe('rateLimitKey', () => {
    it('creates a sender-specific hourly Redis key', () => {
      const window = utcHourWindow(
        new Date('2026-09-19T15:37:42.123Z'),
      );

      expect(rateLimitKey(senderId, window)).toBe(
        'sender:test-sender-123:hour:2026-09-19T15',
      );
    });
  });

  describe('describeWindow', () => {
    it('creates a human-readable UTC window', () => {
      const window = utcHourWindow(
        new Date('2026-09-19T15:37:42.123Z'),
      );

      expect(describeWindow(window)).toBe(
        '15:00–16:00 UTC (2026-09-19)',
      );
    });
  });

  describe('reserveEmailSend', () => {
    it('allows sends until the configured limit', async () => {
      const now = new Date('2026-09-19T15:10:00.000Z');

      const first = await reserveEmailSend(senderId, 2, now);
      const second = await reserveEmailSend(senderId, 2, now);

      expect(first.allowed).toBe(true);
      expect(first.used).toBe(1);

      expect(second.allowed).toBe(true);
      expect(second.used).toBe(2);
    });

    it('denies sends after the hourly limit is reached', async () => {
      const now = new Date('2026-09-19T15:10:00.000Z');

      await reserveEmailSend(senderId, 1, now);

      const denied = await reserveEmailSend(senderId, 1, now);

      expect(denied.allowed).toBe(false);
      expect(denied.used).toBe(1);
      expect(denied.limit).toBe(1);
      expect(denied.retryAtUtc?.toISOString()).toBe(
        '2026-09-19T16:00:00.000Z',
      );
      expect(denied.retryInMs).toBe(50 * 60 * 1000);
    });

    it('does not consume quota when a send is denied', async () => {
      const now = new Date('2026-09-19T15:10:00.000Z');

      await reserveEmailSend(senderId, 1, now);
      await reserveEmailSend(senderId, 1, now);

      const usage = await reserveEmailSend(senderId, 1, now);

      expect(usage.allowed).toBe(false);
      expect(usage.used).toBe(1);
    });

    it('uses a new quota bucket in the next hour', async () => {
      const firstHour = new Date('2026-09-19T15:59:00.000Z');
      const nextHour = new Date('2026-09-19T16:01:00.000Z');

      const first = await reserveEmailSend(senderId, 1, firstHour);
      const second = await reserveEmailSend(senderId, 1, nextHour);

      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(true);
      expect(second.used).toBe(1);
    });
  });
});
