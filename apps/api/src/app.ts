import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import pino from 'pino';
import { z, ZodError } from 'zod';
import { MongoServerError } from 'mongodb';
import type { Config } from './config.js';
import type { Database } from './db.js';
import { DomainError } from './errors.js';
import { authRoutes } from './auth.js';
import { authenticate, identity, protectOrigin, requireOwner } from './security.js';
import { audit, getPortfolio, transfer } from './wallet.js';
import { tradingRoutes } from './trading/routes.js';
import { MAX_MONEY } from './money.js';

export const logger = pino({
  redact: ['password', 'passwordHash', 'cookie', 'authorization', '*.token'],
});
export const keySchema = z.string().uuid();

export function createApp(database: Database, config: Config) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.APP_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    const id = randomUUID();
    res.locals.requestId = id;
    res.setHeader('x-request-id', id);
    res.setHeader('Cache-Control', 'no-store');
    const start = performance.now();
    res.on('finish', () =>
      logger.info(
        {
          requestId: id,
          method: req.method,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - start),
        },
        'request',
      ),
    );
    next();
  });
  app.get('/health', (_req, res) => res.json({ status: 'ok', mode: 'paper' }));
  app.get('/ready', async (_req, res) => {
    try {
      await database.ready();
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });
  app.use(protectOrigin(config.APP_ORIGIN));
  app.use('/api/v1/auth', authRoutes(database, config));
  const api = express.Router();
  api.use(authenticate(database));
  api.get('/portfolio', async (req, res) => {
    const portfolio = await getPortfolio(database, identity(req)._id);
    res.json({ ...portfolio, available: portfolio.cash - portfolio.blocked, mode: 'paper' });
  });
  api.get('/ledger', async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit);
    const cursor = z.string().datetime().optional().parse(req.query.before);
    const items = await database.c.ledger
      .find({
        userId: identity(req)._id,
        ...(cursor ? { createdAt: { $lt: new Date(cursor) } } : {}),
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
    res.json({ items });
  });
  api.get('/audit', async (req, res) => {
    const items = await database.c.audit
      .find({ userId: identity(req)._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    res.json({ items });
  });
  api.post('/wallet/transfer', requireOwner, async (req, res) => {
    const input = z
      .object({ amount: z.number().int().min(-MAX_MONEY).max(MAX_MONEY) })
      .strict()
      .parse(req.body);
    res.json(
      await transfer(
        database,
        identity(req)._id,
        input.amount,
        keySchema.parse(req.get('idempotency-key')),
      ),
    );
  });
  api.put('/risk/controls', requireOwner, async (req, res) => {
    const input = z.object({ paused: z.boolean(), killed: z.boolean() }).strict().parse(req.body);
    const userId = identity(req)._id;
    await database.transaction(async (session) => {
      const portfolio = await getPortfolio(database, userId, session);
      await database.c.portfolios.updateOne(
        { userId },
        { $set: input, $inc: { version: 1 } },
        { session },
      );
      await audit(database, session, userId, 'risk.controls', portfolio._id, input);
    });
    res.json(input);
  });
  api.use(tradingRoutes(database));
  app.use('/api/v1', api);
  app.use((_req, _res, next) => next(new DomainError('NOT_FOUND', 'Route not found', 404)));
  const handler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof DomainError) {
      res
        .status(error.status)
        .json({ code: error.code, message: error.message, requestId: res.locals.requestId });
    } else if (error instanceof ZodError) {
      res.status(400).json({
        code: 'INVALID_INPUT',
        message: 'Invalid request',
        fields: error.flatten().fieldErrors,
      });
    } else if (error instanceof MongoServerError && error.code === 11000) {
      res.status(409).json({
        code: 'CONFLICT',
        message: 'Record already exists; retry the original request if applicable',
      });
    } else {
      logger.error(
        { requestId: res.locals.requestId, type: error instanceof Error ? error.name : 'unknown' },
        'request failed',
      );
      res.status(500).json({
        code: 'INTERNAL_ERROR',
        message: 'Request failed',
        requestId: res.locals.requestId,
      });
    }
  };
  app.use(handler);
  return app;
}
