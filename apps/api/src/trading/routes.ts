import { Router } from 'express';
import { z } from 'zod';
import type { Database } from '../db.js';
import { identity, requireOwner } from '../security.js';
import { cancelOrder, submitOrder } from './orders.js';
import { closePosition } from './exits.js';
import { trading } from './store.js';
import { limits } from './risk.js';
const price = z.number().int().positive().max(100_000_000);
export const orderSchema = z
  .object({
    instrumentId: z.string().min(1).max(100),
    quantity: z.number().int().positive().max(1_000_000),
    type: z.enum(['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT']),
    maxPrice: price,
    triggerPrice: price.optional(),
    stop: price,
    target1: price,
    target2: price,
  })
  .strict();
export function tradingRoutes(database: Database) {
  const router = Router();
  router.get('/risk/policy', (_req, res) => res.json({ limits, liveEnabled: false }));
  router.get('/instruments', async (req, res) => {
    const search = z.string().max(30).optional().parse(req.query.search);
    const filter = search
      ? {
          symbol: { $gte: search.toUpperCase(), $lt: search.toUpperCase() + '\uffff' },
          active: true,
        }
      : { active: true };
    res.json({
      items: await trading(database)
        .instruments.find(filter)
        .sort({ symbol: 1 })
        .limit(100)
        .toArray(),
    });
  });
  for (const name of ['orders', 'positions', 'trades'] as const) {
    router.get(`/${name}`, async (req, res) => {
      const collection = trading(database)[name];
      const items = await collection
        .find({ userId: identity(req)._id })
        .sort({ _id: -1 })
        .limit(100)
        .toArray();
      res.json({ items });
    });
  }
  router.post('/orders', requireOwner, async (req, res) => {
    res
      .status(201)
      .json(
        await submitOrder(
          database,
          identity(req)._id,
          orderSchema.parse(req.body),
          z.string().uuid().parse(req.get('idempotency-key')),
        ),
      );
  });
  router.post('/orders/:id/cancel', requireOwner, async (req, res) => {
    await cancelOrder(database, identity(req)._id, z.string().uuid().parse(req.params.id));
    res.status(204).end();
  });
  router.post('/positions/:id/close', requireOwner, async (req, res) => {
    await closePosition(database, identity(req)._id, z.string().uuid().parse(req.params.id));
    res.status(204).end();
  });
  return router;
}
