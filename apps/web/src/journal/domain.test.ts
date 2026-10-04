import { cents } from '@coffee-shop/shared';
import { describe, expect, it } from 'vitest';
import { amountForInput, currencyToCents } from './domain';

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
