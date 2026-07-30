import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  CountMethod,
  StockCountPhase,
} from '@prisma/client';
import { StockLevel } from '@coffee-shop/shared';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  OpenTradingDay,
  TradingDayService,
} from '../trading-day/trading-day.service';
import { StockCountsService } from './stock-counts.service';

describe('StockCountsService', () => {
  const businessDate = new Date('2026-07-23T00:00:00.000Z');
  const recordedAt = new Date('2026-07-23T08:00:00.000Z');
  const openDay: OpenTradingDay = {
    id: 'day-id',
    locationId: null,
    businessDate,
    dayType: 'NORMAL',
  };

  function createPrisma() {
    const prisma = {
      inventoryItem: {
        findMany: jest.fn(),
      },
      staffMember: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      stockCount: {
        findFirst: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      async (callback: (client: typeof prisma) => unknown) =>
        callback(prisma),
    );
    return prisma;
  }

  function createTradingDay(current: OpenTradingDay | null = openDay) {
    return {
      findCurrentOpenDay: jest.fn().mockResolvedValue(current),
      toResponse: jest.fn((day: OpenTradingDay | null) =>
        day
          ? {
              isOpen: true,
              businessDate: '2026-07-23',
              dayType: 'NORMAL',
            }
          : {
              isOpen: false,
              businessDate: null,
              dayType: null,
            },
      ),
    };
  }

  function countRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: 'count-id',
      locationId: null,
      businessDate,
      phase: StockCountPhase.OPEN,
      recordedAt,
      submittedByStaffMemberId: 'staff-id',
      submittedByNameSnapshot: 'Alex',
      shiftLeadStaffMemberId: null,
      shiftLeadNameSnapshot: null,
      correctsStockCountId: null,
      lines: [
        {
          id: 'line-id',
          stockCountId: 'count-id',
          inventoryItemId: 'item-id',
          quantity: 4,
          level: null,
          inventoryItem: { name: 'Beans' },
        },
      ],
      ...overrides,
    };
  }

  function createService(
    prisma = createPrisma(),
    tradingDay = createTradingDay(),
  ) {
    return {
      prisma,
      tradingDay,
      service: new StockCountsService(
        prisma as unknown as PrismaService,
        tradingDay as unknown as TradingDayService,
      ),
    };
  }

  function validInput() {
    return {
      phase: 'open' as const,
      submittedByStaffMemberId: 'staff-id',
      lines: [{ inventoryItemId: 'item-id', quantity: 4 }],
    };
  }

  function prepareSubmit(prisma: ReturnType<typeof createPrisma>) {
    prisma.staffMember.findFirst.mockResolvedValue({
      id: 'staff-id',
      displayName: 'Alex',
    });
    prisma.inventoryItem.findMany.mockResolvedValue([
      {
        id: 'item-id',
        active: true,
        critical: true,
        countMethod: CountMethod.QUANTITY,
      },
    ]);
    prisma.stockCount.create.mockResolvedValue(countRecord());
  }

  it('returns only active critical items on the opening sheet', async () => {
    const { prisma, service } = createService();
    prisma.inventoryItem.findMany.mockResolvedValue([]);
    prisma.stockCount.findFirst.mockResolvedValue(null);

    await service.openingSheet();

    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { active: true, critical: true },
        orderBy: [{ name: 'asc' }],
      }),
    );
  });

  it('orders the closing sheet by critical then name', async () => {
    const { prisma, service } = createService();
    prisma.inventoryItem.findMany.mockResolvedValue([]);
    prisma.stockCount.findFirst.mockResolvedValue(null);

    await service.closingSheet();

    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { active: true },
        orderBy: [{ critical: 'desc' }, { name: 'asc' }],
      }),
    );
  });

  it('returns only active staff alphabetically', async () => {
    const { prisma, service } = createService();
    prisma.staffMember.findMany.mockResolvedValue([]);

    await service.listActiveStaff();

    expect(prisma.staffMember.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true },
    });
  });

  it('returns the latest submitted count for the phase', async () => {
    const { prisma, service } = createService();
    prisma.inventoryItem.findMany.mockResolvedValue([]);
    prisma.stockCount.findFirst.mockResolvedValue(
      countRecord({
        id: 'newer-count',
        recordedAt: new Date('2026-07-23T09:00:00.000Z'),
      }),
    );

    const result = await service.openingSheet();

    expect(result.submittedCount?.id).toBe('newer-count');
    expect(prisma.stockCount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('rejects a level for a quantity-counted item', async () => {
    const { prisma, service } = createService();
    prepareSubmit(prisma);

    await expect(
      service.submit({
        ...validInput(),
        lines: [
          { inventoryItemId: 'item-id', level: StockLevel.LOW },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.stockCount.create).not.toHaveBeenCalled();
  });

  it('rejects a quantity for a level-counted item', async () => {
    const { prisma, service } = createService();
    prepareSubmit(prisma);
    prisma.inventoryItem.findMany.mockResolvedValue([
      {
        id: 'item-id',
        active: true,
        critical: true,
        countMethod: CountMethod.LEVEL,
      },
    ]);

    await expect(service.submit(validInput())).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.stockCount.create).not.toHaveBeenCalled();
  });

  it('rejects a negative quantity even when called without DTO validation', async () => {
    const { service } = createService();

    await expect(
      service.submit({
        ...validInput(),
        lines: [{ inventoryItemId: 'item-id', quantity: -1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('omits blank items instead of creating zero-valued lines', async () => {
    const { prisma, service } = createService();
    prepareSubmit(prisma);

    await service.submit(validInput());

    expect(prisma.stockCount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lines: {
            create: [
              {
                inventoryItemId: 'item-id',
                quantity: 4,
                level: null,
              },
            ],
          },
        }),
      }),
    );
  });

  it('snapshots submitter and shift-lead names in one transaction', async () => {
    const { prisma, service } = createService();
    prisma.staffMember.findFirst
      .mockResolvedValueOnce({
        id: 'staff-id',
        displayName: 'Alex',
      })
      .mockResolvedValueOnce({
        id: 'lead-id',
        displayName: 'Sam',
      });
    prisma.inventoryItem.findMany.mockResolvedValue([
      {
        id: 'item-id',
        active: true,
        critical: true,
        countMethod: CountMethod.QUANTITY,
      },
    ]);
    prisma.stockCount.create.mockResolvedValue(
      countRecord({
        shiftLeadStaffMemberId: 'lead-id',
        shiftLeadNameSnapshot: 'Sam',
      }),
    );

    await service.submit({
      ...validInput(),
      shiftLeadStaffMemberId: 'lead-id',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.stockCount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          submittedByNameSnapshot: 'Alex',
          shiftLeadNameSnapshot: 'Sam',
        }),
      }),
    );
  });

  it('returns an empty sheet state when no day is open', async () => {
    const { service } = createService(
      createPrisma(),
      createTradingDay(null),
    );

    await expect(service.openingSheet()).resolves.toEqual({
      businessDay: {
        isOpen: false,
        businessDate: null,
        dayType: null,
      },
      phase: 'open',
      items: [],
      submittedCount: null,
    });
  });

  it('returns 409 without writing when no day is open', async () => {
    const prisma = createPrisma();
    const { service } = createService(
      prisma,
      createTradingDay(null),
    );

    await expect(service.submit(validInput())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
