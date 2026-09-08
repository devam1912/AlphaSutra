import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import { DomainError } from './errors.js';
import type { Database } from './db.js';
import type { User } from './models.js';

const scrypt = promisify(scryptCallback);
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const result = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${result.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

export interface AuthRequest extends Request {
  user?: User;
}

export function authenticate(database: Database) {
  return async (req: AuthRequest, _res: Response, next: NextFunction) => {
    const token: unknown = req.cookies?.session;
    if (typeof token !== 'string' || token.length > 128) {
      throw new DomainError('UNAUTHENTICATED', 'Sign in to continue', 401);
    }
    const session = await database.c.sessions.findOne({
      _id: digest(token),
      expiresAt: { $gt: new Date() },
    });
    const user = session && (await database.c.users.findOne({ _id: session.userId }));
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Session expired', 401);
    req.user = user;
    next();
  };
}

export function identity(req: AuthRequest): User {
  if (!req.user) throw new DomainError('UNAUTHENTICATED', 'Sign in to continue', 401);
  return req.user;
}

export function requireOwner(req: AuthRequest, _res: Response, next: NextFunction) {
  if (identity(req).role !== 'owner') throw new DomainError('FORBIDDEN', 'Read-only account', 403);
  next();
}

export function protectOrigin(origin: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin') !== origin) {
      throw new DomainError('INVALID_ORIGIN', 'Request origin is not allowed', 403);
    }
    next();
  };
}
