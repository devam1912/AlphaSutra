import type { ClientSession } from 'mongodb';
import type { Database } from '../db.js';
import { invariant } from '../errors.js';
import { indiaDay } from '../wallet.js';
import type { Portfolio } from '../models.js';
import type { Exposure } from './risk.js';
import { validQuote } from './risk.js';
import type {
  FeeSchedule,
  Instrument,
  MarketSession,
  Order,
  Position,
  Quote,
  Trade,
} from './types.js';

export const trading = (database: Database) => ({
  instruments: database.db.collection<Instrument>('instruments'),
  quotes: database.db.collection<Quote>('quotes'),
  sessions: database.db.collection<MarketSession>('market_sessions'),
  orders: database.db.collection<Order>('orders'),
  positions: database.db.collection<Position>('positions'),
  trades: database.db.collection<Trade>('trades'),
  fees: database.db.collection<FeeSchedule & { _id: string }>('fee_schedules'),
});
export async function tradingIndexes(database: Database) {
  const t = trading(database);
  await t.orders.createIndex({ userId: 1, createdAt: -1 });
  await t.orders.createIndex({ status: 1, expiresAt: 1 });
  await t.positions.createIndex({ userId: 1, instrumentId: 1 });
  await t.positions.createIndex({ orderId: 1 }, { unique: true });
  await t.trades.createIndex({ userId: 1, exitAt: -1 });
  await t.instruments.createIndex({ symbol: 1, exchange: 1 });
}
export async function marketOpen(database: Database, now: Date, session?: ClientSession) {
  const day = await trading(database).sessions.findOne({ _id: indiaDay(now) }, { session });
  invariant(
    day && day.open <= now && now < day.close,
    'MARKET_CLOSED',
    'Market closed or verified exchange calendar unavailable',
  );
  return day;
}
export async function exposureFor(
  database: Database,
  portfolio: Portfolio,
  instrument: Instrument,
  session: ClientSession,
  excludeOrder?: string,
): Promise<Exposure> {
  const t = trading(database);
  const positions = await t.positions
    .find({ userId: portfolio.userId }, { session })
    .limit(100)
    .toArray();
  const pending = await t.orders
    .find(
      {
        userId: portfolio.userId,
        status: { $in: ['OPEN', 'PARTIALLY_FILLED'] },
        ...(excludeOrder ? { _id: { $ne: excludeOrder } } : {}),
      },
      { session },
    )
    .limit(100)
    .toArray();
  const result: Exposure = {
    value: portfolio.cash,
    equityPending: 0,
    derivativesPending: 0,
    instrument: 0,
    sector: 0,
    group: 0,
    positions: positions.length + pending.length,
    totalPlannedRisk: 0,
  };
  const ids = [
    ...new Set([...positions.map((p) => p.instrumentId), ...pending.map((p) => p.instrumentId)]),
  ];
  const instruments = new Map(
    (await t.instruments.find({ _id: { $in: ids } }, { session }).toArray()).map((i) => [i._id, i]),
  );
  const quotes = new Map(
    (await t.quotes.find({ _id: { $in: ids } }, { session }).toArray()).map((q) => [q._id, q]),
  );
  for (const position of positions) {
    const quote = quotes.get(position.instrumentId);
    invariant(quote, 'DATA_UNAVAILABLE', 'Position quote unavailable for portfolio risk');
    validQuote(quote);
    result.value += quote.bid * position.quantity;
  }
  const rows = [
    ...positions.map((p) => ({
      id: p.instrumentId,
      value: p.cost,
      pending: false,
      risk: Math.max(0, p.cost - p.stop * p.quantity) + p.entryFees,
    })),
    ...pending.map((o) => ({
      id: o.instrumentId,
      value: o.reserved,
      pending: true,
      risk: (o.maxPrice - o.stop) * (o.quantity - o.filled),
    })),
  ];
  for (const row of rows) {
    const metadata = instruments.get(row.id);
    invariant(metadata, 'DATA_UNAVAILABLE', 'Position metadata unavailable');
    if (row.id === instrument._id) result.instrument += row.value;
    if (metadata.sector === instrument.sector) result.sector += row.value;
    if (metadata.correlationGroup === instrument.correlationGroup) result.group += row.value;
    result.totalPlannedRisk += metadata.kind === 'EQUITY' ? row.risk : row.value;
    if (row.pending) {
      if (metadata.kind === 'EQUITY') result.equityPending += row.value;
      else result.derivativesPending += row.value;
    }
  }
  return result;
}
