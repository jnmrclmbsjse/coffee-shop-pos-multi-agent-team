import {
  ALLOWANCE_DESCRIPTION_PRESETS,
  BONUS_DESCRIPTION_PRESETS,
  cents,
  CompensationAdjustmentKind,
  type MoneyCents,
  type StaffCompensationAdjustment,
} from '@coffee-shop/shared';

export interface CompensationDateRange {
  from: string;
  to: string;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseCalendarDate(value: string): CalendarDate | null {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (!match) return null;
  const date = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  if (
    date.month < 1
    || date.month > 12
    || date.day < 1
    || date.day > daysInMonth(date.year, date.month)
  ) return null;
  return date;
}

function calendarDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function cutoffContaining(date: string): CompensationDateRange {
  const parsed = parseCalendarDate(date);
  if (!parsed) return { from: '', to: '' };
  const { year, month, day } = parsed;
  const firstHalf = day <= 15;
  return {
    from: calendarDate(year, month, firstHalf ? 1 : 16),
    to: calendarDate(year, month, firstHalf ? 15 : daysInMonth(year, month)),
  };
}

export function previousCutoff(
  range: CompensationDateRange,
  fallbackDate = range.from,
): CompensationDateRange {
  const current = cutoffContaining(range.from || fallbackDate);
  const parsed = parseCalendarDate(current.from);
  if (!parsed) return current;
  const { year, month, day } = parsed;
  if (day === 16) return cutoffContaining(calendarDate(year, month, 1));

  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  return cutoffContaining(calendarDate(previousYear, previousMonth, 16));
}

export function nextCutoff(
  range: CompensationDateRange,
  fallbackDate = range.from,
): CompensationDateRange {
  const current = cutoffContaining(range.from || fallbackDate);
  const parsed = parseCalendarDate(current.from);
  if (!parsed) return current;
  const { year, month, day } = parsed;
  if (day === 1) return cutoffContaining(calendarDate(year, month, 16));

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return cutoffContaining(calendarDate(nextYear, nextMonth, 1));
}

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
