import { randomUUID } from 'node:crypto';
import type { ClientSession } from 'mongodb';
import type { Database } from './db.js';
import { digest } from './security.js';
import { DomainError, invariant } from './errors.js';
import { add, INITIAL_CASH, money } from './money.js';
import type { Portfolio } from './models.js';

export function initialPortfolio(userId: string, now = new Date()): Portfolio {
  return {
    _id: randomUUID(),
    userId,
    cash: INITIAL_CASH,
    blocked: 0,
    equity: 0,
    derivatives: 0,
    realizedPnl: 0,
    netDeposits: INITIAL_CASH,
    peakValue: INITIAL_CASH,
    dailyStartValue: INITIAL_CASH,
    day: indiaDay(now),
    paused: false,
    killed: false,
    version: 0,
    createdAt: now,
  };
}

export function indiaDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

export async function audit(
  database: Database,
  session: ClientSession,
  userId: string,
  action: string,
  entityId: string,
  detail: Record<string, unknown> = {},
) {
  await database.c.audit.insertOne(
    { _id: randomUUID(), userId, action, entityId, detail, createdAt: new Date() },
    { session },
  );
}

export async function getPortfolio(database: Database, userId: string, session?: ClientSession) {
  const portfolio = await database.c.portfolios.findOne({ userId }, { session });
  if (!portfolio) throw new DomainError('NOT_FOUND', 'Portfolio not found', 404);
  return portfolio;
}

export async function idempotent(
  database: Database,
  userId: string,
  key: string,
  operation: string,
  input: unknown,
  fn: (session: ClientSession) => Promise<Record<string, unknown>>,
) {
  const fingerprint = digest(JSON.stringify(input));
  return database.transaction(async (session) => {
    const previous = await database.c.idempotency.findOne({ userId, key, operation }, { session });
    if (previous) {
      invariant(
        previous.fingerprint === fingerprint,
        'IDEMPOTENCY_CONFLICT',
        'Key used with another request',
      );
      return previous.result;
    }
    const result = await fn(session);
    await database.c.idempotency.insertOne(
      { _id: randomUUID(), userId, key, operation, fingerprint, result, createdAt: new Date() },
      { session },
    );
    return result;
  });
}

export function moveCash(portfolio: Portfolio, amount: number): Portfolio {
  money(amount);
  invariant(amount !== 0, 'INVALID_AMOUNT', 'Amount cannot be zero');
  const cash = add(portfolio.cash, amount);
  invariant(cash >= portfolio.blocked, 'INSUFFICIENT_FUNDS', 'Withdrawal exceeds available cash');
  return {
    ...portfolio,
    cash,
    netDeposits: add(portfolio.netDeposits, amount),
    peakValue: add(portfolio.peakValue, amount),
    dailyStartValue: add(portfolio.dailyStartValue, amount),
    version: portfolio.version + 1,
  };
}

export async function transfer(database: Database, userId: string, amount: number, key: string) {
  return idempotent(database, userId, key, 'wallet', { amount }, async (session) => {
    const previous = await getPortfolio(database, userId, session);
    const next = moveCash(previous, amount);
    await database.c.portfolios.replaceOne({ _id: previous._id, userId }, next, { session });
    await database.c.ledger.insertOne(
      {
        _id: randomUUID(),
        userId,
        portfolioId: next._id,
        key,
        kind: amount > 0 ? 'DEPOSIT' : 'WITHDRAWAL',
        amount,
        balance: next.cash,
        createdAt: new Date(),
      },
      { session },
    );
    await audit(database, session, userId, 'wallet.transfer', next._id, { amount });
    return { cash: next.cash, available: next.cash - next.blocked };
  });
}
