import { describe, expect, it } from 'vitest';
import { StockLevel } from '@coffee-shop/shared';
import {
  formatCount,
  formatLocation,
  formatMoney,
  formatOptionalCount,
  formatSignedCount,
  formatStockLevel,
  formatSubmissionTime,
  rangeError,
  reportingDefaultRange,
  shopDate,
} from './format';

describe('reporting format helpers', () => {
  it('formats integer cents without losing sign or centavos', () => {
    expect(formatMoney(0)).toBe('₱0.00');
    expect(formatMoney(123456)).toBe('₱1,234.56');
    expect(formatMoney(-5000)).toBe('₱-50.00');
  });

  it('uses the Asia/Manila shop date for the inclusive 14-date range', () => {
    const beforeManilaMidnight = new Date('2026-07-25T15:59:59.000Z');
    const afterManilaMidnight = new Date('2026-07-25T16:00:00.000Z');

    expect(shopDate(beforeManilaMidnight)).toBe('2026-07-25');
    expect(shopDate(afterManilaMidnight)).toBe('2026-07-26');
    expect(reportingDefaultRange(afterManilaMidnight)).toEqual({
      from: '2026-07-13',
      to: '2026-07-26',
    });
  });

  it('validates blank and inverted ranges', () => {
    expect(rangeError('', '2026-07-26')).toBe(
      'Choose both a From date and a To date.',
    );
    expect(rangeError('2026-07-27', '2026-07-26')).toBe(
      'From date must be on or before To date.',
    );
    expect(rangeError('2026-07-13', '2026-07-26')).toBe('');
  });

  it('formats physical counts without collapsing null into a recorded zero', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(1234)).toBe('1,234');
    expect(formatOptionalCount(0)).toBe('0');
    expect(formatOptionalCount(null)).toBe('Unavailable');
    expect(formatSignedCount(2)).toBe('+2');
    expect(formatSignedCount(-2)).toBe('-2');
  });

  it('formats location, stock levels, and count submission time', () => {
    expect(formatLocation(null)).toBe('UCM Coffee Studio');
    expect(formatLocation('branch-id')).toBe('Location branch-id');
    expect(formatStockLevel(StockLevel.ONE_THIRD)).toBe('One-third');
    expect(formatStockLevel(null)).toBe('Unavailable');
    expect(formatSubmissionTime('2026-07-26T13:42:00.000Z')).toBe(
      'July 26, 2026 at 9:42 PM',
    );
  });
});
