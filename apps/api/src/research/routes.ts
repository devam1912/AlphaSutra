import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import { identity, requireOwner } from '../security.js';
import { invariant } from '../errors.js';
import { audit, getPortfolio, idempotent, indiaDay } from '../wallet.js';
import { trading } from '../trading/store.js';
import { validQuote } from '../trading/risk.js';
import type { ModelRecord, Recommendation, ResearchJob } from './types.js';

export async function researchIndexes(db: Database) {
  await db.db.collection('research_jobs').createIndex({ userId: 1, createdAt: -1 });
  await db.db
    .collection('research_jobs')
    .createIndex(
      { userId: 1, kind: 1 },
      { unique: true, partialFilterExpression: { active: true } },
    );
  await db.db.collection('research_jobs').createIndex({ state: 1, updatedAt: 1 });
  await db.db.collection('models').createIndex({ userId: 1, createdAt: -1 });
  await db.db.collection('models').createIndex({ jobId: 1 }, { unique: true });
  await db.db.collection('recommendations').createIndex({ userId: 1, createdAt: -1 });
  await db.db
    .collection('recommendations')
    .createIndex(
      { userId: 1, day: 1 },
      { unique: true, partialFilterExpression: { highConviction: true } },
    );
  await trading(db).sessions.createIndex({ close: -1 });
}
export function researchRoutes(db: Database) {
  const router = Router();
  router.get('/jobs', async (req, res) =>
    res.json({
      items: await db.db
        .collection<ResearchJob>('research_jobs')
        .find({ userId: identity(req)._id })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray(),
    }),
  );
  router.post(
    '/jobs',
    requireOwner,
    rateLimit({
      windowMs: 60000,
      limit: 5,
      keyGenerator: (req) => identity(req)._id,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    async (req, res) => {
      const input = z
        .object({
          kind: z.enum(['history', 'train', 'score', 'news']),
          instrumentId: z.string().max(100).optional(),
          modelId: z.string().uuid().optional(),
          baseline: z.enum(['logistic', 'boosting']).default('logistic'),
        })
        .strict()
        .parse(req.body);
      const userId = identity(req)._id;
      const result = await idempotent(
        db,
        userId,
        z.string().uuid().parse(req.get('idempotency-key')),
        'research.job',
        input,
        async (session) => {
          if (input.kind !== 'news')
            invariant(
              input.instrumentId &&
                (await trading(db).instruments.findOne({ _id: input.instrumentId }, { session })),
              'UNKNOWN_INSTRUMENT',
              'Known instrument required',
            );
          if (input.kind === 'score')
            invariant(
              await db.db
                .collection<ModelRecord>('models')
                .findOne(
                  { _id: input.modelId, userId, instrumentId: input.instrumentId },
                  { session },
                ),
              'UNKNOWN_MODEL',
              'Model does not belong to this account and instrument',
            );
          const id = randomUUID();
          await db.db.collection<ResearchJob>('research_jobs').insertOne(
            {
              ...input,
              _id: id,
              userId,
              state: 'QUEUED',
              active: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            { session },
          );
          await audit(db, session, userId, 'research.queued', id, { kind: input.kind });
          // The scheduler dispatches this durable outbox. Redis failure cannot lose the job.
          return { jobId: id, state: 'QUEUED' };
        },
      );
      res.status(202).json(result);
    },
  );
  router.get('/models', async (req, res) =>
    res.json({
      items: await db.db
        .collection<ModelRecord>('models')
        .find({ userId: identity(req)._id })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray(),
    }),
  );
  router.get('/recommendations', async (req, res) =>
    res.json({
      items: await db.db
        .collection<Recommendation>('recommendations')
        .find({ userId: identity(req)._id })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray(),
    }),
  );
  router.get('/high-conviction', async (req, res) => {
    const item = await db.db.collection<Recommendation>('recommendations').findOne({
      userId: identity(req)._id,
      day: indiaDay(new Date()),
      highConviction: true,
      validUntil: { $gt: new Date() },
    });
    res.json(
      item ?? {
        status: 'NO_TRADE',
        reasons: ['No approved opportunity satisfies the current risk policy'],
      },
    );
  });
  router.get('/summary', async (req, res) => {
    const userId = identity(req)._id;
    const portfolio = await getPortfolio(db, userId);
    const positions = await trading(db).positions.find({ userId }).limit(100).toArray();
    const quotes = new Map(
      (
        await trading(db)
          .quotes.find({ _id: { $in: positions.map((p) => p.instrumentId) } })
          .toArray()
      ).map((q) => [q._id, q]),
    );
    let value: number | null = portfolio.cash;
    let unrealized: number | null = 0;
    for (const position of positions) {
      const quote = quotes.get(position.instrumentId);
      try {
        invariant(quote, 'STALE_DATA', 'Missing quote');
        validQuote(quote);
        value += quote.bid * position.quantity;
        unrealized += quote.bid * position.quantity - position.cost - position.entryFees;
      } catch {
        value = null;
        unrealized = null;
        break;
      }
    }
    res.json({
      ...portfolio,
      value,
      unrealizedPnl: unrealized,
      available: portfolio.cash - portfolio.blocked,
      drawdown:
        value !== null && portfolio.peakValue > 0
          ? Math.max(0, 1 - value / portfolio.peakValue)
          : null,
      dataStatus: value === null ? 'DATA_UNAVAILABLE' : 'CURRENT',
      mode: 'paper',
    });
  });
  return router;
}
