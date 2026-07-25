import { describe, expect, it } from 'vitest';
import {
  addMoney,
  calculateCashReconciliation,
  cents,
  multiplyMoney,
} from './money.js';

describe('money helpers', () => {
  it('computes only with integer cents', () => {
    expect(addMoney(cents(150), cents(75))).toBe(225);
    expect(multiplyMoney(cents(125), 2)).toBe(250);
  });

  it('rejects fractional cents', () => {
    expect(() => cents(1.5)).toThrow(TypeError);
  });
});

describe('cash reconciliation helpers', () => {
  const baseInput = {
    openingFloatCents: cents(10_000),
    payments: [
      { method: 'CASH' as const, amountCents: cents(25_000) },
      { method: 'ONLINE' as const, amountCents: cents(8_000) },
      { method: 'CASH' as const, amountCents: cents(-2_000) },
    ],
    cashTipCents: [cents(1_500), cents(-500)],
    cashExpenseCents: [cents(3_000)],
  };

  it('calculates tender totals, gross sales, and expected cash in cents', () => {
    expect(
      calculateCashReconciliation({
        ...baseInput,
        status: 'CLOSED',
        latestCountedCents: cents(31_000),
      }),
    ).toEqual({
      cashSalesCents: 23_000,
      onlineSalesCents: 8_000,
      grossSalesCents: 31_000,
      tipsCents: 1_000,
      cashExpensesCents: 3_000,
      expectedCashCents: 31_000,
      actualCashCents: 31_000,
      varianceCents: 0,
    });
  });

  it('returns null actual cash and variance for an open day', () => {
    const result = calculateCashReconciliation({
      ...baseInput,
      status: 'OPEN',
      latestCountedCents: cents(99_999),
    });

    expect(result.actualCashCents).toBeNull();
    expect(result.varianceCents).toBeNull();
    expect(result.expectedCashCents).toBe(31_000);
  });

  it('returns null actual cash and variance when a closed day has no count', () => {
    const result = calculateCashReconciliation({
      ...baseInput,
      status: 'CLOSED',
      latestCountedCents: null,
    });

    expect(result.actualCashCents).toBeNull();
    expect(result.varianceCents).toBeNull();
  });

  it('uses a negative variance when the drawer is short', () => {
    const result = calculateCashReconciliation({
      ...baseInput,
      status: 'CLOSED',
      latestCountedCents: cents(29_500),
    });

    expect(result.varianceCents).toBe(-1_500);
  });
});
