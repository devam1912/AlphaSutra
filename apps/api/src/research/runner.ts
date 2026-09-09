import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Database } from '../db.js';
import {
  completedHistory,
  ingestCandles,
  UpstoxProvider,
  validateHistorySessions,
} from '../data/market.js';
import { ingestFeed } from '../data/news.js';
import { requestJson } from '../data/http.js';
import { invariant } from '../errors.js';
import { audit, getPortfolio, indiaDay } from '../wallet.js';
import { trading, marketOpen, exposureFor } from '../trading/store.js';
import { assess, validQuote } from '../trading/risk.js';
import { submitOrder } from '../trading/orders.js';
import { buildRecommendation, scoreSchema } from './recommendations.js';
import type { ModelRecord, Recommendation, ResearchJob } from './types.js';

export async function quantRequest(path: '/score' | '/train', body: unknown) {
  const token = process.env.ML_SERVICE_TOKEN ?? '';
  invariant(token.length >= 32, 'ML_DISABLED', 'Configure a private quant service token');
  const base = new URL(process.env.ML_URL ?? 'http://127.0.0.1:8000');
  return requestJson(
    new URL(path, base).toString(),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-service-token': token },
      body: JSON.stringify(body),
    },
    5_000_000,
    path === '/train' ? 600_000 : 30_000,
  );
}
export async function runResearchJob(db: Database, id: string) {
  const jobs = db.db.collection<ResearchJob>('research_jobs');
  const job = await jobs.findOne({ _id: id });
  if (!job || job.state === 'COMPLETED') return;
  await jobs.updateOne({ _id: id }, { $set: { state: 'RUNNING', updatedAt: new Date() } });
  let resultId: string | undefined;
  if (job.kind === 'news') {
    const urls = (process.env.NEWS_FEEDS ?? '').split(',').filter(Boolean);
    invariant(urls.length > 0, 'NEWS_DISABLED', 'No permitted news feeds configured');
    for (const url of urls.slice(0, 10)) await ingestFeed(db, url);
  } else {
    const instrument = await trading(db).instruments.findOne({ _id: job.instrumentId });
    invariant(instrument, 'UNKNOWN_INSTRUMENT', 'Unknown instrument');
    if (job.kind === 'history') {
      invariant(
        process.env.MARKET_PROVIDER === 'upstox',
        'PROVIDER_DISABLED',
        'Select the Upstox provider',
      );
      const provider = new UpstoxProvider(process.env.UPSTOX_ACCESS_TOKEN ?? '');
      const now = new Date();
      const from = new Date(now);
      from.setUTCFullYear(now.getUTCFullYear() - 5);
      const rows = await provider.history(instrument, indiaDay(from), indiaDay(now));
      await ingestCandles(db, instrument._id, rows, 'upstox');
    } else {
      const history = await completedHistory(db, instrument._id);
      await validateHistorySessions(db, history);
      const candles = history.map(({ timestamp, open, high, low, close, volume }) => ({
        timestamp: timestamp.toISOString(),
        open,
        high,
        low,
        close,
        volume,
      }));
      if (job.kind === 'train') {
        const existing = await db.db.collection<ModelRecord>('models').findOne({ jobId: id });
        if (existing) resultId = existing._id;
        else {
          const result = z
            .object({ model_id: z.string().uuid(), report: z.record(z.unknown()) })
            .parse(await quantRequest('/train', { candles, kind: job.baseline }));
          await db.db
            .collection<ModelRecord>('models')
            .insertOne({
              _id: result.model_id,
              userId: job.userId,
              instrumentId: instrument._id,
              jobId: id,
              status: 'CHALLENGER',
              report: result.report,
              createdAt: new Date(),
            });
          resultId = result.model_id;
        }
      } else {
        const model = await db.db
          .collection<ModelRecord>('models')
          .findOne({ _id: job.modelId, userId: job.userId, instrumentId: instrument._id });
        invariant(model, 'UNKNOWN_MODEL', 'Model not owned by account or instrument');
        const latestSession = await trading(db).sessions.findOne(
          { close: { $lte: new Date() } },
          { sort: { close: -1 } },
        );
        invariant(
          latestSession && history.at(-1)!.timestamp.getTime() === latestSession.close.getTime(),
          'STALE_HISTORY',
          'Scoring requires the latest completed session',
        );
        const score = scoreSchema.parse(
          await quantRequest('/score', { candles, model_id: model._id }),
        );
        const quote = await trading(db).quotes.findOne({ _id: instrument._id });
        invariant(quote, 'DATA_UNAVAILABLE', 'Quote unavailable');
        validQuote(quote);
        const day = await marketOpen(db, new Date());
        const result = await db.transaction(async (session) => {
          const portfolio = await getPortfolio(db, job.userId, session);
          const exposure = await exposureFor(db, portfolio, instrument, session);
          const candidate = buildRecommendation(
            model,
            instrument,
            score,
            exposure.value,
            portfolio.cash - portfolio.blocked,
            quote.ask,
            new Date(Math.min(day.close.getTime(), Date.now() + 900000)),
          );
          if (candidate.status === 'CANDIDATE') {
            try {
              assess(
                portfolio,
                {
                  instrumentId: instrument._id,
                  type: 'LIMIT',
                  quantity: candidate.quantity,
                  maxPrice: candidate.entry!,
                  stop: candidate.stop!,
                  target1: candidate.target1!,
                  target2: candidate.target2!,
                },
                instrument,
                quote,
                exposure,
              );
              const existing = await db.db
                .collection<Recommendation>('recommendations')
                .findOne(
                  { userId: job.userId, day: candidate.day, highConviction: true },
                  { session },
                );
              candidate.highConviction = !existing;
            } catch {
              candidate.status = 'NO_TRADE';
              candidate.reasons.push('Portfolio risk engine vetoed the candidate');
            }
          }
          const old = await db.db
            .collection<Recommendation>('recommendations')
            .findOne({ _id: candidate._id }, { session });
          if (old) return old;
          await db.c.portfolios.updateOne(
            { userId: job.userId },
            { $inc: { version: 1 } },
            { session },
          );
          await db.db
            .collection<Recommendation>('recommendations')
            .insertOne(candidate, { session });
          await audit(db, session, job.userId, 'recommendation.created', candidate._id, {
            status: candidate.status,
            modelId: model._id,
          });
          return candidate;
        });
        resultId = result._id;
        if (
          result.highConviction &&
          result.status === 'CANDIDATE' &&
          process.env.AUTO_PAPER_ENABLED === 'true'
        ) {
          await submitOrder(
            db,
            job.userId,
            {
              instrumentId: instrument._id,
              type: 'LIMIT',
              quantity: result.quantity,
              maxPrice: result.entry!,
              stop: result.stop!,
              target1: result.target1!,
              target2: result.target2!,
            },
            `auto:${result._id}`,
          );
        }
      }
    }
  }
  await db.transaction(async (session) => {
    await jobs.updateOne(
      { _id: id },
      { $set: { state: 'COMPLETED', active: false, updatedAt: new Date(), resultId } },
      { session },
    );
    await audit(db, session, job.userId, 'research.completed', id, { resultId: resultId ?? null });
  });
}
export async function recordUnavailable(db: Database, job: ResearchJob, code: string) {
  if (job.kind !== 'score') return;
  await db.db.collection<Recommendation>('recommendations').updateOne(
    { _id: `failed:${job._id}` },
    {
      $setOnInsert: {
        userId: job.userId,
        instrumentId: job.instrumentId ?? '',
        symbol: job.instrumentId ?? '',
        modelId: job.modelId ?? '',
        status: 'DATA_UNAVAILABLE',
        probability: null,
        label: '',
        reasons: [code],
        entry: null,
        stop: null,
        target1: null,
        target2: null,
        quantity: 0,
        regime: 'DATA_UNAVAILABLE',
        features: {},
        createdAt: new Date(),
        validUntil: new Date(),
        dataAsOf: new Date(0),
        day: indiaDay(new Date()),
        highConviction: false,
      },
    },
    { upsert: true },
  );
}
export function newScheduledJob(userId: string, model: ModelRecord): ResearchJob {
  return {
    _id: randomUUID(),
    userId,
    kind: 'score',
    instrumentId: model.instrumentId,
    modelId: model._id,
    baseline: 'logistic',
    state: 'QUEUED',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
