import {
  CountMethod,
  MovementType,
  OrderStatus,
  SaleKind,
  StockCountPhase,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { PackagingReconciliationService } from './packaging-reconciliation.service';
import type { PackagingReconciliationTradingDay } from './packaging-reconciliation.service';

describe('PackagingReconciliationService', () => {
  const day: PackagingReconciliationTradingDay = {
    id: 'day-id',
    locationId: null,
    businessDate: new Date('2026-07-31T00:00:00.000Z'),
  };

  function createPrisma() {
    return {
      inventoryItem: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'cup-id', name: '12 oz Cup' },
        ]),
      },
      stockCount: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      stockMovement: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      saleLine: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
  }

  function createService() {
    const prisma = createPrisma();
    return {
      prisma,
      service: new PackagingReconciliationService(
        prisma as unknown as PrismaService,
      ),
    };
  }

  function count(
    id: string,
    phase: StockCountPhase,
    quantity: number | null,
    options: {
      correctsStockCountId?: string | null;
      recordedAt?: string;
      includeLine?: boolean;
    } = {},
  ) {
    return {
      id,
      phase,
      recordedAt: new Date(
        options.recordedAt || '2026-07-31T08:00:00.000Z',
      ),
      correctsStockCountId:
        options.correctsStockCountId || null,
      lines:
        options.includeLine === false
          ? []
          : [
              {
                inventoryItemId: 'cup-id',
                quantity,
              },
            ],
    };
  }

  function saleLine(
    quantity: number,
    cupInventoryItemId: string | null = 'cup-id',
    lidInventoryItemId: string | null = null,
    packagingServingsSnapshot = 1,
  ) {
    return {
      quantity,
      packagingServingsSnapshot,
      productVariant: {
        cupInventoryItemId,
        lidInventoryItemId,
      },
    };
  }

  it('returns null expected and variance when the opening count is missing', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      count('close', StockCountPhase.CLOSE, 8),
    ]);
    prisma.saleLine.findMany.mockResolvedValue([saleLine(2)]);

    await expect(service.getForTradingDay(day)).resolves.toEqual([
      {
        inventoryItemId: 'cup-id',
        itemName: '12 oz Cup',
        openingQty: null,
        deliveriesQty: 0,
        wastageQty: 0,
        soldQty: 2,
        expectedQty: null,
        actualQty: 8,
        varianceQty: null,
      },
    ]);
  });

  it('keeps every numeric field unavailable when both counts are missing', async () => {
    const { service } = createService();

    await expect(service.getForTradingDay(day)).resolves.toEqual([
      expect.objectContaining({
        openingQty: null,
        expectedQty: null,
        actualQty: null,
        varianceQty: null,
      }),
    ]);
  });

  it('returns null actual and variance when the closing count is missing', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      count('open', StockCountPhase.OPEN, 10),
    ]);
    prisma.saleLine.findMany.mockResolvedValue([saleLine(2)]);

    await expect(service.getForTradingDay(day)).resolves.toEqual([
      expect.objectContaining({
        expectedQty: 8,
        actualQty: null,
        varianceQty: null,
      }),
    ]);
  });

  it('computes expected, actual and variance when both counts exist', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      count('open', StockCountPhase.OPEN, 10),
      count('close', StockCountPhase.CLOSE, 7),
    ]);
    prisma.saleLine.findMany.mockResolvedValue([saleLine(2)]);

    await expect(service.getForTradingDay(day)).resolves.toEqual([
      expect.objectContaining({
        expectedQty: 8,
        actualQty: 7,
        varianceQty: -1,
      }),
    ]);
  });

  it('counts every included serving for a multi-serving sale line', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      count('open', StockCountPhase.OPEN, 10),
    ]);
    prisma.saleLine.findMany.mockResolvedValue([
      saleLine(1, 'cup-id', null, 2),
    ]);

    await expect(service.getForTradingDay(day)).resolves.toEqual([
      expect.objectContaining({ expectedQty: 8 }),
    ]);
    expect(prisma.saleLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          packagingServingsSnapshot: true,
        }),
      }),
    );
  });

  it('multiplies line quantity by the captured servings count', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      count('open', StockCountPhase.OPEN, 10),
    ]);
    prisma.saleLine.findMany.mockResolvedValue([
      saleLine(2, 'cup-id', null, 2),
    ]);

    await expect(service.getForTradingDay(day)).resolves.toEqual([
      expect.objectContaining({ expectedQty: 6 }),
    ]);
  });

  it('keeps ordinary one-serving line arithmetic unchanged', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      count('open', StockCountPhase.OPEN, 10),
    ]);
    prisma.saleLine.findMany.mockResolvedValue([
      saleLine(3, 'cup-id', null, 1),
    ]);

    await expect(service.getForTradingDay(day)).resolves.toEqual([
      expect.objectContaining({ expectedQty: 7 }),
    ]);
  });

  it('preserves genuine recorded zeroes as distinct from null', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      count('open', StockCountPhase.OPEN, 0),
      count('close', StockCountPhase.CLOSE, 0),
    ]);

    await expect(service.getForTradingDay(day)).resolves.toEqual([
      expect.objectContaining({
        expectedQty: 0,
        actualQty: 0,
        varianceQty: 0,
      }),
    ]);
  });

  it('adds deliveries and subtracts wastage', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      count('open', StockCountPhase.OPEN, 10),
      count('close', StockCountPhase.CLOSE, 11),
    ]);
    prisma.stockMovement.findMany.mockResolvedValue([
      {
        inventoryItemId: 'cup-id',
        type: MovementType.DELIVERY,
        quantity: 5,
      },
      {
        inventoryItemId: 'cup-id',
        type: MovementType.WASTAGE,
        quantity: 2,
      },
    ]);

    await expect(service.getForTradingDay(day)).resolves.toEqual([
      expect.objectContaining({
        openingQty: 10,
        deliveriesQty: 5,
        wastageQty: 2,
        soldQty: 0,
        expectedQty: 13,
        actualQty: 11,
        varianceQty: -2,
      }),
    ]);
  });

  it('uses the correction-chain leaf even if the original timestamp is later', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      count('original', StockCountPhase.OPEN, 10, {
        recordedAt: '2026-07-31T10:00:00.000Z',
      }),
      count('correction', StockCountPhase.OPEN, 20, {
        correctsStockCountId: 'original',
        recordedAt: '2026-07-31T09:00:00.000Z',
      }),
    ]);

    await expect(service.getForTradingDay(day)).resolves.toEqual([
      expect.objectContaining({ expectedQty: 20 }),
    ]);
  });

  it('treats an item omitted from the effective corrected count as uncounted', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      count('original', StockCountPhase.OPEN, 10),
      count('correction', StockCountPhase.OPEN, null, {
        correctsStockCountId: 'original',
        includeLine: false,
      }),
    ]);

    await expect(service.getForTradingDay(day)).resolves.toEqual([
      expect.objectContaining({
        expectedQty: null,
        varianceQty: null,
      }),
    ]);
  });

  it('draws down both mapped roles when cup and lid are the same item', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      count('open', StockCountPhase.OPEN, 10),
    ]);
    prisma.saleLine.findMany.mockResolvedValue([
      saleLine(2, 'cup-id', 'cup-id', 2),
    ]);

    await expect(service.getForTradingDay(day)).resolves.toEqual([
      expect.objectContaining({ expectedQty: 2 }),
    ]);
  });

  it('does not let a parked order reduce expected quantity', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      count('open', StockCountPhase.OPEN, 10),
    ]);

    await expect(service.getForTradingDay(day)).resolves.toEqual([
      expect.objectContaining({ expectedQty: 10 }),
    ]);

    expect(prisma.saleLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sale: expect.objectContaining({
            status: OrderStatus.COMPLETED,
          }),
        },
      }),
    );
  });

  it('excludes a voided sale and its correcting VOID row', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      count('open', StockCountPhase.OPEN, 10),
    ]);

    await expect(service.getForTradingDay(day)).resolves.toEqual([
      expect.objectContaining({ expectedQty: 10 }),
    ]);

    expect(prisma.saleLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sale: expect.objectContaining({
            kind: SaleKind.PURCHASE,
            corrections: {
              none: { kind: SaleKind.VOID },
            },
          }),
        },
      }),
    );
  });

  it('limits packaging sales to the supplied trading day', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      count('open', StockCountPhase.OPEN, 10),
    ]);

    await service.getForTradingDay(day);

    expect(prisma.saleLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sale: expect.objectContaining({
            tradingDayId: day.id,
          }),
        },
      }),
    );
  });

  it('limits rows to reconciled quantity items that are active or participated that day', async () => {
    const { prisma, service } = createService();

    await service.getForTradingDay(day);

    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith({
      where: {
        reconciled: true,
        countMethod: CountMethod.QUANTITY,
        OR: [{ active: true }, { id: { in: [] } }],
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    });
  });

  it('includes a since-deactivated item that participated on the selected day', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      count('open', StockCountPhase.OPEN, 10),
    ]);

    await service.getForTradingDay(day);

    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { active: true },
            { id: { in: ['cup-id'] } },
          ],
        }),
      }),
    );
  });

  it('returns no rows after checking day participation when no items qualify', async () => {
    const { prisma, service } = createService();
    prisma.inventoryItem.findMany.mockResolvedValue([]);

    await expect(service.getForTradingDay(day)).resolves.toEqual([]);
    expect(prisma.stockCount.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.stockMovement.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.saleLine.findMany).toHaveBeenCalledTimes(1);
  });
});
