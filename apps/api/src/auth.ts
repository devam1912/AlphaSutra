import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Database } from './db.js';
import type { Config } from './config.js';
import { DomainError } from './errors.js';
import {
  authenticate,
  digest,
  hashPassword,
  identity,
  newToken,
  verifyPassword,
} from './security.js';
import { audit, initialPortfolio } from './wallet.js';

const credentials = z
  .object({
    email: z
      .string()
      .email()
      .max(254)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(12).max(128),
  })
  .strict();

export function authRoutes(database: Database, config: Config) {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  router.use(limiter);
  router.post('/register', async (req, res) => {
    if (!config.REGISTRATION_ENABLED)
      throw new DomainError('REGISTRATION_CLOSED', 'Registration is disabled', 403);
    const input = credentials.parse(req.body);
    const userId = randomUUID();
    const passwordHash = await hashPassword(input.password);
    await database.transaction(async (session) => {
      await database.c.users.insertOne(
        { _id: userId, email: input.email, passwordHash, role: 'owner', createdAt: new Date() },
        { session },
      );
      const portfolio = initialPortfolio(userId);
      await database.c.portfolios.insertOne(portfolio, { session });
      await database.c.ledger.insertOne(
        {
          _id: randomUUID(),
          userId,
          portfolioId: portfolio._id,
          key: 'initial',
          kind: 'INITIAL',
          amount: portfolio.cash,
          balance: portfolio.cash,
          createdAt: new Date(),
        },
        { session },
      );
      await audit(database, session, userId, 'account.created', userId);
    });
    res.status(201).json({ message: 'Account created. Sign in to start paper trading.' });
  });
  router.post('/login', async (req, res) => {
    const input = credentials.parse(req.body);
    const user = await database.c.users.findOne({ email: input.email });
    // Always run the expensive hash, including for an unknown email.
    const dummy = '00000000000000000000000000000000:' + '00'.repeat(64);
    const valid = await verifyPassword(input.password, user?.passwordHash ?? dummy);
    if (!user || !valid)
      throw new DomainError('INVALID_LOGIN', 'Email or password is incorrect', 401);
    const token = newToken();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60_000);
    await database.c.sessions.insertOne({ _id: digest(token), userId: user._id, expiresAt });
    res.cookie('session', token, {
      httpOnly: true,
      secure: config.NODE_ENV === 'production',
      sameSite: 'strict',
      expires: expiresAt,
      path: '/',
    });
    res.json({ email: user.email, role: user.role });
  });
  router.get('/me', authenticate(database), (req, res) => {
    const user = identity(req);
    res.json({ email: user.email, role: user.role });
  });
  router.post('/logout', authenticate(database), async (req, res) => {
    await database.c.sessions.deleteOne({ _id: digest(req.cookies.session as string) });
    res.clearCookie('session', { path: '/' });
    res.status(204).end();
  });
  return router;
}
