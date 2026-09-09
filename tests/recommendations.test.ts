import { describe, expect, it } from 'vitest';
import { buildRecommendation } from '../apps/api/src/research/recommendations.js';
import type { ModelRecord } from '../apps/api/src/research/types.js';
const model: ModelRecord = {
  _id: '00000000-0000-4000-8000-000000000001',
  userId: 'u',
  instrumentId: 'A',
  jobId: 'job',
  status: 'CHALLENGER',
  report: {},
  createdAt: new Date(),
};
const instrument = {
  _id: 'A',
  symbol: 'A',
  exchange: 'NSE' as const,
  kind: 'EQUITY' as const,
  sector: 'IT',
  correlationGroup: 'TECH',
  lotSize: 1,
  tickSize: 5,
  active: true,
  providerKey: 'key',
};
const score = {
  probability: 0.92,
  features: { atr_fraction: 0.01 },
  as_of: new Date().toISOString(),
  model_id: model._id,
  horizon: 5,
  label: 'forward_return',
  regime: { regime: 'BULL' },
  validation: {},
};
describe('recommendation policy', () => {
  it('keeps challengers out of automatic execution even with high probability', () => {
    const result = buildRecommendation(
      model,
      instrument,
      score,
      100000000,
      100000000,
      10000,
      new Date(),
    );
    expect(result.status).toBe('RESEARCH_ONLY');
    expect(result.probability).toBe(0.92);
    expect(result.stop).toBeLessThan(result.entry!);
    expect(result.target1).toBeGreaterThan(result.entry!);
    expect(result.label).toBe('forward_return');
  });
  it('abstains on weak probability, hostile regimes and insufficient funds', () => {
    for (const patch of [{ probability: 0.6 }, { regime: { regime: 'BEAR' } }]) {
      expect(
        buildRecommendation(
          { ...model, status: 'CHAMPION' },
          instrument,
          { ...score, ...patch },
          100000000,
          100000000,
          10000,
          new Date(),
        ).status,
      ).toBe('NO_TRADE');
    }
    expect(buildRecommendation(model, instrument, score, 0, 0, 10000, new Date()).quantity).toBe(0);
  });
  it('rejects a model identity mismatch', () => {
    expect(() =>
      buildRecommendation(
        model,
        instrument,
        { ...score, model_id: 'wrong' },
        100000000,
        100000000,
        10000,
        new Date(),
      ),
    ).toThrow('does not match');
  });
  it('keeps unsupported derivatives in research mode', () => {
    const result = buildRecommendation(
      { ...model, status: 'CHAMPION' },
      { ...instrument, kind: 'CALL' },
      score,
      100000000,
      100000000,
      10000,
      new Date(),
    );
    expect(result.status).toBe('RESEARCH_ONLY');
    expect(result.highConviction).toBe(false);
  });
});
