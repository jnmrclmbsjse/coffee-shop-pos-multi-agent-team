import {
  CountMethod,
  DayType,
  StockCountPhase,
  StockLevel,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  OpenTradingDay,
  TradingDayService,
} from '../trading-day/trading-day.service';
import {
  levelRestockStatus,
  quantityRestockStatus,
  RestockService,
} from './restock.service';

describe('restock status classification', () => {
  it('evaluates all quantity bands in priority order', () => {
    const bands = {
      parQty: 10,
      lowThreshold: 5,
      urgentThreshold: 2,
    };

    expect(quantityRestockStatus(2, bands)).toBe('URGENT');
    expect(quantityRestockStatus(5, bands)).toBe('LOW');
    expect(quantityRestockStatus(9, bands)).toBe('BELOW_PAR');
    expect(quantityRestockStatus(10, bands)).toBe('ENOUGH');
  });

  it('skips either null threshold instead of matching it', () => {
    expect(
      quantityRestockStatus(1, {
        parQty: 10,
        lowThreshold: 4,
        urgentThreshold: null,
      }),
    ).toBe('LOW');
    expect(
      quantityRestockStatus(1, {
        parQty: 10,
        lowThreshold: null,
        urgentThreshold: null,
      }),
    ).toBe('BELOW_PAR');
    expect(quantityRestockStatus(0, null)).toBe('ENOUGH');
  });

  it('uses configured thresholds even when no par target applies', () => {
    const bands = {
      parQty: null,
      lowThreshold: 5,
      urgentThreshold: 2,
    };

    expect(quantityRestockStatus(2, bands)).toBe('URGENT');
    expect(quantityRestockStatus(5, bands)).toBe('LOW');
    expect(quantityRestockStatus(6, bands)).toBe('ENOUGH');
  });

  it('maps all eight stock levels to their specified bands', () => {
    expect(
      Object.fromEntries(
        Object.values(StockLevel).map((level) => [
          level,
          levelRestockStatus(level),
        ]),
      ),
    ).toEqual({
      EMPTY: 'URGENT',
      LOW: 'URGENT',
      QUARTER: 'LOW',
      ONE_THIRD: 'LOW',
      HALF: 'BELOW_PAR',
      TWO_THIRDS: 'BELOW_PAR',
      THREE_QUARTERS: 'ENOUGH',
      FULL: 'ENOUGH',
    });
  });
});

