import { describe, expect, it } from 'vitest';
import {
  formatScheduleDayMessage,
  formatScheduleWeekMessage,
  formatShiftTime,
  weekStartFor,
} from './schedule.js';

describe('schedule helpers', () => {
  it('finds Sunday on or before a date', () => {
    expect(weekStartFor('2026-10-28')).toBe('2026-10-25');
    expect(weekStartFor('2026-10-25')).toBe('2026-10-25');
  });
  it('refuses an impossible calendar date', () => {
    expect(() => weekStartFor('2026-02-30')).toThrow(TypeError);
  });
  it.each([
    [0, '12:00 AM'],
    [720, '12:00 PM'],
    [420, '7:00 AM'],
  ])('formats %s', (minute, expected) => {
    expect(formatShiftTime(minute)).toBe(expected);
  });
  it('formats, sorts, and includes event and day off', () => {
    expect(
      formatScheduleDayMessage({
        date: '2026-10-25',
        eventNote: 'Birthday booking 3–6 PM',
        shifts: [
          {
            staffMemberId: 'b',
            displayName: 'Ben',
            startMinute: 720,
            endMinute: 1260,
          },
          {
            staffMemberId: 'a',
            displayName: 'Anna',
            startMinute: 420,
            endMinute: 900,
          },
        ],
        dayOff: [
          { staffMemberId: 'c', displayName: 'Carla' },
          { staffMemberId: 'd', displayName: 'Dan' },
        ],
      }),
    ).toBe(
      '📅 Sunday, 25 Oct 2026\n🎉 Event: Birthday booking 3–6 PM\nOn duty:\n• Anna: 7:00 AM – 3:00 PM\n• Ben: 12:00 PM – 9:00 PM\nDay off: Carla, Dan',
    );
  });
  it('formats empty duty and day-off lists without an event', () => {
    expect(
      formatScheduleDayMessage({
        date: '2026-10-25',
        eventNote: null,
        shifts: [],
        dayOff: [],
      }),
    ).toBe('📅 Sunday, 25 Oct 2026\nOn duty: none\nDay off: none');
  });
  it('joins every day of the week under one heading, in date order', () => {
    const day = (date: string, names: string[]) => ({
      date,
      eventNote: null,
      shifts: names.map((name, index) => ({
        staffMemberId: name,
        displayName: name,
        startMinute: 1020,
        endMinute: 1320 + index,
      })),
      dayOff: [],
    });
    const days = [
      day('2026-10-25', ['Patricia', 'Shiela']),
      day('2026-10-26', ['Rodette']),
      day('2026-10-27', []),
      day('2026-10-28', []),
      day('2026-10-29', []),
      day('2026-10-30', []),
      day('2026-10-31', []),
    ];
    const message = formatScheduleWeekMessage({
      weekStartDate: '2026-10-25',
      // Out of order on purpose: the message must still run Sunday first.
      days: [days[1]!, days[0]!, ...days.slice(2)],
    });
    const blocks = message.split('\n\n');
    expect(blocks[0]).toBe('🗓️ Weekly schedule: 25 Oct – 31 Oct 2026');
    expect(blocks).toHaveLength(8);
    // Each day block is exactly that day's own Copy message.
    expect(blocks.slice(1)).toEqual(days.map(formatScheduleDayMessage));
    expect(blocks[1]).toContain('• Patricia: 5:00 PM – 10:00 PM');
    expect(blocks[7]).toBe(
      '📅 Saturday, 31 Oct 2026\nOn duty: none\nDay off: none',
    );
  });

  it('crosses a month and a year in the heading', () => {
    expect(
      formatScheduleWeekMessage({ weekStartDate: '2026-12-27', days: [] }),
    ).toBe('🗓️ Weekly schedule: 27 Dec 2026 – 2 Jan 2027');
  });
});
