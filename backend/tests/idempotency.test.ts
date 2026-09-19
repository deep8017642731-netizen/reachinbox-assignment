import { describe, expect, it } from 'vitest';
import {
  decideDelivery,
  isTerminalStatus,
} from '../src/utils/idempotency';

describe('idempotency', () => {
  describe('decideDelivery', () => {
    it('skips an already sent email', () => {
      expect(decideDelivery('SENT')).toEqual({
        action: 'skip',
        reason: 'already-sent',
      });
    });

    it('skips a cancelled email', () => {
      expect(decideDelivery('CANCELLED')).toEqual({
        action: 'skip',
        reason: 'cancelled',
      });
    });

    it('skips a permanently failed email', () => {
      expect(decideDelivery('FAILED')).toEqual({
        action: 'skip',
        reason: 'permanently-failed',
      });
    });

    it('allows scheduled emails to be sent', () => {
      expect(decideDelivery('SCHEDULED')).toEqual({
        action: 'send',
      });
    });

    it('allows processing emails to be retried', () => {
      expect(decideDelivery('PROCESSING')).toEqual({
        action: 'send',
      });
    });
  });

  describe('isTerminalStatus', () => {
    it('recognises SENT as terminal', () => {
      expect(isTerminalStatus('SENT')).toBe(true);
    });

    it('recognises CANCELLED as terminal', () => {
      expect(isTerminalStatus('CANCELLED')).toBe(true);
    });

    it('does not treat SCHEDULED as terminal', () => {
      expect(isTerminalStatus('SCHEDULED')).toBe(false);
    });

    it('does not treat PROCESSING as terminal', () => {
      expect(isTerminalStatus('PROCESSING')).toBe(false);
    });

    it('does not treat FAILED as terminal', () => {
      expect(isTerminalStatus('FAILED')).toBe(false);
    });
  });
});
