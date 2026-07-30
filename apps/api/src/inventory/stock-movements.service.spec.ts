import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { MovementType as SharedMovementType } from '@coffee-shop/shared';
import { DayType, MovementType } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  OpenTradingDay,
  TradingDayService,
} from '../trading-day/trading-day.service';
import { StockMovementsService } from './stock-movements.service';

describe('StockMovementsService', () => {
  const openDay: OpenTradingDay = {
    id: 'day-id',
    locationId: null,
    businessDate: new Date('2026-07-23T00:00:00.000Z'),
    dayType: DayType.NORMAL,
  };

  function createPrisma() {
    const prisma = {
      inventoryItem: { findFirst: jest.fn() },
      staffMember: { findFirst: jest.fn() },
      stockMovement: {
        findMany: jest.fn(),
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

  function createTradingDay(day: OpenTradingDay | null = openDay) {
    return {
      findCurrentOpenDay: jest.fn().mockResolvedValue(day),
      toResponse: jest.fn((value: OpenTradingDay | null) => ({
        isOpen: value !== null,
        businessDate: value ? '2026-07-23' : null,
        dayType: value ? 'NORMAL' : null,
      })),
    };
  }

  function createService(day: OpenTradingDay | null = openDay) {
    const prisma = createPrisma();
    return {
      prisma,
      service: new StockMovementsService(
        prisma as unknown as PrismaService,
        createTradingDay(day) as unknown as TradingDayService,
      ),
    };
  }

  it('lists the current day movements newest first', async () => {
    const { prisma, service } = createService();
    prisma.stockMovement.findMany.mockResolvedValue([]);

    const result = await service.list();

    expect(result.movements).toEqual([]);
    expect(prisma.stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('accepts any active item and snapshots an active recorder', async () => {
    const { prisma, service } = createService();
    prisma.inventoryItem.findFirst.mockResolvedValue({ id: 'item-id' });
    prisma.staffMember.findFirst.mockResolvedValue({
      id: 'staff-id',
      displayName: 'Alex',
    });
    prisma.stockMovement.create.mockResolvedValue({
      id: 'movement-id',
      locationId: null,
      businessDate: openDay.businessDate,
      inventoryItemId: 'item-id',
      type: MovementType.DELIVERY,
      quantity: 2,
      recordedByStaffMemberId: 'staff-id',
      recordedByNameSnapshot: 'Alex',
      reason: 'Morning delivery',
      recordedAt: new Date('2026-07-23T08:00:00.000Z'),
      inventoryItem: { name: 'Milk level item' },
    });

    const result = await service.create({
      inventoryItemId: 'item-id',
      type: SharedMovementType.DELIVERY,
      quantity: 2,
      recordedByStaffMemberId: 'staff-id',
      reason: ' Morning delivery ',
    });

    expect(result.recordedByNameSnapshot).toBe('Alex');
    expect(prisma.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordedByNameSnapshot: 'Alex',
          reason: 'Morning delivery',
        }),
      }),
    );
  });

  it('rejects a negative movement quantity', async () => {
    const { service } = createService();

    await expect(
      service.create({
        inventoryItemId: 'item-id',
        type: SharedMovementType.WASTAGE,
        quantity: -1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 409 without writing when no day is open', async () => {
    const { prisma, service } = createService(null);

    await expect(
      service.create({
        inventoryItemId: 'item-id',
        type: SharedMovementType.WASTAGE,
        quantity: 0,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns an explicit no-day list result', async () => {
    const { service } = createService(null);

    await expect(service.list()).resolves.toEqual({
      businessDay: {
        isOpen: false,
        businessDate: null,
        dayType: null,
      },
      movements: [],
    });
  });
});
