/**
 * Email address parsing and normalisation.
 *
 * Used by two callers with different input shapes:
 *   1. The API (`recipients: string[]`) -> `normaliseRecipients`
 *   2. File upload (CSV / TXT / pasted text) -> `parseRecipientsFromText`
 *
 * DESIGN DECISION — why a hand-written validator instead of one big regex:
 * A single "validate an email" regex is unreadable and impossible to explain in
 * an interview. We check shape first, then apply explicit rules (length caps,
 * no consecutive dots, valid domain labels). Every rule below maps to a real
 * cause of bounces, and each one is individually testable.
 *
 * NOTE ON DELIVERABILITY: syntactic validity does NOT mean the mailbox exists.
 * `nobody@example.com` passes every check here and still bounces. Only the SMTP
 * server can tell you that, which is why the worker records SMTP failures.
 */

/** Hard cap per scheduling request (the assignment's 1000-email scenario). */
export const MAX_RECIPIENTS_PER_REQUEST = 1000;

/** Local part maximum, per RFC 5321. */
const MAX_LOCAL_LENGTH = 64;
/** Whole address maximum, per RFC 5321. */
const MAX_EMAIL_LENGTH = 254;

/** `local@domain` shape check; explicit rules are applied afterwards. */
const EMAIL_SHAPE = /^([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+)$/;
/** A single DNS label: alphanumeric, may contain inner hyphens, max 63 chars. */
const DOMAIN_LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
/** Top-level domain: letters only. */
const TLD = /^[A-Za-z]{2,63}$/;

/**
 * Splits free text into candidate tokens so we can tell the user *which*
 * addresses were rejected, not just how many.
 * Handles CSV rows, one-per-line files, semicolons and pasted comma lists.
 */
const CANDIDATE_SPLITTER = /[\s,;]+/;

export function isValidEmail(value: string): boolean {
  const email = value.trim();

  if (email.length < 6 || email.length > MAX_EMAIL_LENGTH) return false;
  // `john..doe@x.com` and `x@example..com` are invalid, and a single check here
  // also rejects the `..` produced by accidental double-dots in spreadsheets.
  if (email.includes('..')) return false;

  const match = EMAIL_SHAPE.exec(email);
  if (!match) return false;

  const [, local, domain] = match;

  if (local.length > MAX_LOCAL_LENGTH) return false;
  if (local.startsWith('.') || local.endsWith('.')) return false;

  const labels = domain.split('.');
  // Needs at least one dot: `user@localhost` is not a public email address.
  if (labels.length < 2) return false;

  if (!TLD.test(labels[labels.length - 1])) return false;
  return labels.every((label) => DOMAIN_LABEL.test(label));
}

/**
 * Emails are case-insensitive in practice (the domain always is, and every
 * mainstream provider treats the local part as case-insensitive too), so we
 * lowercase for deduplication. Without this, `John@X.com` and `john@x.com`
 * would be scheduled as two separate emails to the same person.
 */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export interface ParsedRecipients {
  /** Valid, lowercased, de-duplicated, order preserved. */
  valid: string[];
  /** Tokens that look like an address but failed validation. */
  invalid: string[];
  /** How many valid duplicates were dropped. */
  duplicatesRemoved: number;
  /** Total candidate tokens seen (valid + invalid). */
  totalCandidates: number;
  /** True when the cap forced us to ignore valid addresses. */
  truncated: boolean;
}

/**
 * Parses an explicit list (already separated by the caller): the JSON API path.
 * An address here is expected to be exactly one address — stray whitespace is
 * tolerated, but `"a@b.com,c@d.com"` in a single array element is rejected by
 * the Zod layer before reaching this function.
 */
export function normaliseRecipients(values: string[]): ParsedRecipients {
  const result: ParsedRecipients = {
    valid: [],
    invalid: [],
    duplicatesRemoved: 0,
    totalCandidates: values.length,
    truncated: false,
  };

  const seen = new Set<string>();

  for (const value of values) {
    const trimmed = value?.trim() ?? '';
    if (trimmed === '') continue;

    if (!isValidEmail(trimmed)) {
      result.invalid.push(trimmed);
      continue;
    }

    const email = normaliseEmail(trimmed);
    if (seen.has(email)) {
      result.duplicatesRemoved += 1;
      continue;
    }

    seen.add(email);
    result.valid.push(email);
  }

  return result;
}

/**
 * Extracts every email address it can find in raw file content.
 *
 * Deliberately scans the WHOLE text rather than assuming a CSV column layout:
 * leads files in the wild have headers in any order (`email`, `Email`, `E-mail`,
 * `work_email`), may be semicolon-delimited, or may be plain lists. Scanning
 * means "leads.csv with an email column anywhere" just works, and no parsing
 * library is needed for this to be correct.
 */
export function parseRecipientsFromText(raw: string): ParsedRecipients {
  const result: ParsedRecipients = {
    valid: [],
    invalid: [],
    duplicatesRemoved: 0,
    totalCandidates: 0,
    truncated: false,
  };

  const seen = new Set<string>();

  for (const token of raw.split(CANDIDATE_SPLITTER)) {
    // Strip CSV/Excel noise: quotes, trailing commas, stray angle brackets.
    const candidate = token.replace(/^["'<\s]+|["'>\s;]+$/g, '');
    if (candidate === '') continue;
    // Skip header words and other non-addresses silently — they are not errors.
    if (!candidate.includes('@')) continue;

    result.totalCandidates += 1;

    if (!isValidEmail(candidate)) {
      result.invalid.push(candidate);
      continue;
    }

    const email = normaliseEmail(candidate);
    if (seen.has(email)) {
      result.duplicatesRemoved += 1;
      continue;
    }

    if (result.valid.length >= MAX_RECIPIENTS_PER_REQUEST) {
      result.truncated = true;
      break;
    }

    seen.add(email);
    result.valid.push(email);
  }

  return result;
}
