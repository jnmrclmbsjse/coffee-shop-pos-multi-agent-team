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
