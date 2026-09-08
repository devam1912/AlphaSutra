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
});
