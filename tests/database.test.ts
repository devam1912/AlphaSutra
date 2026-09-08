import { storeQuotes, ingestCandles } from '../apps/api/src/data/market.js';
import { trading } from '../apps/api/src/trading/store.js';
import { submitOrder, fillOrder } from '../apps/api/src/trading/orders.js';
import { closePosition } from '../apps/api/src/trading/exits.js';
import { initialPortfolio, indiaDay } from '../apps/api/src/wallet.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { createApp } from '../apps/api/src/app.js';
import { readConfig } from '../apps/api/src/config.js';
import { Database, migrate } from '../apps/api/src/db.js';
import { getPortfolio, transfer } from '../apps/api/src/wallet.js';

let replica: MongoMemoryReplSet;
let db: Database;
const origin = 'http://localhost:5173';
const suite = process.env.RUN_DB_TESTS === 'true' ? describe : describe.skip;
suite('real MongoDB replica-set accounting', () => {
  beforeAll(async () => {
    replica = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
      instanceOpts: [{ ip: '127.0.0.1' }],
    });
    db = new Database(replica.getUri('alphasutra_test'));
    await db.connect();
    await migrate(db);
    await db.ready();
  }, 120000);
  afterAll(async () => {
    await db?.close();
    await replica?.stop();
  });
  it('isolates accounts and serializes conflicting withdrawals', async () => {
    const app = createApp(db, readConfig({ NODE_ENV: 'test' }));
    const alice = request.agent(app);
    const bob = request.agent(app);
    for (const [agent, email] of [
      [alice, 'alice@example.test'],
      [bob, 'bob@example.test'],
    ] as const) {
      const input = { email, password: 'test-only-long-password' };
      expect(
        (await agent.post('/api/v1/auth/register').set('Origin', origin).send(input)).status,
      ).toBe(201);
      expect(
        (await agent.post('/api/v1/auth/login').set('Origin', origin).send(input)).status,
      ).toBe(200);
    }
    const alicePortfolio = (await alice.get('/api/v1/portfolio')).body;
    const bobPortfolio = (await bob.get('/api/v1/portfolio')).body;
    expect(alicePortfolio.userId).not.toBe(bobPortfolio.userId);
    const outcomes = await Promise.allSettled([
      transfer(db, alicePortfolio.userId, -60_000_000, 'withdraw-one'),
      transfer(db, alicePortfolio.userId, -60_000_000, 'withdraw-two'),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect((await getPortfolio(db, alicePortfolio.userId)).cash).toBe(40_000_000);
    expect((await getPortfolio(db, bobPortfolio.userId)).cash).toBe(100_000_000);
    const first = await transfer(db, bobPortfolio.userId, 12345, 'same-logical-deposit');
    expect(await transfer(db, bobPortfolio.userId, 12345, 'same-logical-deposit')).toEqual(first);
    expect((await getPortfolio(db, bobPortfolio.userId)).cash).toBe(100_012_345);
    await expect(transfer(db, bobPortfolio.userId, 12346, 'same-logical-deposit')).rejects.toThrow(
      'another request',
    );
    const health = await request(app).get('/ready');
    expect(health.status).toBe(200);
    const ledger = (await alice.get('/api/v1/ledger')).body.items;
    expect(ledger.every((row: { userId: string }) => row.userId === alicePortfolio.userId)).toBe(
      true,
    );
  });
  it('fills once, accounts for costs, and closes without leaking reservations', async () => {
    const t = trading(db);
    const owner = 'execution-test';
    await db.c.portfolios.insertOne(initialPortfolio(owner));
    await t.sessions.insertOne({
      _id: indiaDay(new Date()),
      open: new Date(Date.now() - 60000),
      close: new Date(Date.now() + 3600000),
      source: 'test-fixture',
    });
    await t.instruments.insertOne({
      _id: 'TEST',
      symbol: 'TEST',
      exchange: 'NSE',
      kind: 'EQUITY',
      sector: 'IT',
      correlationGroup: 'TECH',
      lotSize: 1,
      tickSize: 5,
      active: true,
      providerKey: 'test',
    });
    const quote = {
      _id: 'TEST',
      bid: 9950,
      ask: 9960,
      last: 9955,
      asOf: new Date(),
      availableQuantity: 100,
      quality: 'verified' as const,
      source: 'test-fixture',
    };
    await t.quotes.insertOne(quote);
    const input = {
      instrumentId: 'TEST',
      quantity: 10,
      type: 'MARKET' as const,
      maxPrice: 10000,
      stop: 9500,
      target1: 11000,
      target2: 11500,
    };
    const order = await submitOrder(db, owner, input, 'unique-order');
    expect(order.status).toBe('OPEN');
    expect(await submitOrder(db, owner, input, 'unique-order')).toEqual(order);
    await t.quotes.updateOne({ _id: 'TEST' }, { $set: { asOf: new Date() } });
    await Promise.all([
      fillOrder(db, owner, String(order.orderId)),
      fillOrder(db, owner, String(order.orderId)),
    ]);
    const position = await t.positions.findOne({ userId: owner });
    expect(position?.quantity).toBe(10);
    expect((await getPortfolio(db, owner)).blocked).toBe(0);
    expect(await t.positions.countDocuments({ userId: 'different-owner' })).toBe(0);
    await t.quotes.updateOne(
      { _id: 'TEST' },
      { $set: { asOf: new Date(), bid: 11000, ask: 11005, availableQuantity: 100 } },
    );
    await closePosition(db, owner, position!._id);
    await closePosition(db, owner, position!._id);
    const trade = await t.trades.findOne({ userId: owner });
    const portfolio = await getPortfolio(db, owner);
    expect(portfolio.cash).toBe(100_000_000 + trade!.pnl);
    expect(portfolio.realizedPnl).toBe(trade!.pnl);
    expect(portfolio.equity).toBe(0);
    expect(await t.trades.countDocuments({ userId: owner })).toBe(1);
  });
  it('does not replenish quote depth or rewrite historical candles on retries', async () => {
    const t = trading(db);
    const q = {
      _id: 'DEPTH',
      bid: 10000,
      ask: 10005,
      last: 10000,
      availableQuantity: 100,
      asOf: new Date(),
      source: 'test',
      quality: 'verified' as const,
    };
    await storeQuotes(db, [q]);
    await t.quotes.updateOne({ _id: 'DEPTH' }, { $set: { availableQuantity: 1 } });
    await storeQuotes(db, [q]);
    expect((await t.quotes.findOne({ _id: 'DEPTH' }))?.availableQuantity).toBe(1);
    const candle = {
      timestamp: new Date('2025-01-01T10:00:00Z'),
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 100,
      adjusted: true,
    };
    await ingestCandles(db, 'DEPTH', [candle], 'test');
    await ingestCandles(db, 'DEPTH', [{ ...candle, close: 104 }], 'test');
    const stored = await db.db.collection('candles').findOne({ instrumentId: 'DEPTH' });
    expect(stored?.close).toBe(105);
    await expect(ingestCandles(db, 'DEPTH', [candle, candle], 'test')).rejects.toThrow('Duplicate');
  });
});
