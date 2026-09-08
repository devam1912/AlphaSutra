import { describe, expect, it } from 'vitest';
import { pageFilter, pageToken } from '../apps/api/src/data/pagination.js';

describe('stable cursor pagination', () => {
  it('uses ID as a tiebreaker for equal timestamps', () => {
    const date = new Date('2026-09-08T04:00:00Z');
    const filter = pageFilter(pageToken(date, 'last-id'), 'createdAt');
    expect(filter).toEqual({
      $or: [{ createdAt: { $lt: date } }, { createdAt: date, _id: { $lt: 'last-id' } }],
    });
  });
  it('rejects malformed and oversized cursors', () => {
    for (const value of ['invalid', '$where', 'a'.repeat(501), { $gt: '' }]) {
      expect(() => pageFilter(value, 'createdAt')).toThrow('Invalid pagination');
    }
    expect(pageFilter(undefined, 'createdAt')).toEqual({});
  });
});
