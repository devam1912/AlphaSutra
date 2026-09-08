import { z } from 'zod';
import type { Database } from '../db.js';
import { invariant } from '../errors.js';
import { money } from '../money.js';
import { indiaDay } from '../wallet.js';
import { trading } from '../trading/store.js';
import { validQuote } from '../trading/risk.js';
import type { Instrument, Quote } from '../trading/types.js';
import { requestJson } from './http.js';

const finite = z.number().finite().positive();
export const candleSchema = z
  .object({
    timestamp: z.coerce.date(),
    open: finite,
    high: finite,
    low: finite,
    close: finite,
    volume: z.number().finite().nonnegative(),
    adjusted: z.boolean(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (c.high < Math.max(c.open, c.close, c.low) || c.low > Math.min(c.open, c.close, c.high))
      ctx.addIssue({ code: 'custom', message: 'Invalid OHLC envelope' });
  });
export type Candle = z.infer<typeof candleSchema> & {
  _id: string;
  instrumentId: string;
  source: string;
  ingestedAt: Date;
};
export interface MarketDataProvider {
  history(
    instrument: Instrument,
    from: string,
    to: string,
  ): Promise<z.infer<typeof candleSchema>[]>;
  quotes(instruments: Instrument[]): Promise<Quote[]>;
}
const row = z.tuple([
  z.string(),
  finite,
  finite,
  finite,
  finite,
  z.number().nonnegative(),
  z.number().nonnegative(),
]);
const depth = z.object({
  price: z.number().nonnegative(),
  quantity: z.number().int().nonnegative(),
});
const providerQuote = z.object({
  instrument_token: z.string(),
  timestamp: z.string(),
  last_price: finite,
  depth: z.object({ buy: z.array(depth), sell: z.array(depth) }),
});

export function normalizeQuote(input: unknown, instrument: Instrument): Quote {
  const raw = providerQuote.parse(input);
  invariant(
    raw.instrument_token === instrument.providerKey,
    'INSTRUMENT_MISMATCH',
    'Provider instrument mismatch',
  );
  const bid = raw.depth.buy[0];
  const ask = raw.depth.sell[0];
  invariant(bid && ask && bid.price > 0 && ask.price > 0, 'NO_DEPTH', 'No executable market depth');
  const asOf = new Date(raw.timestamp);
  const quote: Quote = {
    _id: instrument._id,
    bid: money(Math.round(bid.price * 100)),
    ask: money(Math.round(ask.price * 100)),
    last: money(Math.round(raw.last_price * 100)),
    availableQuantity: Math.min(bid.quantity, ask.quantity),
    asOf,
    source: 'upstox',
    quality: 'verified',
  };
  validQuote(quote);
  return quote;
}
export class UpstoxProvider implements MarketDataProvider {
  constructor(private token: string) {
    invariant(token.length > 0, 'PROVIDER_DISABLED', 'Upstox token is missing');
  }
  private headers() {
    return { Authorization: `Bearer ${this.token}`, Accept: 'application/json' };
  }
  async history(instrument: Instrument, from: string, to: string) {
    z.string().date().parse(from);
    z.string().date().parse(to);
    invariant(from <= to, 'DATE_RANGE', 'Invalid history range');
    const response = z
      .object({ data: z.object({ candles: z.array(row).max(5000) }) })
      .parse(
        await requestJson(
          `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(instrument.providerKey)}/days/1/${to}/${from}`,
          { headers: this.headers() },
        ),
      );
    return response.data.candles
      .map((c) => {
        // Daily provider timestamps denote session start; research needs completed-bar semantics.
        const closeTime = new Date(`${indiaDay(new Date(c[0]))}T15:30:00+05:30`);
        return candleSchema.parse({
          timestamp: closeTime,
          open: c[1],
          high: c[2],
          low: c[3],
          close: c[4],
          volume: c[5],
          adjusted: false,
        });
      })
      .filter((c) => c.timestamp < new Date())
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
  async quotes(instruments: Instrument[]) {
    invariant(instruments.length <= 100, 'BATCH_LIMIT', 'Quote batch exceeds configured limit');
    if (!instruments.length) return [];
    const keys = instruments.map((i) => i.providerKey).join(',');
    const response = z
      .object({ data: z.record(z.unknown()) })
      .parse(
        await requestJson(
          `https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(keys)}`,
          { headers: this.headers() },
        ),
      );
    const byKey = new Map(
      Object.values(response.data).map((value) => {
        const parsed = providerQuote.parse(value);
        return [parsed.instrument_token, parsed];
      }),
    );
    return instruments.map((i) => normalizeQuote(byKey.get(i.providerKey), i));
  }
}
export async function ingestCandles(
  database: Database,
  instrumentId: string,
  values: z.infer<typeof candleSchema>[],
  source: string,
) {
  invariant(
    values.length > 0 && values.length <= 5000,
    'BATCH_LIMIT',
    'Expected 1 to 5000 candles',
  );
  const parsed = values.map((c) => candleSchema.parse(c));
  invariant(
    new Set(parsed.map((c) => c.timestamp.getTime())).size === parsed.length,
    'DUPLICATE_CANDLES',
    'Duplicate candle timestamps',
  );
  invariant(
    parsed.every(
      (c, i) => c.timestamp <= new Date() && (i === 0 || c.timestamp > parsed[i - 1]!.timestamp),
    ),
    'CANDLE_ORDER',
    'Candles must be completed and chronological',
  );
  await database.db.collection<Candle>('candles').bulkWrite(
    parsed.map((c) => ({
      updateOne: {
        filter: { _id: `${instrumentId}:${c.timestamp.toISOString()}` },
        update: { $setOnInsert: { ...c, instrumentId, source, ingestedAt: new Date() } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return parsed.length;
}
export async function storeQuotes(database: Database, quotes: Quote[]) {
  for (const quote of quotes) {
    validQuote(quote);
    await database.transaction(async (session) => {
      const current = await trading(database).quotes.findOne({ _id: quote._id }, { session });
      // Repeated snapshots must not replenish already consumed simulated depth.
      if (current && current.asOf >= quote.asOf) return;
      await trading(database).quotes.replaceOne({ _id: quote._id }, quote, {
        upsert: true,
        session,
      });
    });
  }
}
export async function completedHistory(database: Database, instrumentId: string) {
  const rows = await database.db
    .collection<Candle>('candles')
    .find({ instrumentId, timestamp: { $lt: new Date() } })
    .sort({ timestamp: -1 })
    .limit(5000)
    .toArray();
  return rows.reverse();
}

export async function validateHistorySessions(database: Database, rows: Candle[]) {
  invariant(rows.length >= 60, 'HISTORY_SHORT', 'At least 60 completed candles are required');
  invariant(
    rows.every((row) => row.adjusted),
    'UNADJUSTED_DATA',
    'Use a verified adjusted dataset',
  );
  const first = rows[0]!;
  const last = rows.at(-1)!;
  const sessions = await trading(database)
    .sessions.find({
      _id: { $gte: indiaDay(first.timestamp), $lte: indiaDay(last.timestamp) },
    })
    .sort({ _id: 1 })
    .limit(5001)
    .toArray();
  invariant(
    sessions.length === rows.length,
    'CALENDAR_GAPS',
    'History must match the verified exchange calendar',
  );
  const byDay = new Map(rows.map((row) => [indiaDay(row.timestamp), row]));
  invariant(
    sessions.every((session) => {
      const candle = byDay.get(session._id);
      return candle && candle.timestamp.getTime() === session.close.getTime();
    }),
    'SESSION_MISMATCH',
    'Candle availability must equal the verified session close',
  );
}
