import { describe, expect, it } from 'vitest';
import { equalShares, formatCents, parseCents } from './money';

describe('parseCents', () => {
  it('accepts the ways people type amounts', () => {
    expect(parseCents('12')).toBe(1200);
    expect(parseCents('12.5')).toBe(1250);
    expect(parseCents('12.05')).toBe(1205);
    expect(parseCents(' $1,234.56 ')).toBe(123456);
    expect(parseCents('0.01')).toBe(1);
    expect(parseCents('7.')).toBe(700);
  });
  it('rejects anything ambiguous or out of range', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '12,34.5.6', '1e3', '100000.01', '9999999']) {
      expect(parseCents(bad), bad).toBeNull();
    }
  });
  it('never uses floating point, so cents are exact', () => {
    expect(parseCents('0.29')).toBe(29); // 0.29 * 100 = 28.999… in floating point
    expect(parseCents('1.15')).toBe(115);
  });
});

describe('equalShares', () => {
  it('gives leftover cents to the payer, like the database (OQ-06)', () => {
    const s = equalShares(1000, ['a', 'b', 'c'], 'b');
    expect([...s.values()]).toEqual([333, 334, 333]);
    expect([...s.values()].reduce((x, y) => x + y)).toBe(1000);
  });
  it('always adds up exactly', () => {
    for (let total = 1; total < 2000; total += 7) {
      for (let n = 1; n <= 10; n++) {
        const ids = Array.from({ length: n }, (_, i) => `m${i}`);
        const sum = [...equalShares(total, ids, 'm0').values()].reduce((x, y) => x + y);
        expect(sum).toBe(total);
      }
    }
  });
});

describe('formatCents', () => {
  it('formats as dollars without a sign', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-500)).toBe('$5.00');
  });
});
