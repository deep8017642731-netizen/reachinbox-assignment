/**
 * Elasticsearch — the search index for emails.
 *
 * WHY ELASTICSEARCH WHEN POSTGRESQL ALREADY EXISTS?
 * They answer different questions:
 *   PostgreSQL : "give me my emails, newest first"      (exact, structured, fast)
 *   Elasticsearch: "find emails mentioning 'acme'"       (fuzzy, relevance-ranked,
 *                  across recipient + subject + body)     typo-tolerant, scored)
 * You *can* do the second with `ILIKE '%acme%'`, but that cannot use an index, so
 * it scans every row, cannot rank results, cannot tolerate typos, and degrades as
 * the table grows. Elasticsearch is built for exactly that query.
 *
 * ARCHITECTURAL RULE: Elasticsearch is an INDEX, not the source of truth.
 *  - Writes: PostgreSQL commits first; the index is updated afterwards.
 *  - Reads: search returns matching ids, then PostgreSQL hydrates the rows so the
 *    status/body you see is always the authoritative one.
 *
 * THE MOST IMPORTANT PROPERTY OF THIS FILE: it can never break email delivery.
 * Every function is failure-tolerant. If Elasticsearch is down, indexing is
 * skipped (and logged), emails still send, and the API still works — only
 * `/api/emails/search` reports that search is unavailable.
 */
import { Client } from '@elastic/elasticsearch';
import { env } from '../config/env';
import { createLogger } from '../lib/logger';

const log = createLogger('Elasticsearch');

export const EMAIL_INDEX = env.ELASTICSEARCH_EMAIL_INDEX;

/**
 * Explicit mapping. Letting Elasticsearch guess ("dynamic mapping") would index
 * `status` as analysed text, so a future `term` filter for "SENT" would fail
 * mysteriously. Declaring the mapping makes each field behave predictably:
 *
 *  - `keyword`  : exact match / filter / aggregation. No analysis.
 *  - `text`     : full-text search, analysed into tokens.
 *  - `date`     : correctly parseable/sortable timestamps.
 *
 * `recipient` is `text` WITH a `keyword` sub-field: `text` lets a search for
 * "john" match `john@example.com` (the standard analyser splits on `@` and `.`),
 * while `recipient.keyword` still supports exact-match filtering.
 */
const EMAIL_INDEX_MAPPING = {
  properties: {
    id: { type: 'keyword' },
    userId: { type: 'keyword' },
    senderId: { type: 'keyword' },
    senderEmail: { type: 'keyword' },
    batchId: { type: 'keyword' },
    recipient: {
      type: 'text',
      fields: { keyword: { type: 'keyword', ignore_above: 256 } },
    },
    subject: {
      type: 'text',
      fields: { keyword: { type: 'keyword', ignore_above: 512 } },
    },
    body: { type: 'text' },
    status: { type: 'keyword' },
    scheduledAt: { type: 'date' },
    sentAt: { type: 'date' },
    createdAt: { type: 'date' },
  },
} as const;

let client: Client | null = null;
let indexVerified = false;

/** Tracks a recent failure so we stop hammering an unreachable cluster. */
let lastFailureAt = 0;
const FAILURE_COOLDOWN_MS = 30_000;

function getClient(): Client {
  if (!client) {
    client = new Client({
      node: env.ELASTICSEARCH_URL,
      auth:
        env.ELASTICSEARCH_USERNAME && env.ELASTICSEARCH_PASSWORD
          ? { username: env.ELASTICSEARCH_USERNAME, password: env.ELASTICSEARCH_PASSWORD }
          : undefined,
      // Keep request timeouts short: a slow search index must not hold up an
      // HTTP request or a worker for 30 seconds.
      requestTimeout: 5_000,
      maxRetries: 2,
    });
  }
  return client;
}

/** The document shape stored in the index (a projection of the Email row). */
export interface EmailDocument {
  id: string;
  userId: string;
  senderId: string;
  senderEmail: string;
  batchId: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  createdAt: string;
}

/** Row shape needed to build a document (structurally satisfied by Prisma rows). */
export interface IndexableEmail {
  id: string;
  userId: string;
  senderId: string;
  batchId: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: Date;
  sentAt: Date | null;
  createdAt: Date;
  sender?: { email: string } | null;
}

function toDocument(email: IndexableEmail): EmailDocument {
  return {
    id: email.id,
    userId: email.userId,
    senderId: email.senderId,
    senderEmail: email.sender?.email ?? '',
    batchId: email.batchId,
    recipient: email.recipient,
    subject: email.subject,
    body: email.body,
    status: email.status,
    scheduledAt: email.scheduledAt.toISOString(),
    sentAt: email.sentAt?.toISOString() ?? null,
    createdAt: email.createdAt.toISOString(),
  };
}

function inFailureCooldown(): boolean {
  return Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS;
}

function recordFailure(error: unknown, operation: string, extra?: Record<string, unknown>): void {
  lastFailureAt = Date.now();
  log.warn(`Elasticsearch ${operation} failed — continuing without search index`, {
    error: error instanceof Error ? error.message.split('\n')[0] : String(error),
    cooldownSeconds: FAILURE_COOLDOWN_MS / 1000,
    ...extra,
  });
}

