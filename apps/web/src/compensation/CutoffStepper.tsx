import { shopDate } from '../reporting/format';
import {
  cutoffContaining,
  nextCutoff,
  previousCutoff,
  type CompensationDateRange,
} from './domain';

interface CutoffStepperProps {
  range: CompensationDateRange;
  onChange: (range: CompensationDateRange) => void;
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

function parseCalendarDate(value: string): CalendarDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatDate(date: CalendarDate): string {
  return `${MONTH_NAMES[date.month - 1]} ${date.day}, ${date.year}`;
}

function rangeLabel({ from, to }: CompensationDateRange): string {
  const start = parseCalendarDate(from);
  const end = parseCalendarDate(to);
  if (!from && !to) return 'No range selected';
  if (!start && end) return `Custom range: choose a start date (ends ${formatDate(end)})`;
  if (start && !end) return `Custom range: ${formatDate(start)} to choose an end date`;
  if (!start || !end) return 'Custom range: check the entered dates';

  const isExactCutoff = from === cutoffContaining(from).from
    && to === cutoffContaining(from).to;
  const prefix = isExactCutoff ? '' : 'Custom range: ';
  if (start.year === end.year && start.month === end.month) {
    return `${prefix}${MONTH_NAMES[start.month - 1]} ${start.day} – ${end.day}, ${end.year}`;
  }
  return `${prefix}${formatDate(start)} – ${formatDate(end)}`;
}

export function CutoffStepper({ range, onChange }: CutoffStepperProps) {
  function step(direction: 'previous' | 'next') {
    const fallbackDate = shopDate();
    onChange(direction === 'previous'
      ? previousCutoff(range, fallbackDate)
      : nextCutoff(range, fallbackDate));
  }

  return (
    <div className="cutoff-field">
      <span className="cutoff-field-caption">Pay cutoff</span>
      <div className="cutoff-stepper" role="group" aria-label="Pay cutoff navigation">
        <button
          type="button"
          aria-label="Previous cutoff"
          title="Previous cutoff"
          onClick={() => step('previous')}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <output className="cutoff-readout" aria-live="polite">
          {rangeLabel(range)}
        </output>
        <button
          type="button"
          aria-label="Next cutoff"
          title="Next cutoff"
          onClick={() => step('next')}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  );
}
