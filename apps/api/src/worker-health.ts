import { Database } from './db.js';
import { readConfig } from './config.js';
import { researchQueue, closeQueue } from './research/queue.js';

const db = new Database(readConfig().MONGO_URL);
// A live process alone cannot establish that the execution loop and queue work.
const timeout = setTimeout(() => process.exit(1), 8000);
try {
  await db.connect();
  const heartbeat = await db.db.collection('heartbeats').findOne({ component: 'worker' });
  const interval = Number(process.env.WORKER_INTERVAL_MS ?? 30000);
  if (!Number.isFinite(interval) || interval < 1000) throw new Error('Invalid interval');
  if (
    !(heartbeat?.at instanceof Date) ||
    Date.now() - heartbeat.at.getTime() > interval * 2 + 15000
  ) {
    throw new Error('Worker heartbeat is stale');
  }
  await researchQueue().getJobCounts('waiting', 'active');
} catch {
  process.exitCode = 1;
} finally {
  await closeQueue();
  await db.close();
  clearTimeout(timeout);
}
