import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import { identity, requireOwner } from '../security.js';
import { invariant } from '../errors.js';
import { audit } from '../wallet.js';
import { trading } from '../trading/store.js';
import type { Candle } from './market.js';
import type { Article } from './news.js';
import { pageFilter, pageToken } from './pagination.js';

interface Watchlist {
  _id: string;
  instrumentIds: string[];
  updatedAt: Date;
}
export async function dataIndexes(database: Database) {
  await database.db.collection('candles').createIndex({ instrumentId: 1, timestamp: -1 });
  await database.db.collection('news').createIndex({ publishedAt: -1, _id: -1 });
  await database.db.collection('news').createIndex({ symbols: 1, publishedAt: -1 });
  await database.db.collection('snapshots').createIndex({ userId: 1, createdAt: -1 });
}
export function dataRoutes(database: Database) {
  const router = Router();
  router.get('/providers', (_req, res) =>
    res.json({
      market: {
        name: process.env.MARKET_PROVIDER ?? 'disabled',
        configured: Boolean(process.env.UPSTOX_ACCESS_TOKEN),
      },
      groq: { configured: Boolean(process.env.GROQ_API_KEY) },
      gemini: { configured: Boolean(process.env.GEMINI_API_KEY) },
      training: { configured: (process.env.ML_SERVICE_TOKEN?.length ?? 0) >= 32 },
      autoPaper: process.env.AUTO_PAPER_ENABLED === 'true',
      liveTrading: false,
    }),
  );
  router.get('/candles/:instrumentId', async (req, res) => {
    const instrumentId = z.string().max(100).parse(req.params.instrumentId);
    const before = z.string().datetime().optional().parse(req.query.before);
    const limit = z.coerce.number().int().min(1).max(250).default(100).parse(req.query.limit);
    const items = await database.db
      .collection<Candle>('candles')
      .find({ instrumentId, timestamp: { $lt: before ? new Date(before) : new Date() } })
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
    res.json({ items: items.reverse() });
  });
  router.get('/news', async (req, res) => {
    const asOf = z.string().datetime().optional().parse(req.query.asOf);
    const cutoff = asOf ? new Date(asOf) : new Date();
    const limit = z.coerce.number().int().min(1).max(100).default(30).parse(req.query.limit);
    const page = pageFilter(req.query.cursor, 'publishedAt');
    const items = await database.db
      .collection<Article>('news')
      .find({ $and: [page, { publishedAt: { $lte: cutoff }, ingestedAt: { $lte: cutoff } }] })
      .sort({ publishedAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
    const last = items.at(-1);
    res.json({
      items,
      cursor: items.length === limit && last ? pageToken(last.publishedAt, last._id) : null,
    });
  });
  router.get('/watchlist', async (req, res) => {
    const watchlist = await database.db
      .collection<Watchlist>('watchlists')
      .findOne({ _id: identity(req)._id });
    res.json({ instrumentIds: watchlist?.instrumentIds ?? [] });
  });
  router.put('/watchlist', requireOwner, async (req, res) => {
    const input = z
      .object({ instrumentIds: z.array(z.string().max(100)).max(100) })
      .strict()
      .parse(req.body);
    const ids = [...new Set(input.instrumentIds)];
    const count = await trading(database).instruments.countDocuments({
      _id: { $in: ids },
      active: true,
    });
    invariant(
      count === ids.length,
      'UNKNOWN_INSTRUMENT',
      'Watchlist contains inactive or unknown instruments',
    );
    const userId = identity(req)._id;
    await database.transaction(async (session) => {
      await database.db
        .collection<Watchlist>('watchlists')
        .replaceOne(
          { _id: userId },
          { instrumentIds: ids, updatedAt: new Date() },
          { upsert: true, session },
        );
      await audit(database, session, userId, 'watchlist.changed', userId, { instrumentIds: ids });
    });
    res.json({ instrumentIds: ids });
  });
  return router;
}
