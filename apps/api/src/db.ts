import { MongoClient, type ClientSession, type Db } from 'mongodb';
import type { Audit, Idempotency, LedgerEntry, Portfolio, Session, User } from './models.js';

export function collections(db: Db) {
  return {
    users: db.collection<User>('users'),
    sessions: db.collection<Session>('sessions'),
    portfolios: db.collection<Portfolio>('portfolios'),
    ledger: db.collection<LedgerEntry>('ledger'),
    audit: db.collection<Audit>('audit'),
    idempotency: db.collection<Idempotency>('idempotency'),
  };
}

export class Database {
  readonly client: MongoClient;
  constructor(url: string) {
    this.client = new MongoClient(url, {
      maxPoolSize: 30,
      minPoolSize: 1,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      retryWrites: true,
    });
  }
  get db() {
    return this.client.db();
  }
  get c() {
    return collections(this.db);
  }
  async connect() {
    await this.client.connect();
  }
  async close() {
    await this.client.close();
  }
  async ready() {
    const hello = await this.db.admin().command({ hello: 1 });
    if (!hello.setName) throw new Error('MongoDB replica set is required for transactions');
    if (!(await this.db.collection('migrations').findOne({ version: 1 }))) {
      throw new Error('Database migrations have not been applied');
    }
  }
  async transaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = this.client.startSession();
    try {
      return await session.withTransaction(() => fn(session), {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
        maxCommitTimeMS: 10_000,
      });
    } finally {
      await session.endSession();
    }
  }
}

export async function migrate(database: Database) {
  const c = database.c;
  await c.users.createIndex({ email: 1 }, { unique: true });
  await c.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await c.sessions.createIndex({ userId: 1 });
  await c.portfolios.createIndex({ userId: 1 }, { unique: true });
  await c.ledger.createIndex({ userId: 1, key: 1 }, { unique: true });
  await c.ledger.createIndex({ userId: 1, createdAt: -1, _id: -1 });
  await c.audit.createIndex({ userId: 1, createdAt: -1, _id: -1 });
  await c.idempotency.createIndex({ userId: 1, key: 1, operation: 1 }, { unique: true });
  // Idempotency records deliberately have no TTL: an old retry must not move cash twice.
  await database.db
    .collection('migrations')
    .updateOne({ version: 1 }, { $setOnInsert: { appliedAt: new Date() } }, { upsert: true });
}
