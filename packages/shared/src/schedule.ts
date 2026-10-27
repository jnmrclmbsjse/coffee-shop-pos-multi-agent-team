import type { ScheduleDayView, ScheduleWeekView } from './domain.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function weekStartFor(date: string | Date): string {
  const value =
    typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  if (!DATE_RE.test(value)) throw new TypeError('date must be YYYY-MM-DD');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new TypeError('date must be a valid YYYY-MM-DD date');
  }
  parsed.setUTCDate(parsed.getUTCDate() - parsed.getUTCDay());
  return parsed.toISOString().slice(0, 10);
}

export function formatShiftTime(minute: number): string {
  if (!Number.isInteger(minute) || minute < 0 || minute > 1440) {
    throw new TypeError('minute must be an integer from 0 to 1440');
  }
  const normalized = minute === 1440 ? 0 : minute;
  const hour24 = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`;
}

export function formatScheduleDayMessage(day: ScheduleDayView): string {
  const date = new Date(`${day.date}T00:00:00.000Z`);
  const heading = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
  const lines = [`📅 ${heading}`];
  const eventNote = day.eventNote?.trim();
  if (eventNote) lines.push(`🎉 Event: ${eventNote}`);
  const shifts = [...day.shifts].sort(
    (a, b) =>
      a.startMinute - b.startMinute ||
      a.displayName.localeCompare(b.displayName),
  );
  if (shifts.length === 0) lines.push('On duty: none');
  else {
    lines.push('On duty:');
    for (const shift of shifts)
      lines.push(
        `• ${shift.displayName}: ${formatShiftTime(shift.startMinute)} – ${formatShiftTime(shift.endMinute)}`,
      );
  }
  lines.push(
    `Day off: ${
      day.dayOff.length
        ? day.dayOff
            .map((person) => person.displayName)
            .sort()
            .join(', ')
        : 'none'
    }`,
  );
  return lines.join('\n');
}

/** The whole week as one message: a heading line, then each day's message
 * (the same text as that day's own Copy message), separated by blank lines. */
export function formatScheduleWeekMessage(
  week: Pick<ScheduleWeekView, 'weekStartDate' | 'days'>,
): string {
  const start = new Date(`${week.weekStartDate}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const format = (date: Date, withYear: boolean) =>
    new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      ...(withYear ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    }).format(date);
  const crossesYear = start.getUTCFullYear() !== end.getUTCFullYear();
  const heading = `🗓️ Weekly schedule: ${format(start, crossesYear)} – ${format(end, true)}`;
  const days = [...week.days]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(formatScheduleDayMessage);
  return [heading, ...days].join('\n\n');
}
