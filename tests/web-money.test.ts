import { describe, expect, it } from 'vitest';
import { rupees, toPaise } from '../apps/web/src/api';
describe('dashboard currency input', () => {
  it('converts paise exactly without binary decimal drift', () => {
    expect(toPaise('0.29')).toBe(29);
    expect(toPaise('1000000.01')).toBe(100000001);
    expect(toPaise('1.2')).toBe(120);
    expect(rupees(null)).toBe(String.fromCharCode(0x2014));
  });
  it('rejects exponents, excess precision, signs and invalid numbers', () => {
    for (const input of ['1e8', '0.001', '-1', 'NaN', 'Infinity', '100000000000']) {
      expect(() => toPaise(input)).toThrow('rupee amount');
    }
  });
});
