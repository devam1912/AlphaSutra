import { invariant } from './errors.js';

// Integer paise are exact across JS and BSON within our bounded account size.
export const MAX_MONEY = 1_000_000_000_000;
export const INITIAL_CASH = 100_000_000;

export function money(value: number): number {
  invariant(
    Number.isSafeInteger(value) && Math.abs(value) <= MAX_MONEY,
    'INVALID_MONEY',
    'Amount must be integer paise within the account limit',
  );
  return value;
}

export function add(...values: number[]): number {
  return money(values.reduce((sum, value) => sum + money(value), 0));
}

export function notional(price: number, quantity: number): number {
  invariant(Number.isSafeInteger(quantity) && quantity > 0, 'INVALID_QUANTITY', 'Invalid quantity');
  return money(money(price) * quantity);
}

export function basisPoints(amount: number, bps: number): number {
  invariant(Number.isInteger(bps) && bps >= 0 && bps <= 10_000, 'INVALID_RATE', 'Invalid fee rate');
  const numerator = BigInt(money(amount)) * BigInt(bps);
  return money(Number((numerator + 9_999n) / 10_000n));
}
