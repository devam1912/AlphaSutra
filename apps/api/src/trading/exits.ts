import { randomUUID } from 'node:crypto';
import type { Database } from '../db.js';
import { invariant } from '../errors.js';
import { add, basisPoints, notional } from '../money.js';
import { audit, getPortfolio } from '../wallet.js';
import { fees, validQuote } from './risk.js';
import { marketOpen, trading } from './store.js';
import { scheduleFor } from './orders.js';

export async function closePosition(
  database: Database,
  userId: string,
  id: string,
  reason = 'MANUAL',
) {
  return database.transaction(async (session) => {
    const t = trading(database);
    const position = await t.positions.findOne({ _id: id, userId }, { session });
    if (!position) return;
    const now = new Date();
    await marketOpen(database, now, session);
    const quote = await t.quotes.findOne({ _id: position.instrumentId }, { session });
    const instrument = await t.instruments.findOne({ _id: position.instrumentId }, { session });
    invariant(quote && instrument, 'DATA_UNAVAILABLE', 'Exit quote missing');
    validQuote(quote, now);
    invariant(
      quote.asOf > position.updatedAt,
      'STALE_EXIT',
      'Exit requires a quote after the latest fill',
    );
    const originalOrder = await t.orders.findOne({ _id: position.orderId, userId }, { session });
    invariant(originalOrder, 'ORDER_MISSING', 'Position order unavailable');
    const schedule = await scheduleFor(database, originalOrder.feeVersion, session);
    const price = Math.max(
      instrument.tickSize,
      Math.floor((quote.bid - basisPoints(quote.bid, schedule.slippageBps)) / instrument.tickSize) *
        instrument.tickSize,
    );
    invariant(
      quote.availableQuantity >= position.quantity,
      'EXIT_LIQUIDITY',
      'Insufficient verified exit depth',
    );
    const gross = notional(price, position.quantity);
    const fee = fees(gross, 'SELL', schedule);
    const proceeds = add(gross, -fee);
    const pnl = add(proceeds, -position.cost, -position.entryFees);
    const p = await getPortfolio(database, userId, session);
    p.cash = add(p.cash, proceeds);
    p.realizedPnl = add(p.realizedPnl, pnl);
    if (instrument.kind === 'EQUITY') p.equity = add(p.equity, -position.cost);
    else p.derivatives = add(p.derivatives, -position.cost);
    p.blocked = add(p.blocked, -originalOrder.reserved);
    p.version++;
    await database.c.portfolios.replaceOne({ userId }, p, { session });
    await t.positions.deleteOne({ _id: id, userId }, { session });
    await t.orders.updateOne(
      { _id: position.orderId, userId },
      {
        $set: {
          reserved: 0,
          status: originalOrder.status === 'PARTIALLY_FILLED' ? 'CANCELLED' : originalOrder.status,
        },
      },
      { session },
    );
    await t.quotes.updateOne(
      { _id: quote._id, asOf: quote.asOf },
      { $inc: { availableQuantity: -position.quantity } },
      { session },
    );
    await t.trades.insertOne(
      {
        _id: randomUUID(),
        userId,
        positionId: id,
        instrumentId: position.instrumentId,
        quantity: position.quantity,
        cost: position.cost,
        proceeds,
        fees: add(fee, position.entryFees),
        pnl,
        entryAt: position.openedAt,
        exitAt: now,
        exitPrice: price,
        reason,
        analysis: {
          classification: pnl < 0 ? 'NORMAL_STATISTICAL_LOSS' : 'PROFIT',
          facts: [
            reason,
            `Net result after costs: ${pnl} paise`,
            'No causal conclusion inferred from one trade',
          ],
          trainingEligible: false,
        },
      },
      { session },
    );
    await database.c.ledger.insertOne(
      {
        _id: randomUUID(),
        userId,
        portfolioId: p._id,
        key: `exit:${id}`,
        kind: 'SELL',
        amount: proceeds,
        balance: p.cash,
        createdAt: now,
      },
      { session },
    );
    await audit(database, session, userId, 'position.closed', id, { pnl, reason, price, fee });
  });
}
