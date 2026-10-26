import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { weekStartFor } from '@coffee-shop/shared';
import { SchedulingService } from './scheduling.service';

function currentWeek() {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return weekStartFor(today);
}
function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function input(week: string) {
  return {
    days: [
      {
        date: week,
        eventNote: null,
        shifts: [
          {
            staffMemberId: '9e55c455-879c-4ea8-8365-433e0e2cf4a3',
            startMinute: 420,
            endMinute: 900,
          },
        ],
      },
    ],
  };
}

describe('SchedulingService', () => {
  const staffId = '9e55c455-879c-4ea8-8365-433e0e2cf4a3';
  function setup(mockGetWeek = true) {
    const tx = {
      scheduleWeek: {
        findFirst: jest.fn().mockResolvedValue({ id: 'week' }),
        create: jest.fn(),
        update: jest.fn(),
      },
      scheduleShift: { deleteMany: jest.fn(), createMany: jest.fn() },
      scheduleDayNote: { deleteMany: jest.fn(), createMany: jest.fn() },
    };
    const prisma = {
      staffMember: { findMany: jest.fn().mockResolvedValue([{ id: staffId }]) },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new SchedulingService(prisma as never);
    if (mockGetWeek)
      jest
        .spyOn(service, 'getWeek')
        .mockResolvedValue({
          weekStartDate: currentWeek(),
          source: 'SAVED',
          copiedFromWeekStartDate: null,
          editable: true,
          days: [],
        });
    return { service, prisma, tx };
  }
  it('refuses a non-Sunday week', async () => {
    const { service } = setup(false);
    await expect(
      service.getWeek(addDays(currentWeek(), 1)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('refuses an impossible calendar date', async () => {
    const { service } = setup(false);
    await expect(service.getWeek('2026-02-30')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it.each([-7, 14])(
    'refuses a week outside the edit window (%s days)',
    async (offset) => {
      const { service } = setup();
      const week = addDays(currentWeek(), offset);
      await expect(
        service.saveWeek(week, input(week), 'admin'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );
  it('refuses duplicate staff on one day', async () => {
    const { service } = setup();
    const week = currentWeek();
    const value = input(week);
    value.days[0]!.shifts.push({ ...value.days[0]!.shifts[0]! });
    await expect(service.saveWeek(week, value, 'admin')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
  it('refuses end at or before start', async () => {
    const { service } = setup();
    const week = currentWeek();
    const value = input(week);
    value.days[0]!.shifts[0]!.endMinute = 420;
    await expect(service.saveWeek(week, value, 'admin')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('replaces shifts and notes in one transaction', async () => {
    const { service, prisma, tx } = setup();
    const week = currentWeek();
    await service.saveWeek(week, input(week), 'admin');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.scheduleShift.deleteMany).toHaveBeenCalledWith({
      where: { weekId: 'week' },
    });
    expect(tx.scheduleShift.createMany).toHaveBeenCalled();
  });

  it('returns a saved week with its event notes', async () => {
    const week = '2026-10-25';
    const prisma = {
      staffMember: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: staffId, displayName: 'Anna' }]),
      },
      scheduleWeek: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'week',
          weekStartDate: new Date(`${week}T00:00:00Z`),
          shifts: [
            {
              staffMemberId: staffId,
              shiftDate: new Date(`${week}T00:00:00Z`),
              startMinute: 420,
              endMinute: 900,
              staffMember: { displayName: 'Anna', isActive: true },
            },
          ],
          dayNotes: [
            {
              noteDate: new Date(`${week}T00:00:00Z`),
              eventNote: 'Market day',
            },
          ],
        }),
      },
    };
    const result = await new SchedulingService(prisma as never).getWeek(week);
    expect(result.source).toBe('SAVED');
    expect(result.days[0]).toMatchObject({
      eventNote: 'Market day',
      shifts: [{ displayName: 'Anna' }],
      dayOff: [],
    });
  });

  it('copies the latest earlier week by weekday, dropping notes and inactive staff', async () => {
    const week = '2026-11-01';
    const source = '2026-10-25';
    const prisma = {
      staffMember: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: staffId, displayName: 'Anna' }]),
      },
      scheduleWeek: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'source',
            weekStartDate: new Date(`${source}T00:00:00Z`),
            shifts: [
              {
                staffMemberId: staffId,
                shiftDate: new Date(`${source}T00:00:00Z`),
                startMinute: 420,
                endMinute: 900,
                staffMember: { displayName: 'Anna', isActive: true },
              },
              {
                staffMemberId: 'inactive',
                shiftDate: new Date(`${source}T00:00:00Z`),
                startMinute: 480,
                endMinute: 960,
                staffMember: { displayName: 'Former staff', isActive: false },
              },
            ],
            dayNotes: [
              {
                noteDate: new Date(`${source}T00:00:00Z`),
                eventNote: 'Do not copy',
              },
            ],
          }),
      },
    };
    const result = await new SchedulingService(prisma as never).getWeek(week);
    expect(result).toMatchObject({
      source: 'COPIED',
      copiedFromWeekStartDate: source,
    });
    expect(result.days[0]).toMatchObject({
      date: week,
      eventNote: null,
      shifts: [{ displayName: 'Anna' }],
      dayOff: [],
    });
  });

  it('returns an empty derived week when no earlier week exists', async () => {
    const prisma = {
      staffMember: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: staffId, displayName: 'Anna' }]),
      },
      scheduleWeek: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const result = await new SchedulingService(prisma as never).getWeek(
      '2026-11-01',
    );
    expect(result.source).toBe('EMPTY');
    expect(result.days).toHaveLength(7);
    expect(result.days[0]).toMatchObject({
      shifts: [],
      dayOff: [{ displayName: 'Anna' }],
    });
  });

  it('keeps staff who are now inactive on a saved past week', async () => {
    const week = addDays(currentWeek(), -14);
    const prisma = {
      staffMember: { findMany: jest.fn().mockResolvedValue([]) },
      scheduleWeek: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'week',
          weekStartDate: new Date(`${week}T00:00:00Z`),
          shifts: [
            {
              staffMemberId: staffId,
              shiftDate: new Date(`${week}T00:00:00Z`),
              startMinute: 420,
              endMinute: 900,
              staffMember: { displayName: 'Former Anna', isActive: false },
            },
          ],
          dayNotes: [],
        }),
      },
    };
    const result = await new SchedulingService(prisma as never).getWeek(week);
    expect(result).toMatchObject({ source: 'SAVED', editable: false });
    expect(result.days[0]?.shifts).toEqual([
      expect.objectContaining({ displayName: 'Former Anna' }),
    ]);
  });

  it('refuses the same date twice in one save', async () => {
    const { service, prisma } = setup();
    const week = currentWeek();
    const day = input(week).days[0]!;
    await expect(
      service.saveWeek(week, { days: [day, { ...day, shifts: [] }] }, 'admin'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
