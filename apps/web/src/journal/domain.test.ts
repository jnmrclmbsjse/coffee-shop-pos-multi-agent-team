import { cents } from '@coffee-shop/shared';
import { describe, expect, it } from 'vitest';
import {
  amountForInput,
  basisPointsForInput,
  currencyToCents,
  percentToBasisPoints,
} from './domain';

describe('Journal money input', () => {
  it('keeps an entered zero distinct from an empty field', () => {
    expect(currencyToCents('0', 'Deposit amount', { allowZero: true }))
      .toEqual({ cents: cents(0) });
    expect(currencyToCents('', 'Deposit amount', { allowZero: true }))
      .toEqual({ error: 'Enter a deposit amount.' });
  });

  it('converts decimal strings without floating-point arithmetic', () => {
    expect(currencyToCents('1200.07', 'Deposit amount', { allowZero: true }))
      .toEqual({ cents: cents(120_007) });
    expect(currencyToCents('1.005', 'Deposit amount', { allowZero: true }))
      .toEqual({
        error: 'Deposit amount must be a valid amount with up to 2 decimal places.',
      });
  });

  it('enforces the different deposit and withdrawal zero rules', () => {
    expect(currencyToCents('-1', 'Deposit amount', { allowZero: true }))
      .toEqual({ error: 'Deposit amount cannot be negative.' });
    expect(currencyToCents('0', 'Withdrawal amount', { allowZero: false }))
      .toEqual({ error: 'Withdrawal amount must be greater than ₱0.00.' });
  });

  it('formats cents for editable form fields', () => {
    expect(amountForInput(0)).toBe('0.00');
    expect(amountForInput(120_007)).toBe('1200.07');
  });
});

describe('percentToBasisPoints', () => {
  it('converts a typed percentage to integer basis points at the edge', () => {
    expect(percentToBasisPoints('10')).toEqual({ basisPoints: 1000 });
    expect(percentToBasisPoints('12.5')).toEqual({ basisPoints: 1250 });
    expect(percentToBasisPoints('12.34')).toEqual({ basisPoints: 1234 });
    expect(percentToBasisPoints('0')).toEqual({ basisPoints: 0 });
    expect(percentToBasisPoints('100')).toEqual({ basisPoints: 10_000 });
  });

  it('refuses values the API would reject', () => {
    expect(percentToBasisPoints('').error).toBe('Enter a rent percentage.');
    expect(percentToBasisPoints('-5').error).toContain('cannot be negative');
    expect(percentToBasisPoints('10.001').error).toContain('2 decimal places');
    expect(percentToBasisPoints('100.01').error).toBe(
      'Rent percentage cannot be more than 100%.',
    );
  });

  it('round-trips through the settings field', () => {
    expect(basisPointsForInput(1000)).toBe('10');
    expect(basisPointsForInput(1250)).toBe('12.5');
    expect(basisPointsForInput(1234)).toBe('12.34');
    expect(basisPointsForInput(0)).toBe('0');
    expect(percentToBasisPoints(basisPointsForInput(1250))).toEqual({
      basisPoints: 1250,
    });
  });
});
