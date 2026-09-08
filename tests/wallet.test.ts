import { describe, expect, it } from 'vitest';
import { add, basisPoints, money, notional } from '../apps/api/src/money.js';
import { initialPortfolio, moveCash } from '../apps/api/src/wallet.js';
import { hashPassword, verifyPassword } from '../apps/api/src/security.js';
import { readConfig } from '../apps/api/src/config.js';

describe('exact accounting', () => {
  it('starts with ten lakh and conserves funds through deposits and withdrawals', () => {
    const p = initialPortfolio('alice');
    expect(p.cash).toBe(100_000_000);
    const deposited = moveCash(p, 123_45);
    expect(moveCash(deposited, -123_45).cash).toBe(p.cash);
    expect(deposited.netDeposits).toBe(p.netDeposits + 123_45);
  });
  it('does not withdraw reserved money', () => {
    const p = { ...initialPortfolio('alice'), blocked: 20_000_000 };
    expect(() => moveCash(p, -80_000_001)).toThrow('available cash');
    expect(moveCash(p, -80_000_000).cash).toBe(p.blocked);
  });
  it('rejects fractional, unsafe and nonfinite values', () => {
    for (const value of [NaN, Infinity, 0.1, Number.MAX_SAFE_INTEGER]) {
      expect(() => money(value)).toThrow();
    }
    expect(() => add(1_000_000_000_000, 1)).toThrow();
    expect(() => notional(100, -1)).toThrow();
  });
  it('rounds fee fractions upward without floating money drift', () => {
    expect(basisPoints(101, 1)).toBe(1);
    expect(basisPoints(10000, 10)).toBe(10);
  });
});

describe('security configuration', () => {
  it('uses salted password hashes', async () => {
    const a = await hashPassword('a long testing password');
    const b = await hashPassword('a long testing password');
    expect(a).not.toBe(b);
    expect(await verifyPassword('a long testing password', a)).toBe(true);
    expect(await verifyPassword('incorrect password', a)).toBe(false);
  });
  it('refuses live execution and insecure production origins', () => {
    expect(() => readConfig({ LIVE_TRADING_ENABLED: 'true' })).toThrow('Live trading');
    expect(() => readConfig({ NODE_ENV: 'production' })).toThrow('HTTPS');
    expect(readConfig({ LIVE_TRADING_ENABLED: 'false' }).LIVE_TRADING_ENABLED).toBe(false);
  });
});
