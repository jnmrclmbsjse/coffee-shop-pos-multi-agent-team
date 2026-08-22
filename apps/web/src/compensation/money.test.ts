import { cents } from '@coffee-shop/shared';
import { describe, expect, it } from 'vitest';
import { adjustmentAmountToCents, amountForInput, currencyToCents } from './money';

describe('compensation money input', () => {
  it('converts currency to integer centavos without rounding', () => {
    expect(currencyToCents('0.07', 'Salary')).toEqual({ cents: cents(7) });
    expect(currencyToCents('1200.5', 'Salary')).toEqual({ cents: cents(120_050) });
    expect(currencyToCents('1.005', 'Salary')).toEqual({
      error: 'Salary cannot have more than 2 decimal places.',
    });
  });

  it('requires adjustment amounts to be at least one centavo', () => {
    expect(adjustmentAmountToCents('')).toEqual({ error: 'Enter an amount.' });
    expect(adjustmentAmountToCents('0')).toEqual({ error: 'Amount must be at least ₱0.01.' });
    expect(adjustmentAmountToCents('-1')).toEqual({ error: 'Amount cannot be negative.' });
    expect(adjustmentAmountToCents('12.345')).toEqual({
      error: 'Amount cannot have more than 2 decimal places.',
    });
    expect(adjustmentAmountToCents('0.01')).toEqual({ cents: cents(1) });
  });

  it('formats stored cents for an editable input', () => {
    expect(amountForInput(cents(45_007))).toBe('450.07');
  });
});
