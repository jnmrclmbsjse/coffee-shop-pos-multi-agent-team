import { describe, expect, it } from 'vitest';
import { LineDiscountKind } from './domain.js';
import {
  addMoney,
  calculateCashReconciliation,
  calculateLineAmounts,
  calculateOrderTotal,
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

describe('line discount helpers', () => {
  it('calculates an evenly divisible Senior discount', () => {
    expect(
      calculateLineAmounts(cents(100), 1, LineDiscountKind.SENIOR),
    ).toEqual({
      lineGrossCents: 100,
      discountCents: 20,
      lineTotalCents: 80,
    });
  });

  it('rounds a Senior discount upward per line', () => {
    expect(
      calculateLineAmounts(cents(103), 1, LineDiscountKind.SENIOR),
    ).toEqual({
      lineGrossCents: 103,
      discountCents: 21,
      lineTotalCents: 82,
    });
  });

  it('rounds a Senior discount downward per line', () => {
    expect(
      calculateLineAmounts(cents(102), 1, LineDiscountKind.SENIOR),
    ).toEqual({
      lineGrossCents: 102,
      discountCents: 20,
      lineTotalCents: 82,
    });
  });

  it('calculates gross before discount for a quantity greater than one', () => {
    expect(
      calculateLineAmounts(cents(103), 3, LineDiscountKind.SENIOR),
    ).toEqual({
      lineGrossCents: 309,
      discountCents: 62,
      lineTotalCents: 247,
    });
  });

  it('returns zero discount for NONE', () => {
    expect(calculateLineAmounts(cents(103), 2, LineDiscountKind.NONE)).toEqual({
      lineGrossCents: 206,
      discountCents: 0,
      lineTotalCents: 206,
    });
  });

  it('rolls up total from the pre-discount subtotal', () => {
    expect(calculateOrderTotal(cents(515), cents(103), cents(0))).toBe(412);
  });
});

describe('cash reconciliation helpers', () => {
  const baseInput = {
    status: 'CLOSED' as const,
    openingFloatCents: cents(0),
    payments: [],
    cashTipCents: [],
    cashInCents: cents(0),
    cashOutCents: cents(0),
    cashExpensesCents: cents(0),
    outstandingChangeCents: cents(0),
    latestCountedCents: cents(0),
  };

  it.each([
    ['cash in', { cashInCents: cents(700) }, 700],
    ['cash out', { cashOutCents: cents(700) }, -700],
    ['cash expenses', { cashExpensesCents: cents(700) }, -700],
    [
      'unsettled outstanding change',
      { outstandingChangeCents: cents(700) },
      700,
    ],
  ])('applies the %s term independently', (_name, override, expected) => {
    expect(
      calculateCashReconciliation({
        ...baseInput,
        ...override,
      }).expectedCashCents,
    ).toBe(expected);
  });

  it('calculates every labelled term when all terms are non-zero', () => {
    expect(
      calculateCashReconciliation({
        status: 'CLOSED',
        openingFloatCents: cents(10_000),
        payments: [
          { method: 'CASH', amountCents: cents(25_000) },
          { method: 'ONLINE', amountCents: cents(8_000) },
          { method: 'CASH', amountCents: cents(-2_000) },
        ],
        cashTipCents: [cents(1_500), cents(-500)],
        cashInCents: cents(4_000),
        cashOutCents: cents(2_000),
        cashExpensesCents: cents(3_000),
        outstandingChangeCents: cents(500),
        latestCountedCents: cents(33_000),
      }),
    ).toEqual({
      cashSalesCents: 23_000,
      onlineSalesCents: 8_000,
      grossSalesCents: 31_000,
      tipsCents: 1_000,
      cashInCents: 4_000,
      cashOutCents: 2_000,
      cashExpensesCents: 3_000,
      outstandingChangeCents: 500,
      expectedCashCents: 33_500,
      actualCashCents: 33_000,
      varianceCents: -500,
    });
  });

  it('subtracts a negative correcting cash-out total without changing its sign', () => {
    const result = calculateCashReconciliation({
      ...baseInput,
      cashOutCents: cents(-500),
    });

    expect(result.cashOutCents).toBe(-500);
    expect(result.expectedCashCents).toBe(500);
  });

  it('includes unsettled change and omits settled change from the supplied total', () => {
    const unsettled = calculateCashReconciliation({
      ...baseInput,
      outstandingChangeCents: cents(650),
    });
    const settled = calculateCashReconciliation(baseInput);

    expect(unsettled.outstandingChangeCents).toBe(650);
    expect(unsettled.expectedCashCents).toBe(650);
    expect(settled.outstandingChangeCents).toBe(0);
    expect(settled.expectedCashCents).toBe(0);
  });

  it('returns null actual cash and variance for an open day', () => {
    const result = calculateCashReconciliation({
      ...baseInput,
      status: 'OPEN',
      openingFloatCents: cents(10_000),
      latestCountedCents: cents(99_999),
    });

    expect(result.expectedCashCents).toBe(10_000);
    expect(result.actualCashCents).toBeNull();
    expect(result.varianceCents).toBeNull();
  });

  it('returns null actual cash and variance when a closed day has no count', () => {
    const result = calculateCashReconciliation({
      ...baseInput,
      latestCountedCents: null,
    });

    expect(result.actualCashCents).toBeNull();
    expect(result.varianceCents).toBeNull();
  });
});