describe('RestockService', () => {
  const openDay: OpenTradingDay = {
    id: 'day-id',
    locationId: null,
    businessDate: new Date('2026-07-23T00:00:00.000Z'),
    dayType: DayType.NORMAL,
    openingFloatCents: 50000,
    openedAt: new Date('2026-07-23T00:00:00.000Z'),
    openedByStaffMember: { displayName: 'Staff Member' },
  };

  function createPrisma() {
    return {
      stockCount: {
        findMany: jest.fn(),
      },
    };
  }

  function tradingDay(day: OpenTradingDay | null = openDay) {
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
      service: new RestockService(
        prisma as unknown as PrismaService,
        tradingDay(day) as unknown as TradingDayService,
      ),
    };
  }

  function quantityLine(
    id: string,
    name: string,
    quantity: number,
    critical: boolean,
    parQty: number | null = 10,
  ) {
    return {
      id: `line-${id}`,
      stockCountId: 'count-id',
      inventoryItemId: id,
      quantity,
      level: null,
      inventoryItem: {
        id,
        sku: id,
        name,
        categoryId: 'category-id',
        unit: 'pcs',
        size: null,
        countMethod: CountMethod.QUANTITY,
        critical,
        reconciled: false,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        parLevels: [
          {
            id: `par-${id}`,
            inventoryItemId: id,
            dayType: DayType.NORMAL,
            parQty,
            parLevel: null,
            lowThreshold: 5,
            urgentThreshold: 2,
          },
        ],
      },
    };
  }

  function levelLine(
    id: string,
    name: string,
    level: StockLevel,
    savedParLevel: StockLevel,
  ) {
    return {
      id: `line-${id}`,
      stockCountId: 'count-id',
      inventoryItemId: id,
      quantity: null,
      level,
      inventoryItem: {
        id,
        sku: id,
        name,
        categoryId: 'category-id',
        unit: 'pcs',
        size: null,
        countMethod: CountMethod.LEVEL,
        critical: false,
        reconciled: false,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        parLevels: [
          {
            id: `par-${id}`,
            inventoryItemId: id,
            dayType: DayType.NORMAL,
            parQty: null,
            parLevel: savedParLevel,
            lowThreshold: null,
            urgentThreshold: null,
          },
        ],
      },
    };
  }

  function countRecord(
    phase: StockCountPhase,
    lines: Array<
      ReturnType<typeof quantityLine> | ReturnType<typeof levelLine>
    > = [quantityLine('item-id', 'Beans', 4, true)],
  ) {
    return {
      id: `${phase.toLowerCase()}-count`,
      locationId: null,
      businessDate: openDay.businessDate,
      phase,
      recordedAt: new Date('2026-07-23T08:00:00.000Z'),
      submittedByStaffMemberId: 'staff-id',
      submittedByNameSnapshot: 'Alex',
      shiftLeadStaffMemberId: null,
      shiftLeadNameSnapshot: null,
      correctsStockCountId: null,
      lines,
    };
  }

  it('selects the latest closing correction before considering opening', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      countRecord(StockCountPhase.OPEN),
      countRecord(StockCountPhase.CLOSE),
    ]);

    const result = await service.getStatus();

    expect(result.selectedPhase).toBe('close');
    expect(prisma.stockCount.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.stockCount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          phase: {
            in: [StockCountPhase.OPEN, StockCountPhase.CLOSE],
          },
        }),
      }),
    );
  });

  it('falls back to the latest opening count', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      countRecord(StockCountPhase.OPEN),
    ]);

    const result = await service.getStatus();

    expect(result.selectedPhase).toBe('open');
    expect(prisma.stockCount.findMany).toHaveBeenCalledTimes(1);
  });

  it('sorts by status, critical flag, then item name', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      countRecord(StockCountPhase.CLOSE, [
        quantityLine('enough', 'Zulu', 10, false),
        quantityLine('low-b', 'Beans', 4, false),
        quantityLine('urgent-n', 'Nuts', 1, false),
        quantityLine('low-a', 'Apples', 4, true),
        quantityLine('urgent-c', 'Cups', 1, true),
      ]),
    ]);

    const result = await service.getStatus();

    expect(result.rows.map((row) => row.inventoryItemId)).toEqual([
      'urgent-c',
      'urgent-n',
      'low-a',
      'low-b',
      'enough',
    ]);
  });

  it('ignores a saved level par and keeps the fixed level status mapping', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      countRecord(StockCountPhase.CLOSE, [
        levelLine(
          'level-item',
          'Milk',
          StockLevel.QUARTER,
          StockLevel.FULL,
        ),
      ]),
    ]);

    await expect(service.getStatus()).resolves.toMatchObject({
      rows: [
        {
          inventoryItemId: 'level-item',
          level: StockLevel.QUARTER,
          par: null,
          status: 'LOW',
        },
      ],
    });
  });

  it('returns an unavailable target while retaining threshold urgency', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([
      countRecord(StockCountPhase.CLOSE, [
        quantityLine('threshold-only', 'Cups', 1, true, null),
      ]),
    ]);

    await expect(service.getStatus()).resolves.toMatchObject({
      rows: [
        {
          inventoryItemId: 'threshold-only',
          quantity: 1,
          par: null,
          status: 'URGENT',
        },
      ],
    });
  });

  it('returns an explicit no-count result', async () => {
    const { prisma, service } = createService();
    prisma.stockCount.findMany.mockResolvedValue([]);

    await expect(service.getStatus()).resolves.toMatchObject({
      businessDay: {
        isOpen: true,
        businessDate: '2026-07-23',
      },
      hasCount: false,
      selectedPhase: null,
      rows: [],
    });
  });

  it('returns an explicit no-open-day result without reading counts', async () => {
    const { prisma, service } = createService(null);

    await expect(service.getStatus()).resolves.toEqual({
      businessDay: {
        isOpen: false,
        businessDate: null,
        dayType: null,
      },
      hasCount: false,
      selectedPhase: null,
      selectedCountId: null,
      selectedCountRecordedAt: null,
      rows: [],
    });
    expect(prisma.stockCount.findMany).not.toHaveBeenCalled();
  });

  it('uses an out-of-order correction leaf for the restock count', async () => {
    const { prisma, service } = createService();
    const original = {
      ...countRecord(StockCountPhase.CLOSE, [
        quantityLine('item-id', 'Beans', 9, true),
      ]),
      id: 'original',
      recordedAt: new Date('2026-07-23T10:00:00.000Z'),
    };
    const correction = {
      ...countRecord(StockCountPhase.CLOSE, [
        quantityLine('item-id', 'Beans', 1, true),
      ]),
      id: 'correction',
      correctsStockCountId: 'original',
      recordedAt: new Date('2026-07-23T09:00:00.000Z'),
    };
    prisma.stockCount.findMany.mockResolvedValue([original, correction]);

    await expect(service.getStatusForDay(openDay)).resolves.toMatchObject({
      selectedCountId: 'correction',
      rows: [{ quantity: 1, status: 'URGENT' }],
    });
  });
});
