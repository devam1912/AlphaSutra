import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { Database } from '../db.js';
import { readConfig } from '../config.js';
import { candleSchema, ingestCandles } from './market.js';
import { trading } from '../trading/store.js';

const instrument = z
  .object({
    _id: z.string().min(1).max(100),
    symbol: z.string().regex(/^[A-Z0-9&.-]{1,30}$/),
    exchange: z.enum(['NSE', 'BSE']),
    kind: z.enum(['EQUITY', 'CALL', 'PUT', 'FUTURE']),
    sector: z.string().min(1),
    correlationGroup: z.string().min(1),
    lotSize: z.number().int().positive(),
    tickSize: z.number().int().positive(),
    active: z.boolean(),
    providerKey: z.string().min(1),
    expiry: z.string().date().optional(),
    strike: z.number().int().positive().optional(),
    underlying: z.string().optional(),
  })
  .strict();
const marketSession = z
  .object({
    _id: z.string().date(),
    open: z.coerce.date(),
    close: z.coerce.date(),
    source: z.string().min(1),
  })
  .strict()
  .refine((s) => s.close > s.open, 'Session close must follow open');
const [kind, path, instrumentId] = process.argv.slice(2);
if (!path || !['instruments', 'sessions', 'candles'].includes(kind ?? ''))
  throw new Error('Usage: import.ts instruments|sessions|candles file.json [instrumentId]');
const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
const db = new Database(readConfig().MONGO_URL);
try {
  await db.connect();
  await db.ready();
  if (kind === 'instruments') {
    const values = z.array(instrument).max(10000).parse(raw);
    for (const value of values)
      await trading(db).instruments.replaceOne({ _id: value._id }, value, { upsert: true });
  } else if (kind === 'sessions') {
    const values = z.array(marketSession).max(500).parse(raw);
    for (const value of values)
      await trading(db).sessions.replaceOne({ _id: value._id }, value, { upsert: true });
  } else {
    if (!instrumentId || !(await trading(db).instruments.findOne({ _id: instrumentId })))
      throw new Error('Known instrumentId required');
    await ingestCandles(db, instrumentId, z.array(candleSchema).parse(raw), 'operator-import');
  }
} finally {
  await db.close();
}
