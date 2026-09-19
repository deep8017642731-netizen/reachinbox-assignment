/**
 * Removes BullMQ jobs whose email row no longer exists in PostgreSQL.
 *
 *   npm run queue:prune
 *
 * WHY THIS IS NEEDED
 * A job and its email row live in two different systems, so they can diverge.
 * Deleting a sender cascades to its emails (see schema.prisma onDelete: Cascade),
 * but nothing removes the Redis jobs that referenced them. Those jobs would wake
 * at their scheduled time and find no row.
 *
 * The worker already handles that case safely — it logs "email no longer exists"
 * and completes the job rather than failing — so this script is not a correctness
 * fix, it is housekeeping: an orphaned job keeps showing up in Bull Board's
 * "Delayed" count, which makes the queue look like it has work when it does not.
 *
 * This is the operational cost of keeping timing state in Redis and business state
 * in PostgreSQL, and it is worth stating plainly rather than hiding: two stores
 * need a reconciliation step somewhere. Here it is one small, idempotent script.
 */
import { prisma } from '../src/lib/prisma';
import { emailQueue } from '../src/queues/email.queue';
import type { EmailJobData } from '../src/types';
import { createLogger } from '../src/lib/logger';

const log = createLogger('Prune');

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  // Only unfinished jobs can become orphans; completed/failed jobs are history.
  const states = ['delayed', 'waiting', 'waiting-children', 'prioritized', 'active'] as const;

  let scanned = 0;
  const orphans: Array<{ jobId: string; emailId: string }> = [];

  for (const state of states) {
    // Paged rather than one big fetch: a queue with 100k waiting jobs would
    // otherwise load every payload into memory at once.
    let start = 0;
    const pageSize = 500;

    for (;;) {
      const jobs = await emailQueue.getJobs([state], start, start + pageSize - 1, false);
      if (jobs.length === 0) break;

      for (const job of jobs) {
        scanned += 1;
        const data = job.data as Partial<EmailJobData> | undefined;
        if (!data?.emailId) continue;

        const exists = await prisma.email.count({ where: { id: data.emailId } });
        if (exists === 0) {
          orphans.push({ jobId: String(job.id), emailId: data.emailId });
        }
      }

      start += jobs.length;
      if (jobs.length < pageSize) break;
    }
  }

  console.log(`Scanned ${scanned} unfinished job(s); found ${orphans.length} orphan(s).`);

  if (orphans.length === 0) {
    console.log('Nothing to prune.');
  } else if (!apply) {
    console.log('\nDry run — nothing was removed. Re-run with --apply to delete these jobs:');
    for (const orphan of orphans.slice(0, 20)) {
      console.log(`  job ${orphan.jobId}  →  missing email ${orphan.emailId}`);
    }
    if (orphans.length > 20) console.log(`  …and ${orphans.length - 20} more`);
  } else {
    let removed = 0;
    for (const orphan of orphans) {
      const job = await emailQueue.getJob(orphan.jobId);
      if (!job) continue;
      // A job that is currently active belongs to a worker; removing it would
      // interrupt an in-flight send, so leave those alone.
      const jobState = await job.getState();
      if (jobState === 'active') continue;
      await job.remove();
      removed += 1;
    }
    log.info('Orphaned jobs removed', { removed, skipped: orphans.length - removed });
    console.log(`Removed ${removed} orphaned job(s).`);
  }

  await emailQueue.close();
  await prisma.$disconnect();
}

main().catch(async (error: unknown) => {
  log.error('Prune failed', { error: error instanceof Error ? error.message : String(error) });
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
