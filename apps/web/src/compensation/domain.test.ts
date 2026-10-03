import {
  ALLOWANCE_DESCRIPTION_PRESETS,
  BONUS_DESCRIPTION_PRESETS,
  cents,
  CompensationAdjustmentKind,
  type StaffCompensationAdjustment,
} from '@coffee-shop/shared';
import { describe, expect, it } from 'vitest';
import {
  adjustmentDescriptionPresets,
  adjustmentKindLabel,
  cutoffContaining,
  nextCutoff,
  previousCutoff,
  signedAdjustmentAmount,
  sortAdjustments,
} from './domain';

function adjustment(
  id: string,
  kind: CompensationAdjustmentKind,
  effectiveDate: string,
  createdAt: string,
): StaffCompensationAdjustment {
  return {
    id,
    staffMemberId: 'staff-1',
    staffMemberDisplayName: 'Mara Santos',
    kind,
    effectiveDate,
    amountCents: cents(100),
    description: 'Exact  internal spacing',
    locationId: null,
    createdAt,
    updatedAt: createdAt,
  };
}

describe('pay cutoff helpers', () => {
  it.each([
    ['2026-10-01', { from: '2026-10-01', to: '2026-10-15' }],
    ['2026-10-15', { from: '2026-10-01', to: '2026-10-15' }],
    ['2026-10-16', { from: '2026-10-16', to: '2026-10-31' }],
    ['2026-10-31', { from: '2026-10-16', to: '2026-10-31' }],
    ['2027-02-28', { from: '2027-02-16', to: '2027-02-28' }],
    ['2028-02-29', { from: '2028-02-16', to: '2028-02-29' }],
    ['2026-04-30', { from: '2026-04-16', to: '2026-04-30' }],
  ])('finds the semi-monthly cutoff containing %s', (date, expected) => {
    expect(cutoffContaining(date)).toEqual(expected);
  });

  it('steps backward across month and year boundaries', () => {
    expect(previousCutoff({ from: '2026-10-01', to: '2026-10-15' }))
      .toEqual({ from: '2026-09-16', to: '2026-09-30' });
    expect(previousCutoff({ from: '2027-01-01', to: '2027-01-15' }))
      .toEqual({ from: '2026-12-16', to: '2026-12-31' });
    expect(previousCutoff({ from: '2028-03-01', to: '2028-03-15' }))
      .toEqual({ from: '2028-02-16', to: '2028-02-29' });
  });

  it('steps forward across a year boundary', () => {
    expect(nextCutoff({ from: '2026-12-16', to: '2026-12-31' }))
      .toEqual({ from: '2027-01-01', to: '2027-01-15' });
  });

  it('normalizes a hand-typed range through its From date before stepping', () => {
    const range = { from: '2026-10-12', to: '2026-11-03' };
    expect(previousCutoff(range)).toEqual({ from: '2026-09-16', to: '2026-09-30' });
    expect(nextCutoff(range)).toEqual({ from: '2026-10-16', to: '2026-10-31' });
  });

  it('uses the supplied shop date when From is empty', () => {
    const range = { from: '', to: '' };
    expect(previousCutoff(range, '2026-10-03'))
      .toEqual({ from: '2026-09-16', to: '2026-09-30' });
    expect(nextCutoff(range, '2026-10-03'))
      .toEqual({ from: '2026-10-16', to: '2026-10-31' });
  });

  it('returns an empty range for invalid calendar input instead of throwing', () => {
    expect(cutoffContaining('not-a-date')).toEqual({ from: '', to: '' });
    expect(previousCutoff({ from: '', to: '' })).toEqual({ from: '', to: '' });
    expect(nextCutoff({ from: '2026-02-30', to: '' })).toEqual({ from: '', to: '' });
  });
});

describe('compensation adjustment domain helpers', () => {
  it('uses the shared preset constants and no advance presets', () => {
    expect(adjustmentDescriptionPresets(CompensationAdjustmentKind.ALLOWANCE))
      .toBe(ALLOWANCE_DESCRIPTION_PRESETS);
    expect(adjustmentDescriptionPresets(CompensationAdjustmentKind.BONUS))
      .toBe(BONUS_DESCRIPTION_PRESETS);
    expect(adjustmentDescriptionPresets(CompensationAdjustmentKind.ADVANCE)).toEqual([]);
  });

  it('labels kinds and signs only advances as deductions', () => {
    expect(adjustmentKindLabel(CompensationAdjustmentKind.ADVANCE)).toBe('Advance');
    expect(signedAdjustmentAmount(adjustment('a', CompensationAdjustmentKind.ADVANCE, '2026-08-15', '2026-08-01T00:00:00Z'))).toBe(cents(-100));
    expect(signedAdjustmentAmount(adjustment('b', CompensationAdjustmentKind.BONUS, '2026-08-15', '2026-08-01T00:00:00Z'))).toBe(cents(100));
  });

  it('sorts newest dates first while retaining duplicate rows', () => {
    const first = adjustment('a', CompensationAdjustmentKind.ALLOWANCE, '2026-08-15', '2026-08-01T00:00:00Z');
    const duplicate = adjustment('b', CompensationAdjustmentKind.ALLOWANCE, '2026-08-15', '2026-08-02T00:00:00Z');
    const newer = adjustment('c', CompensationAdjustmentKind.BONUS, '2026-08-20', '2026-08-03T00:00:00Z');
    expect(sortAdjustments([duplicate, newer, first]).map(({ id }) => id)).toEqual(['c', 'a', 'b']);
  });
});
