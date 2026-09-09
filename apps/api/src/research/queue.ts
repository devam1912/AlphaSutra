import { Queue } from 'bullmq';
import { logger } from '../app.js';
export function redisConnection() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
  if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('Invalid Redis protocol');
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number(url.pathname.slice(1) || 0),
    maxRetriesPerRequest: null,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
let queue: Queue | undefined;
export function researchQueue() {
  if (!queue) {
    queue = new Queue('alphasutra', {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });
    queue.on('error', () => logger.error({ component: 'queue' }, 'Redis unavailable'));
  }
  return queue;
}
export async function closeQueue() {
  await queue?.close();
}
