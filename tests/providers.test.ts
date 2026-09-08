import { describe, expect, it, vi, afterEach } from 'vitest';
import { candleSchema, normalizeQuote } from '../apps/api/src/data/market.js';
import { interpretWithFallback, signalSchema } from '../apps/api/src/data/news.js';
import { requestText } from '../apps/api/src/data/http.js';

afterEach(() => vi.unstubAllGlobals());
describe('provider boundaries', () => {
  it('rejects corrupt candles and unknown adjustment status', () => {
    expect(() =>
      candleSchema.parse({
        timestamp: new Date(),
        open: 100,
        high: 99,
        low: 90,
        close: 100,
        volume: 1,
        adjusted: true,
      }),
    ).toThrow();
    expect(() =>
      candleSchema.parse({
        timestamp: new Date(),
        open: 100,
        high: 101,
        low: 90,
        close: 100,
        volume: 1,
      }),
    ).toThrow();
  });
  it('never turns AI failure into fabricated sentiment', async () => {
    const fail = {
      name: 'failed',
      interpret: async () => {
        throw new Error('offline');
      },
    };
    expect(await interpretWithFallback('earnings headline', [fail])).toEqual({
      signal: null,
      usage: null,
      provider: null,
    });
    expect(() => signalSchema.parse({ sentiment: 200 })).toThrow();
  });
  it('rejects wrong instruments and missing market depth', () => {
    const instrument = {
      _id: 'A',
      symbol: 'A',
      providerKey: 'key',
      kind: 'EQUITY' as const,
      exchange: 'NSE' as const,
      sector: 'IT',
      correlationGroup: 'TECH',
      tickSize: 5,
      lotSize: 1,
      active: true,
    };
    const raw = {
      instrument_token: 'wrong',
      timestamp: new Date().toISOString(),
      last_price: 10,
      depth: { buy: [{ price: 10, quantity: 5 }], sell: [{ price: 11, quantity: 3 }] },
    };
    expect(() => normalizeQuote(raw, instrument)).toThrow('mismatch');
    const normalized = normalizeQuote({ ...raw, instrument_token: 'key' }, instrument);
    expect(normalized.availableQuantity).toBe(3);
    expect(normalized.bid).toBe(1000);
  });
  it('limits provider response size and does not leak error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('private provider secret', { status: 401 })),
    );
    await expect(requestText('https://provider.example')).rejects.toThrow('Provider rejected');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('too much data')));
    await expect(requestText('https://provider.example', {}, 2)).rejects.toThrow('too large');
  });
});
