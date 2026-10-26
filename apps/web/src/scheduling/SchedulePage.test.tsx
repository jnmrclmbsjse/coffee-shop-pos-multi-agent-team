import type { ScheduleWeekView, StaffMember } from '@coffee-shop/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SchedulePage } from './SchedulePage';

const api = vi.hoisted(() => ({ get: vi.fn(), listStaff: vi.fn() }));
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getScheduleWeek: api.get,
}));
vi.mock('../staff/api', () => ({ listStaffMembers: api.listStaff }));

const staff: StaffMember[] = [
  {
    id: '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
    displayName: 'Anna',
    isActive: true,
    baseSalaryCents: null,
    locationId: null,
    hasAccount: false,
    accountUsername: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    employmentType: null,
    nextMilestone: null,
  },
  {
    id: '1b4f35af-a2c2-491d-88be-373c5efa4df4',
    displayName: 'Ben',
    isActive: true,
    baseSalaryCents: null,
    locationId: null,
    hasAccount: false,
    accountUsername: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    employmentType: null,
    nextMilestone: null,
  },
];

const week: ScheduleWeekView = {
  weekStartDate: '2026-10-25',
  source: 'SAVED',
  copiedFromWeekStartDate: null,
  editable: true,
  days: [
    {
      date: '2026-10-25',
      eventNote: 'Birthday booking',
      shifts: [
        {
          staffMemberId: staff[0]!.id,
          displayName: 'Anna',
          startMinute: 420,
          endMinute: 900,
        },
      ],
      dayOff: [{ staffMemberId: staff[1]!.id, displayName: 'Ben' }],
    },
  ],
};

describe('SchedulePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue(week);
    api.listStaff.mockResolvedValue(staff);
  });

  it('copies the displayed Messenger text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    render(<SchedulePage />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Copy message' }),
    );
    expect(writeText).toHaveBeenCalledWith(
      '📅 Sunday, 25 Oct 2026\n🎉 Event: Birthday booking\nOn duty:\n• Anna: 7:00 AM – 3:00 PM\nDay off: Ben',
    );
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });
});
