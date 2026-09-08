import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import type { Database } from '../db.js';
import { DomainError, invariant } from '../errors.js';
import { add, basisPoints, notional } from '../money.js';
import { audit, getPortfolio, idempotent, indiaDay } from '../wallet.js';
import { assess, defaultFees, fees, validQuote } from './risk.js';
import { exposureFor, marketOpen, trading } from './store.js';
import type { FeeSchedule, Order, OrderInput, Position } from './types.js';

export async function scheduleFor(
  database: Database,
  version: string,
  session?: ClientSession,
): Promise<FeeSchedule> {
  if (version === defaultFees.version) return defaultFees;
  const schedule = await trading(database).fees.findOne({ _id: version }, { session });
  invariant(schedule, 'FEE_UNAVAILABLE', 'Order fee schedule unavailable');
  return schedule;
}
export async function submitOrder(
  database: Database,
  userId: string,
  input: OrderInput,
  key: string,
) {
  return idempotent(database, userId, key, 'order.submit', input, async (session) => {
    const now = new Date();
    const day = await marketOpen(database, now, session);
    const t = trading(database);
    const portfolio = await getPortfolio(database, userId, session);
    const instrument = await t.instruments.findOne({ _id: input.instrumentId }, { session });
    const quote = await t.quotes.findOne({ _id: input.instrumentId }, { session });
    invariant(instrument && quote, 'DATA_UNAVAILABLE', 'Instrument or quote is unavailable');
    invariant(
      !instrument.expiry || instrument.expiry > indiaDay(now),
      'EXPIRY',
      'Expired or expiring contract',
    );
    const exposure = await exposureFor(database, portfolio, instrument, session);
    if (portfolio.day !== indiaDay(now)) {
      portfolio.day = indiaDay(now);
      portfolio.dailyStartValue = exposure.value;
    }
    portfolio.peakValue = Math.max(portfolio.peakValue, exposure.value);
    const schedule = await scheduleFor(
      database,
      process.env.FEE_VERSION ?? defaultFees.version,
      session,
    );
    let reserved = 0;
    let rejection: string | undefined;
    try {
      reserved = assess(portfolio, input, instrument, quote, exposure, schedule).reserve;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      rejection = error.code;
    }
    const order: Order = {
      ...input,
      _id: randomUUID(),
      userId,
      filled: 0,
      reserved,
      status: rejection ? 'REJECTED' : 'OPEN',
      rejection,
      triggered: false,
      createdAt: now,
      expiresAt: day.close,
      feeVersion: schedule.version,
    };
    portfolio.blocked = add(portfolio.blocked, reserved);
    portfolio.version++;
    await database.c.portfolios.replaceOne({ userId }, portfolio, { session });
    await t.orders.insertOne(order, { session });
    await audit(database, session, userId, 'order.submitted', order._id, {
      status: order.status,
      rejection,
    });
    return { orderId: order._id, status: order.status, rejection: rejection ?? null };
  });
}
export async function cancelOrder(database: Database, userId: string, id: string) {
  return database.transaction(async (session) => {
    const t = trading(database);
    const order = await t.orders.findOne({ _id: id, userId }, { session });
    invariant(order, 'NOT_FOUND', 'Order not found');
    if (!['OPEN', 'PARTIALLY_FILLED'].includes(order.status)) return;
    await database.c.portfolios.updateOne(
      { userId },
      { $inc: { blocked: -order.reserved, version: 1 } },
      { session },
    );
    await t.orders.updateOne(
      { _id: id, userId },
      { $set: { status: 'CANCELLED', reserved: 0 } },
      { session },
    );
    await audit(database, session, userId, 'order.cancelled', id);
  });
}
export async function fillOrder(database: Database, userId: string, id: string) {
  return database.transaction(async (session) => {
    const t = trading(database);
    const order = await t.orders.findOne({ _id: id, userId }, { session });
    if (!order || !['OPEN', 'PARTIALLY_FILLED'].includes(order.status)) return;
    const now = new Date();
    const p = await getPortfolio(database, userId, session);
    if (p.paused || p.killed || order.expiresAt <= now) {
      await database.c.portfolios.updateOne(
        { userId },
        { $inc: { blocked: -order.reserved, version: 1 } },
        { session },
      );
      await t.orders.updateOne(
        { _id: id, userId },
        { $set: { status: 'CANCELLED', reserved: 0 } },
        { session },
      );
      await audit(database, session, userId, 'order.cancelled', id, {
        reason: 'controls_or_expiry',
      });
      return;
    }
    await marketOpen(database, now, session);
    const instrument = await t.instruments.findOne({ _id: order.instrumentId }, { session });
    const quote = await t.quotes.findOne({ _id: order.instrumentId }, { session });
    invariant(instrument && quote, 'DATA_UNAVAILABLE', 'Execution inputs missing');
    invariant(
      !instrument.expiry || instrument.expiry > indiaDay(now),
      'EXPIRY',
      'Expired contract',
    );
    validQuote(quote, now);
    // Consume each quote at most once and never execute before order creation.
    if (quote.asOf <= (order.lastQuoteAt ?? order.createdAt)) return;
    if (order.triggerPrice && !order.triggered) {
      if (quote.ask < order.triggerPrice) return;
      await t.orders.updateOne({ _id: id, userId }, { $set: { triggered: true } }, { session });
    }
    const schedule = await scheduleFor(database, order.feeVersion, session);
    const price =
      Math.ceil((quote.ask + basisPoints(quote.ask, schedule.slippageBps)) / instrument.tickSize) *
      instrument.tickSize;
    if (price > order.maxPrice || price <= order.stop) return;
    const remaining = order.quantity - order.filled;
    const quantity =
      Math.floor(Math.min(remaining, quote.availableQuantity) / instrument.lotSize) *
      instrument.lotSize;
    if (!quantity) return;
    const exposure = await exposureFor(database, p, instrument, session, order._id);
    assess(
      { ...p, blocked: p.blocked - order.reserved },
      { ...order, quantity: remaining },
      instrument,
      quote,
      exposure,
      schedule,
    );
    const value = notional(price, quantity);
    const fee = fees(value, 'BUY', schedule);
    const spend = add(value, fee);
    const remainingQuantity = remaining - quantity;
    const remainingValue = remainingQuantity ? notional(order.maxPrice, remainingQuantity) : 0;
    const newReserve = remainingValue
      ? add(remainingValue, fees(remainingValue, 'BUY', schedule))
      : 0;
    invariant(
      spend + newReserve <= order.reserved,
      'RESERVATION',
      'Fill costs exceed reserved funds',
    );
    p.cash = add(p.cash, -spend);
    p.blocked = add(p.blocked, -order.reserved, newReserve);
    if (instrument.kind === 'EQUITY') p.equity = add(p.equity, value);
    else p.derivatives = add(p.derivatives, value);
    p.version++;
    await database.c.portfolios.replaceOne({ userId }, p, { session });
    const existing = await t.positions.findOne({ orderId: id, userId }, { session });
    const position: Position = existing
      ? {
          ...existing,
          quantity: existing.quantity + quantity,
          cost: add(existing.cost, value),
          entryFees: add(existing.entryFees, fee),
          updatedAt: now,
          maxPrice: Math.max(existing.maxPrice, price),
          minPrice: Math.min(existing.minPrice, price),
        }
      : {
          _id: randomUUID(),
          userId,
          instrumentId: instrument._id,
          orderId: id,
          quantity,
          cost: value,
          entryFees: fee,
          stop: order.stop,
          target1: order.target1,
          target2: order.target2,
          openedAt: now,
          updatedAt: now,
          maxPrice: price,
          minPrice: price,
        };
    await t.positions.replaceOne({ _id: position._id, userId }, position, {
      upsert: true,
      session,
    });
    await t.orders.updateOne(
      { _id: id, userId },
      {
        $set: {
          filled: order.filled + quantity,
          reserved: newReserve,
          lastQuoteAt: quote.asOf,
          status: remainingQuantity ? 'PARTIALLY_FILLED' : 'FILLED',
        },
      },
      { session },
    );
    await t.quotes.updateOne(
      { _id: quote._id, asOf: quote.asOf },
      { $inc: { availableQuantity: -quantity } },
      { session },
    );
    await database.c.ledger.insertOne(
      {
        _id: randomUUID(),
        userId,
        portfolioId: p._id,
        key: `fill:${id}:${order.filled}`,
        kind: 'BUY',
        amount: -spend,
        balance: p.cash,
        createdAt: now,
      },
      { session },
    );
    await audit(database, session, userId, 'order.filled', id, {
      quantity,
      price,
      fee,
      quoteAt: quote.asOf,
      feeVersion: schedule.version,
    });
  });
}
