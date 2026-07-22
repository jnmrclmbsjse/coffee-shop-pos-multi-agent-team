import { describe, expect, it } from 'vitest';
import { addMoney, cents, multiplyMoney } from './money.js';

describe('money helpers', () => {
  it('computes only with integer cents', () => {
    expect(addMoney(cents(150), cents(75))).toBe(225);
    expect(multiplyMoney(cents(125), 2)).toBe(250);
  });

  it('rejects fractional cents', () => {
    expect(() => cents(1.5)).toThrow(TypeError);
  });
});
