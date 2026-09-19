/**
 * Client-side lead-file parsing.
 *
 * WHY PARSE ON THE CLIENT AT ALL, GIVEN THE BACKEND ALSO PARSES
 *  - Immediate feedback: the user sees "12 addresses detected" the moment they
 *    pick a file, with no upload round trip.
 *  - Privacy and cost: for a large list, nothing is transmitted until the user
 *    actually schedules.
 * The backend still re-parses every address before scheduling (POST /schedule
 * validates each one), because a client can never be trusted. The two
 * implementations follow the same rules deliberately — the backend file is the
 * reference: backend/src/utils/email-parser.ts.
 *
 * This is plain TypeScript with no dependencies, so it works in the browser and
 * is trivial to unit test.
 */

/** Matches the backend's per-request cap. */
export const MAX_RECIPIENTS = 1000;

const MAX_LOCAL_LENGTH = 64;
const MAX_EMAIL_LENGTH = 254;
const EMAIL_SHAPE = /^([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+)$/;
const DOMAIN_LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const TLD = /^[A-Za-z]{2,63}$/;
const CANDIDATE_SPLITTER = /[\s,;]+/;

export interface ParsedLeadsResult {
  valid: string[];
  invalid: string[];
  duplicatesRemoved: number;
  totalCandidates: number;
  truncated: boolean;
}

export function isValidEmail(value: string): boolean {
  const email = value.trim();
  if (email.length < 6 || email.length > MAX_EMAIL_LENGTH) return false;
  // Also rejects the double dots produced by a stray blank spreadsheet cell.
  if (email.includes('..')) return false;

  const match = EMAIL_SHAPE.exec(email);
  if (!match) return false;

  const [, local, domain] = match as unknown as [string, string, string];
  if (local.length > MAX_LOCAL_LENGTH) return false;
  if (local.startsWith('.') || local.endsWith('.')) return false;

  const labels = domain.split('.');
  if (labels.length < 2) return false;
  if (!TLD.test(labels[labels.length - 1] as string)) return false;
  return labels.every((label) => DOMAIN_LABEL.test(label));
}

/**
 * Extracts addresses from raw file text.
 *
 * Scans the whole file rather than assuming a column layout: lead exports put the
 * address column in any position, under any header (`email`, `E-mail`,
 * `work_email`), use commas, semicolons or newlines, and often include a name
 * column. Scanning for "anything that looks like an address" handles all of them
 * without a CSV parsing library.
 */
export function parseLeadsText(raw: string): ParsedLeadsResult {
  const result: ParsedLeadsResult = {
    valid: [],
    invalid: [],
    duplicatesRemoved: 0,
    totalCandidates: 0,
    truncated: false,
  };

  const seen = new Set<string>();
  const lowercased = raw;

  for (const token of lowercased.split(CANDIDATE_SPLITTER)) {
    // Strip quotes/brackets/spaces that surround addresses in CSV and exports.
    const candidate = token.replace(/^["'<\s]+|["'>\s;]+$/g, '');
    if (candidate === '') continue;
    // Skip headers and other non-addresses silently: they are not user errors.
    if (!candidate.includes('@')) continue;

    result.totalCandidates += 1;

    if (!isValidEmail(candidate)) {
      result.invalid.push(candidate);
      continue;
    }

    // Case-insensitive comparison so John@X.com and john@x.com count as one.
    const email = candidate.toLowerCase();
    if (seen.has(email)) {
      result.duplicatesRemoved += 1;
      continue;
    }

    if (result.valid.length >= MAX_RECIPIENTS) {
      result.truncated = true;
      break;
    }

    seen.add(email);
    result.valid.push(email);
  }

  return result;
}

/**
 * Reads a File into text. Rejects oversized files before reading them into
 * memory, and validates the extension so a .xlsx does not silently parse to
 * nothing (the backend enforces the same 2 MB / .csv|.txt limits).
 */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export async function parseLeadsFile(file: File): Promise<ParsedLeadsResult> {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!['.csv', '.txt'].includes(extension)) {
    throw new Error('Only .csv and .txt files are supported');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error('File is larger than 2 MB');
  }

  const text = await file.text();
  return parseLeadsText(text);
}

/** Parses a pasted list (one address per line, or comma/semicolon separated). */
export function parseLeadsPasted(text: string): ParsedLeadsResult {
  return parseLeadsText(text);
}
