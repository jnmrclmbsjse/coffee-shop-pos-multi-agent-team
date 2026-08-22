import {
  ALLOWANCE_DESCRIPTION_PRESETS,
  BONUS_DESCRIPTION_PRESETS,
  cents,
  CompensationAdjustmentKind,
  type MoneyCents,
  type StaffCompensationAdjustment,
} from '@coffee-shop/shared';

const KIND_LABELS: Record<CompensationAdjustmentKind, string> = {
  [CompensationAdjustmentKind.ADVANCE]: 'Advance',
  [CompensationAdjustmentKind.ALLOWANCE]: 'Allowance',
  [CompensationAdjustmentKind.BONUS]: 'Bonus',
};

export function adjustmentKindLabel(kind: CompensationAdjustmentKind): string {
  return KIND_LABELS[kind];
}

export function adjustmentDescriptionPresets(
  kind: CompensationAdjustmentKind,
): readonly string[] {
  if (kind === CompensationAdjustmentKind.ALLOWANCE) return ALLOWANCE_DESCRIPTION_PRESETS;
  if (kind === CompensationAdjustmentKind.BONUS) return BONUS_DESCRIPTION_PRESETS;
  return [];
}

export function signedAdjustmentAmount(adjustment: StaffCompensationAdjustment): MoneyCents {
  return adjustment.kind === CompensationAdjustmentKind.ADVANCE
    ? cents(-adjustment.amountCents)
    : adjustment.amountCents;
}

export function sortAdjustments(
  adjustments: readonly StaffCompensationAdjustment[],
): StaffCompensationAdjustment[] {
  return [...adjustments].sort(
    (left, right) =>
      right.effectiveDate.localeCompare(left.effectiveDate)
      || left.createdAt.localeCompare(right.createdAt),
  );
}
