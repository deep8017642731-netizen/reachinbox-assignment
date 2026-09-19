/**
 * Rebuilds the Elasticsearch index from PostgreSQL.
 *
 *   npm run es:reindex
 *
 * WHY THIS SCRIPT EXISTS (and why it is a feature, not a utility)
 * Elasticsearch is a DERIVED index, not the source of truth. PostgreSQL holds the
 * real emails; the index is a searchable copy. That architecture has a direct,
 * practical consequence: if the index is deleted, corrupted, or built with the
 * wrong mapping, you can throw it away and rebuild it from the database. This
 * script is the proof, and it is also the fix for the one situation Elasticsearch
 * cannot handle on its own — changing an analyser, which requires deleting the
 * index because field mappings cannot be updated in place.
 *
 * Usage:
 *   npm run es:reindex          drop + recreate + index everything
 *   npm run es:reindex -- --keep   keep the index, just re-index every row
 */
import { prisma } from '../src/lib/prisma';
import {
  EMAIL_INDEX,
  closeElasticsearch,
  indexEmailsSafely,
} from '../src/services/elasticsearch.service';
import { Client } from '@elastic/elasticsearch';
import { env } from '../src/config/env';
import { createLogger } from '../src/lib/logger';

const log = createLogger('Reindex');

async function main(): Promise<void> {
  const keepExisting = process.argv.includes('--keep');

  const client = new Client({
    node: env.ELASTICSEARCH_URL,
    auth:
      env.ELASTICSEARCH_USERNAME && env.ELASTICSEARCH_PASSWORD
        ? { username: env.ELASTICSEARCH_USERNAME, password: env.ELASTICSEARCH_PASSWORD }
        : undefined,
  });

  if (!keepExisting) {
    const exists = await client.indices.exists({ index: EMAIL_INDEX });
    if (exists) {
      await client.indices.delete({ index: EMAIL_INDEX });
      console.log(`Deleted existing index "${EMAIL_INDEX}".`);
    } else {
      console.log(`No existing index "${EMAIL_INDEX}".`);
    }
  }

  const emails = await prisma.email.findMany({
    include: { sender: { select: { id: true, email: true, displayName: true } } },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${emails.length} email(s) in PostgreSQL.`);

  // Index in chunks: one giant bulk request would be rejected and a single bad
  // document would fail the batch.
  const CHUNK_SIZE = 500;
  for (let offset = 0; offset < emails.length; offset += CHUNK_SIZE) {
    const chunk = emails.slice(offset, offset + CHUNK_SIZE);
    await indexEmailsSafely(chunk);
    console.log(`Indexed ${Math.min(offset + CHUNK_SIZE, emails.length)}/${emails.length}`);
  }

  // The mapping is only created when the index is missing; a fresh index gets the
  // latest mapping from the service, which is the whole point of this script.
  const count = await client.count({ index: EMAIL_INDEX }).catch(() => ({ count: -1 }));
  console.log(`\n✅ Done. "${EMAIL_INDEX}" now holds ${count.count} document(s).`);

  await closeElasticsearch();
  await client.close();
  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  log.error('Reindex failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
