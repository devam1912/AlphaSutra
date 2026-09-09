import { z } from 'zod';
import { digest } from '../security.js';
import { invariant } from '../errors.js';
import { indiaDay } from '../wallet.js';
import { suggestedQuantity } from '../trading/risk.js';
import type { Instrument } from '../trading/types.js';
import type { ModelRecord, Recommendation } from './types.js';

export const scoreSchema = z.object({
  probability: z.number().finite().min(0).max(1),
  features: z.record(z.number().finite()),
  as_of: z.string().datetime({ offset: true }),
  model_id: z.string().uuid(),
  horizon: z.number().int().positive(),
  label: z.string(),
  regime: z.object({ regime: z.string() }),
  validation: z.record(z.unknown()),
});
export function buildRecommendation(
  model: ModelRecord,
  instrument: Instrument,
  score: z.infer<typeof scoreSchema>,
  capital: number,
  cash: number,
  price: number,
  validUntil: Date,
  now = new Date(),
): Recommendation {
  invariant(score.model_id === model._id, 'MODEL_MISMATCH', 'Scoring model does not match request');
  const atr = score.features.atr_fraction;
  const reasons: string[] = [];
  let status: Recommendation['status'] = 'CANDIDATE';
  if (model.status !== 'CHAMPION') {
    status = 'RESEARCH_ONLY';
    reasons.push('Challenger model: not approved for automatic paper execution');
  }
  if (score.probability < 0.8) {
    status = 'NO_TRADE';
    reasons.push('Probability below the predeclared selection threshold');
  }
  if (!atr || atr <= 0 || !price || price <= 0) {
    status = 'DATA_UNAVAILABLE';
    reasons.push('Valid volatility and price are required');
  }
  if (
    ['BEAR', 'STRONG_BEAR', 'HIGH_VOLATILITY', 'DATA_UNAVAILABLE'].includes(score.regime.regime)
  ) {
    status = 'NO_TRADE';
    reasons.push('Market regime is outside the long strategy policy');
  }
  if (instrument.kind !== 'EQUITY') {
    status = 'RESEARCH_ONLY';
    reasons.push('Derivative setup needs independent contract and margin validation');
  }
  if (!reasons.length)
    reasons.push(
      'Probability and volatility setup qualify; execution still requires the risk engine',
    );
  const tick = instrument.tickSize;
  const entry = Math.ceil(price / tick) * tick;
  const distance = Math.ceil((2 * (atr ?? 0) * entry) / tick) * tick;
  const stop = entry - distance;
  const valid = distance > 0 && stop > 0;
  const quantity = valid ? suggestedQuantity(capital, cash, entry, stop, instrument.lotSize) : 0;
  if (!quantity) {
    status = 'NO_TRADE';
    reasons.push('Insufficient risk budget for one tradeable lot');
  }
  return {
    _id: digest(`${model.userId}:${model._id}:${score.as_of}`),
    userId: model.userId,
    instrumentId: instrument._id,
    symbol: instrument.symbol,
    modelId: model._id,
    status,
    probability: score.probability,
    label: score.label,
    reasons,
    entry: valid ? entry : null,
    stop: valid ? stop : null,
    target1: valid ? entry + 2 * distance : null,
    target2: valid ? entry + 3 * distance : null,
    quantity,
    regime: score.regime.regime,
    features: score.features,
    createdAt: now,
    dataAsOf: new Date(score.as_of),
    validUntil,
    day: indiaDay(now),
    highConviction: false,
  };
}
