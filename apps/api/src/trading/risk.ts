import { invariant } from '../errors.js';
import { add, basisPoints, notional } from '../money.js';
import type { Portfolio } from '../models.js';
import type { FeeSchedule, Instrument, OrderInput, Quote } from './types.js';

// Illustrative simulation inputs, not a statement of current statutory fees.
export const defaultFees: FeeSchedule = {
  version: 'simulation-v1',
  brokerageBps: 3,
  brokerageCap: 2000,
  exchangeBps: 1,
  sttBuyBps: 10,
  sttSellBps: 10,
  stampBuyBps: 2,
  sebiBps: 1,
  gstBps: 1800,
  slippageBps: 5,
};
export const limits = {
  equity: 70_000_000,
  derivatives: 30_000_000,
  positionBps: 1500,
  riskBps: 50,
  sectorBps: 3000,
  groupBps: 4000,
  dailyLossBps: 200,
  drawdownBps: 1000,
  maxPositions: 10,
  maxSpreadBps: 100,
};
export function fees(value: number, side: 'BUY' | 'SELL', schedule = defaultFees) {
  const brokerage = Math.min(basisPoints(value, schedule.brokerageBps), schedule.brokerageCap);
  const exchange = basisPoints(value, schedule.exchangeBps);
  const sebi = basisPoints(value, schedule.sebiBps);
  const gst = basisPoints(add(brokerage, exchange, sebi), schedule.gstBps);
  return add(
    brokerage,
    exchange,
    sebi,
    gst,
    basisPoints(value, side === 'BUY' ? schedule.sttBuyBps : schedule.sttSellBps),
    side === 'BUY' ? basisPoints(value, schedule.stampBuyBps) : 0,
  );
}
export function validQuote(quote: Quote, now = new Date(), maxAge = 60_000) {
  invariant(
    quote.quality === 'verified',
    'DATA_UNAVAILABLE',
    'Development quotes cannot execute orders',
  );
  invariant(
    quote.asOf instanceof Date &&
      Number.isFinite(quote.asOf.getTime()) &&
      quote.asOf.getTime() <= now.getTime() &&
      now.getTime() - quote.asOf.getTime() <= maxAge,
    'STALE_DATA',
    'Quote is stale or dated in the future',
  );
  invariant(
    [quote.bid, quote.ask, quote.last].every((v) => Number.isSafeInteger(v) && v > 0) &&
      quote.ask >= quote.bid &&
      Number.isSafeInteger(quote.availableQuantity) &&
      quote.availableQuantity >= 0,
    'INVALID_QUOTE',
    'Quote cannot support execution',
  );
}
export function bracket(input: OrderInput, instrument: Instrument) {
  invariant(instrument.active, 'INACTIVE', 'Instrument is not tradeable');
  invariant(
    instrument.kind !== 'FUTURE',
    'UNSUPPORTED_MARGIN',
    'Futures execution requires a verified margin adapter',
  );
  invariant(
    input.quantity > 0 &&
      Number.isInteger(input.quantity) &&
      input.quantity % instrument.lotSize === 0,
    'INVALID_LOTS',
    'Quantity must be a positive multiple of the current lot size',
  );
  invariant(
    [
      input.maxPrice,
      input.stop,
      input.target1,
      input.target2,
      input.triggerPrice ?? input.maxPrice,
    ].every(
      (price) => Number.isSafeInteger(price) && price > 0 && price % instrument.tickSize === 0,
    ),
    'INVALID_TICK',
    'Prices must align to the instrument tick size',
  );
  invariant(
    input.stop < input.maxPrice && input.maxPrice < input.target1 && input.target1 <= input.target2,
    'INVALID_BRACKET',
    'Entry must have an existing stop and ordered targets',
  );
  invariant(
    input.target1 - input.maxPrice >= 2 * (input.maxPrice - input.stop),
    'REWARD_RISK',
    'Minimum planned reward/risk is 2',
  );
  if (input.type === 'STOP' || input.type === 'STOP_LIMIT') {
    invariant(
      input.triggerPrice && input.triggerPrice <= input.maxPrice,
      'INVALID_TRIGGER',
      'Stop entry requires a trigger at or below maximum price',
    );
  }
}
export interface Exposure {
  value: number;
  equityPending: number;
  derivativesPending: number;
  instrument: number;
  sector: number;
  group: number;
  positions: number;
  totalPlannedRisk: number;
}
export function assess(
  portfolio: Portfolio,
  input: OrderInput,
  instrument: Instrument,
  quote: Quote,
  exposure: Exposure,
  schedule = defaultFees,
) {
  bracket(input, instrument);
  validQuote(quote);
  invariant(!portfolio.paused && !portfolio.killed, 'TRADING_PAUSED', 'New exposure is disabled');
  invariant(
    quote.ask - quote.bid <= basisPoints(quote.ask, limits.maxSpreadBps),
    'SPREAD',
    'Spread exceeds policy',
  );
  const value = notional(input.maxPrice, input.quantity);
  const reserve = add(value, fees(value, 'BUY', schedule));
  invariant(
    reserve <= portfolio.cash - portfolio.blocked,
    'INSUFFICIENT_FUNDS',
    'Insufficient unreserved cash',
  );
  const option = instrument.kind !== 'EQUITY';
  const deployed = option
    ? portfolio.derivatives + exposure.derivativesPending
    : portfolio.equity + exposure.equityPending;
  invariant(
    deployed + reserve <= (option ? limits.derivatives : limits.equity),
    'ALLOCATION_LIMIT',
    'Asset allocation ceiling reached',
  );
  invariant(
    exposure.instrument + reserve <= basisPoints(exposure.value, limits.positionBps),
    'POSITION_LIMIT',
    'Single instrument exposure is too high',
  );
  invariant(
    exposure.sector + reserve <= basisPoints(exposure.value, limits.sectorBps),
    'SECTOR_LIMIT',
    'Sector exposure is too high',
  );
  invariant(
    exposure.group + reserve <= basisPoints(exposure.value, limits.groupBps),
    'CORRELATION_LIMIT',
    'Correlated exposure is too high',
  );
  invariant(
    exposure.positions < limits.maxPositions,
    'POSITION_COUNT',
    'Maximum open positions reached',
  );
  // A long option can lose its full premium even when a stop was planned.
  const plannedRisk = option
    ? reserve
    : add(
        notional(input.maxPrice - input.stop, input.quantity),
        fees(value, 'BUY', schedule),
        fees(value, 'SELL', schedule),
      );
  invariant(
    plannedRisk <= basisPoints(exposure.value, limits.riskBps),
    'RISK_LIMIT',
    'Trade exceeds loss budget',
  );
  invariant(
    exposure.totalPlannedRisk + plannedRisk <= basisPoints(exposure.value, 300),
    'AGGREGATE_RISK',
    'Combined planned loss exceeds portfolio policy',
  );
  invariant(
    exposure.value >=
      portfolio.dailyStartValue - basisPoints(portfolio.dailyStartValue, limits.dailyLossBps),
    'DAILY_LOSS',
    'Daily loss limit reached',
  );
  invariant(
    exposure.value >= portfolio.peakValue - basisPoints(portfolio.peakValue, limits.drawdownBps),
    'DRAWDOWN',
    'Portfolio drawdown limit reached',
  );
  return { reserve, plannedRisk };
}
export function suggestedQuantity(
  value: number,
  cash: number,
  entry: number,
  stop: number,
  lotSize = 1,
) {
  invariant(entry > stop && stop > 0 && lotSize > 0, 'INVALID_SIZE', 'Invalid sizing inputs');
  const risk = Math.floor(basisPoints(value, limits.riskBps) / (entry - stop));
  const funds = Math.floor(Math.min(cash, basisPoints(value, limits.positionBps)) / (entry * 1.01));
  return Math.max(0, Math.floor(Math.min(risk, funds) / lotSize) * lotSize);
}
