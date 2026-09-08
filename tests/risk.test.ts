import { describe, expect, it } from 'vitest';
import { assess, fees, validQuote, type Exposure } from '../apps/api/src/trading/risk.js';
import { initialPortfolio } from '../apps/api/src/wallet.js';
import type { Instrument, OrderInput, Quote } from '../apps/api/src/trading/types.js';
const instrument: Instrument = {
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
};
const input: OrderInput = {
  instrumentId: 'TEST',
  quantity: 10,
  type: 'MARKET',
  maxPrice: 10000,
  stop: 9500,
  target1: 11000,
  target2: 11500,
};
const quote = (): Quote => ({
  _id: 'TEST',
  bid: 9950,
  ask: 9960,
  last: 9955,
  asOf: new Date(),
  availableQuantity: 100,
  quality: 'verified',
  source: 'test-fixture',
});
const exposure: Exposure = {
  value: 100_000_000,
  equityPending: 0,
  derivativesPending: 0,
  instrument: 0,
  sector: 0,
  group: 0,
  positions: 0,
  totalPlannedRisk: 0,
};
describe('deterministic risk veto', () => {
  it('accepts a bracketed small trade and reserves costs', () => {
    const result = assess(initialPortfolio('u'), input, instrument, quote(), exposure);
    expect(result.reserve).toBeGreaterThan(100000);
    expect(fees(100000, 'BUY')).toBeGreaterThan(0);
  });
  it.each([
    [{ killed: true }, {}, 'disabled'],
    [{ paused: true }, {}, 'disabled'],
    [{ cash: 1 }, {}, 'unreserved'],
    [{ equity: 70_000_000 }, {}, 'allocation'],
    [{}, { positions: 10 }, 'positions'],
    [{}, { instrument: 15_000_000 }, 'instrument'],
    [{}, { sector: 30_000_000 }, 'Sector'],
    [{}, { group: 40_000_000 }, 'Correlated'],
    [{}, { value: 95_000_000 }, 'Daily loss'],
  ])('vetoes violated portfolio limits', (p, e, message) => {
    expect(() =>
      assess({ ...initialPortfolio('u'), ...p }, input, instrument, quote(), { ...exposure, ...e }),
    ).toThrow(message);
  });
  it('counts pending exposure against the equity ceiling', () => {
    expect(() =>
      assess(initialPortfolio('u'), input, instrument, quote(), {
        ...exposure,
        equityPending: 70_000_000,
      }),
    ).toThrow('allocation');
  });
  it('sizes options against full premium and rejects unsupported futures', () => {
    expect(() =>
      assess(
        initialPortfolio('u'),
        { ...input, quantity: 100 },
        { ...instrument, kind: 'CALL', lotSize: 50 },
        quote(),
        exposure,
      ),
    ).toThrow('loss budget');
    expect(() =>
      assess(initialPortfolio('u'), input, { ...instrument, kind: 'FUTURE' }, quote(), exposure),
    ).toThrow('margin adapter');
  });
  it('rejects missing stops, invalid ticks and stale or future quotes', () => {
    expect(() =>
      assess(initialPortfolio('u'), { ...input, stop: 10000 }, instrument, quote(), exposure),
    ).toThrow('stop');
    expect(() =>
      assess(initialPortfolio('u'), { ...input, maxPrice: 10001 }, instrument, quote(), exposure),
    ).toThrow('tick');
    for (const offset of [-61000, 60000]) {
      expect(() => validQuote({ ...quote(), asOf: new Date(Date.now() + offset) })).toThrow(
        'stale',
      );
    }
    expect(() => validQuote({ ...quote(), quality: 'development' })).toThrow('Development');
  });
});