/** Creates the index + mapping on first use; safe to call repeatedly. */
export async function ensureIndex(): Promise<boolean> {
  if (indexVerified) return true;

  const es = getClient();
  const exists = await es.indices.exists({ index: EMAIL_INDEX });

  if (!exists) {
    await es.indices.create({
      index: EMAIL_INDEX,
      mappings: EMAIL_INDEX_MAPPING,
      settings: {
        // One shard is right for a single-node demo cluster; the default of one
        // primary + one replica would stay permanently "yellow" here.
        number_of_shards: 1,
        number_of_replicas: 0,
      },
    });
    log.info('Created search index', { index: EMAIL_INDEX });
  }

  indexVerified = true;
  return true;
}

/**
 * Indexes (or re-indexes) a batch of emails. NEVER throws.
 *
 * Called after scheduling and after every status change (SENT / FAILED /
 * CANCELLED) so the index reflects the latest state. A failure here is logged and
 * swallowed — losing a search document is a far smaller problem than losing an
 * email, and re-indexing can be replayed later.
 */
export async function indexEmailsSafely(emails: IndexableEmail[]): Promise<void> {
  if (emails.length === 0) return;
  if (inFailureCooldown()) return;

  try {
    await ensureIndex();
    const es = getClient();

    const operations = emails.flatMap((email) => [
      { index: { _index: EMAIL_INDEX, _id: email.id } },
      toDocument(email),
    ]);

    const response = await es.bulk({ operations, refresh: true });

    if (response.errors) {
      // Report WHICH document failed; a single bad document must not hide itself.
      const failed = response.items.filter((item) => item.index?.error);
      log.error('Some documents failed to index', {
        failedCount: failed.length,
        firstError: failed[0]?.index?.error?.reason,
      });
      lastFailureAt = Date.now();
      return;
    }

    log.info('Indexed emails', { count: emails.length, index: EMAIL_INDEX });
  } catch (error) {
    recordFailure(error, 'bulk index', { count: emails.length });
  }
}

/** Removes a document (e.g. an email deleted from the database). */
export async function deleteEmailFromIndex(emailId: string): Promise<void> {
  if (inFailureCooldown()) return;
  try {
    await ensureIndex();
    await getClient().delete({ index: EMAIL_INDEX, id: emailId }, { ignore: [404] });
  } catch (error) {
    recordFailure(error, 'delete', { emailId });
  }
}

export interface SearchHit {
  emailId: string;
  score: number | null;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
}

/**
 * Full-text search restricted to ONE user.
 *
 * The `userId` filter is a `filter` clause (not `must`), so it does not
 * contribute to the relevance score, and — critically — it is applied inside the
 * query rather than after it. Filtering after the fact would leak the *number* of
 * another user's matches through the total count.
 */
export async function searchEmails(
  userId: string,
  query: string,
  page: number,
  limit: number,
): Promise<SearchResult> {
  await ensureIndex();
  const es = getClient();

  const response = await es.search<EmailDocument>({
    index: EMAIL_INDEX,
    query: {
      bool: {
        filter: [{ term: { userId } }],
        must: [
          {
            multi_match: {
              query,
              // Recipient and subject outrank the body: matching an address is a
              // stronger signal than the phrase appearing deep in the message.
              fields: ['recipient^3', 'subject^2', 'body'],
              type: 'best_fields',
              // Tolerates typos ("jhon@example.com") — a capability PostgreSQL
              // `LIKE` cannot provide.
              fuzziness: 'AUTO',
            },
          },
        ],
      },
    },
    // Accurate totals even beyond 10k matches (the default caps at 10k).
    track_total_hits: true,
    sort: [{ _score: { order: 'desc' } }, { createdAt: { order: 'desc' } }],
    from: (page - 1) * limit,
    size: limit,
  });

  const hits = response.hits.hits.map((hit) => ({
    emailId: hit._id ?? hit._source?.id ?? '',
    score: typeof hit._score === 'number' ? hit._score : null,
  }));

  const total =
    typeof response.hits.total === 'number'
      ? response.hits.total
      : (response.hits.total?.value ?? hits.length);

  return { hits: hits.filter((hit) => hit.emailId !== ''), total };
}

export interface ElasticsearchHealth {
  ok: boolean;
  index?: string;
  documentCount?: number;
  error?: string;
}

/** Cluster ping + document count, used by GET /api/health. */
export async function checkElasticsearch(): Promise<ElasticsearchHealth> {
  try {
    await ensureIndex();
    const es = getClient();
    const count = await es.count({ index: EMAIL_INDEX });
    return { ok: true, index: EMAIL_INDEX, documentCount: count.count };
  } catch (error) {
    return {
      ok: false,
      index: EMAIL_INDEX,
      error: error instanceof Error ? error.message.split('\n')[0] : 'unknown error',
    };
  }
}

/** True when search is currently usable (used to degrade the API gracefully). */
export async function isElasticsearchAvailable(): Promise<boolean> {
  if (inFailureCooldown()) return false;
  try {
    await ensureIndex();
    await getClient().ping();
    return true;
  } catch (error) {
    recordFailure(error, 'ping');
    return false;
  }
}

export async function closeElasticsearch(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    indexVerified = false;
  }
}
