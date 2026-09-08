import { z } from 'zod';
import { DomainError } from '../errors.js';
const cursor = z.object({ at: z.string().datetime(), id: z.string().min(1).max(150) }).strict();
export function pageToken(at: Date, id: string) {
  return Buffer.from(JSON.stringify({ at: at.toISOString(), id })).toString('base64url');
}
export function pageFilter(value: unknown, field: 'createdAt' | 'publishedAt') {
  if (value === undefined) return {};
  try {
    const encoded = z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(500)
      .parse(value);
    const parsed = cursor.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')));
    const at = new Date(parsed.at);
    return { $or: [{ [field]: { $lt: at } }, { [field]: at, _id: { $lt: parsed.id } }] };
  } catch {
    throw new DomainError('INVALID_CURSOR', 'Invalid pagination cursor');
  }
}
