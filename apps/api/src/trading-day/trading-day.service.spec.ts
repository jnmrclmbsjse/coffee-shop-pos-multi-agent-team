import { DayType, TradingDayStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { TradingDayService } from './trading-day.service';

describe('TradingDayService', () => {
  it('returns the latest open business day as a date-only response', async () => {
    const prisma = {
      tradingDay: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'day-id',
          locationId: null,
          businessDate: new Date('2026-07-23T00:00:00.000Z'),
          dayType: DayType.PEAK,
        }),
      },
    };
    const service = new TradingDayService(
      prisma as unknown as PrismaService,
    );

    await expect(service.getCurrentOpenDay()).resolves.toEqual({
      isOpen: true,
      businessDate: '2026-07-23',
      dayType: 'PEAK',
    });
    expect(prisma.tradingDay.findFirst).toHaveBeenCalledWith({
      where: { status: TradingDayStatus.OPEN },
      orderBy: { openedAt: 'desc' },
      select: {
        id: true,
        locationId: true,
        businessDate: true,
        dayType: true,
      },
    });
  });

  it('returns an explicit no-open-day result', async () => {
    const prisma = {
      tradingDay: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new TradingDayService(
      prisma as unknown as PrismaService,
    );

    await expect(service.getCurrentOpenDay()).resolves.toEqual({
      isOpen: false,
      businessDate: null,
      dayType: null,
    });
  });
});
