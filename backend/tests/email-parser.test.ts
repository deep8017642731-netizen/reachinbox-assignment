import { describe, expect, it } from 'vitest';
import {
  isValidEmail,
  normaliseEmail,
  normaliseRecipients,
  parseRecipientsFromText,
  MAX_RECIPIENTS_PER_REQUEST,
} from '../src/utils/email-parser';

describe('email-parser', () => {
  describe('isValidEmail', () => {
    it('accepts valid email addresses', () => {
      expect(isValidEmail('john@example.com')).toBe(true);
      expect(isValidEmail('John.Doe+test@example.co.uk')).toBe(true);
    });

    it('rejects malformed email addresses', () => {
      expect(isValidEmail('not-an-email')).toBe(false);
      expect(isValidEmail('john@localhost')).toBe(false);
      expect(isValidEmail('john..doe@example.com')).toBe(false);
      expect(isValidEmail('.john@example.com')).toBe(false);
      expect(isValidEmail('john.@example.com')).toBe(false);
      expect(isValidEmail('john@example..com')).toBe(false);
    });
  });

  describe('normaliseEmail', () => {
    it('trims whitespace and lowercases the address', () => {
      expect(normaliseEmail('  John.Doe@Example.COM  ')).toBe(
        'john.doe@example.com',
      );
    });
  });

  describe('normaliseRecipients', () => {
    it('normalises, deduplicates and preserves order', () => {
      const result = normaliseRecipients([
        ' Alice@Example.com ',
        'bob@example.com',
        'alice@example.com',
        'invalid-email',
      ]);

      expect(result.valid).toEqual([
        'alice@example.com',
        'bob@example.com',
      ]);
      expect(result.invalid).toEqual(['invalid-email']);
      expect(result.duplicatesRemoved).toBe(1);
      expect(result.totalCandidates).toBe(4);
      expect(result.truncated).toBe(false);
    });

    it('ignores empty values', () => {
      const result = normaliseRecipients([
        '',
        '   ',
        'test@example.com',
      ]);

      expect(result.valid).toEqual(['test@example.com']);
      expect(result.invalid).toEqual([]);
    });
  });

  describe('parseRecipientsFromText', () => {
    it('extracts emails from CSV/TXT style text', () => {
      const result = parseRecipientsFromText(`
        name,email
        Alice,Alice@example.com
        Bob,bob@example.com
        Alice Again,ALICE@example.com
      `);

      expect(result.valid).toEqual([
        'alice@example.com',
        'bob@example.com',
      ]);
      expect(result.duplicatesRemoved).toBe(1);
    });

    it('supports comma and semicolon separated addresses', () => {
      const result = parseRecipientsFromText(
        'one@example.com, two@example.com; three@example.com',
      );

      expect(result.valid).toEqual([
        'one@example.com',
        'two@example.com',
        'three@example.com',
      ]);
    });

    it('skips non-email CSV headers', () => {
      const result = parseRecipientsFromText(
        'name,email,company\nAlice,alice@example.com,Acme',
      );

      expect(result.valid).toEqual(['alice@example.com']);
      expect(result.totalCandidates).toBe(1);
    });

    it('enforces the 1000-recipient limit', () => {
      const addresses = Array.from(
        { length: MAX_RECIPIENTS_PER_REQUEST + 50 },
        (_, index) => `user${index}@example.com`,
      );

      const result = parseRecipientsFromText(addresses.join('\n'));

      expect(result.valid).toHaveLength(MAX_RECIPIENTS_PER_REQUEST);
      expect(result.truncated).toBe(true);
    });
  });
});
