import { Worker } from 'bullmq';
import { Database } from './db.js';
import { readConfig } from './config.js';
import { logger } from './app.js';
import { DomainError } from './errors.js';
import { storeQuotes, UpstoxProvider } from './data/market.js';
import { marketOpen, trading } from './trading/store.js';
import { fillOrder } from './trading/orders.js';
import { closePosition } from './trading/exits.js';
import { redisConnection, researchQueue, closeQueue } from './research/queue.js';
import { recordUnavailable, runResearchJob } from './research/runner.js';
import type { ResearchJob } from './research/types.js';

const db = new Database(readConfig().MONGO_URL);
await db.connect();
await db.ready();
const queue = researchQueue();
const worker = new Worker('alphasutra', async (job) => runResearchJob(db, job.id!), {
  connection: redisConnection(),
  concurrency: 1,
  limiter: { max: 5, duration: 1000 },
});
worker.on('error', () => logger.error({ component: 'worker' }, 'Queue worker error'));
worker.on('failed', (job, error) => {
  if (!job) return;
  const code = error instanceof DomainError ? error.code : 'JOB_FAILED';
  logger.error({ jobId: job.id, code }, 'Research job failed');
  void (async () => {
    const terminal = job.attemptsMade >= (job.opts.attempts ?? 1);
    await db.db.collection<ResearchJob>('research_jobs').updateOne(
      { _id: job.id },
      {
        $set: {
          state: terminal ? 'FAILED' : 'QUEUED',
          active: !terminal,
          error: code,
          updatedAt: new Date(),
        },
      },
    );
    const stored = await db.db.collection<ResearchJob>('research_jobs').findOne({ _id: job.id });
    if (terminal && stored) await recordUnavailable(db, stored, code);
  })().catch(() => logger.error({ jobId: job.id }, 'Failed to persist job failure'));
});
let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    let open = false;
    try {
      await marketOpen(db, new Date());
      open = true;
    } catch {
      /* Unknown calendar means closed. */
    }
    // This timer is separate from slow research jobs so training cannot block risk exits.
    for await (const order of trading(db)
      .orders.find({ status: { $in: ['OPEN', 'PARTIALLY_FILLED'] } })
      .batchSize(100)) {
      try {
        await fillOrder(db, order.userId, order._id);
      } catch (error) {
        logger.warn(
          { orderId: order._id, code: error instanceof DomainError ? error.code : 'FILL_FAILED' },
          'Paper fill unavailable',
        );
      }
    }
    if (open)
      for await (const position of trading(db).positions.find({}).batchSize(100)) {
        const quote = await trading(db).quotes.findOne({ _id: position.instrumentId });
        if (!quote) continue;
        const reason =
          quote.bid <= position.stop ? 'STOP' : quote.bid >= position.target1 ? 'TARGET' : null;
        if (reason) {
          try {
            await closePosition(db, position.userId, position._id, reason);
          } catch (error) {
            logger.warn(
              {
                positionId: position._id,
                code: error instanceof DomainError ? error.code : 'EXIT_FAILED',
              },
              'Protective exit needs attention',
            );
          }
        }
      }
    await db.db
      .collection('heartbeats')
      .updateOne({ component: 'worker' }, { $set: { at: new Date() } }, { upsert: true });
  } catch (error) {
    logger.error(
      { code: error instanceof DomainError ? error.code : 'TICK_FAILED' },
      'Worker tick failed',
    );
  } finally {
    busy = false;
  }
}
let dispatching = false;
async function dispatch() {
  if (dispatching) return;
  dispatching = true;
  try {
    const jobs = await db.db
      .collection<ResearchJob>('research_jobs')
      .find({
        $or: [
          { state: 'QUEUED' },
          { state: 'RUNNING', updatedAt: { $lt: new Date(Date.now() - 1200000) } },
        ],
      })
      .sort({ createdAt: 1 })
      .limit(100)
      .toArray();
    for (const job of jobs) await queue.add(job.kind, {}, { jobId: job._id });
  } catch {
    logger.error({ component: 'scheduler' }, 'Research dispatch failed');
  } finally {
    dispatching = false;
  }
}
let refreshing = false;
async function refreshQuotes() {
  if (refreshing) return;
  refreshing = true;
  try {
    await marketOpen(db, new Date());
    const open = true;
    if (open && process.env.MARKET_PROVIDER === 'upstox') {
      const provider = new UpstoxProvider(process.env.UPSTOX_ACCESS_TOKEN ?? '');
      const cursor = trading(db).instruments.find({ active: true }).batchSize(100);
      let batch = [];
      for await (const instrument of cursor) {
        batch.push(instrument);
        if (batch.length === 100) {
          await storeQuotes(db, await provider.quotes(batch));
          batch = [];
        }
      }
      if (batch.length) await storeQuotes(db, await provider.quotes(batch));
    }
  } catch {
    logger.warn({ component: 'quotes' }, 'Quote refresh unavailable');
  } finally {
    refreshing = false;
  }
}
const dispatchTimer = setInterval(() => {
  void dispatch();
}, 10000);
const quoteTimer = setInterval(() => {
  void refreshQuotes();
}, 30000);
void dispatch();
void refreshQuotes();
const interval = Number(process.env.WORKER_INTERVAL_MS ?? 30000);
if (!Number.isInteger(interval) || interval < 1000)
  throw new Error('Worker interval must be >=1000ms');
const timer = setInterval(() => {
  void tick();
}, interval);
void tick();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    clearInterval(timer);
    clearInterval(dispatchTimer);
    clearInterval(quoteTimer);
    void worker
      .close()
      .then(closeQueue)
      .then(() => db.close());
    setTimeout(() => process.exit(1), 15000).unref();
  });
