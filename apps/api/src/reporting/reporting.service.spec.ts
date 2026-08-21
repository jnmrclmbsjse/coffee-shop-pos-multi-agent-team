import { BadRequestException } from '@nestjs/common';
import { cents } from '@coffee-shop/shared';
import { OrderStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import {
  assertValidRange,
  averageCents,
  deriveOrderHistoryPaymentMethod,
  deriveOrderHistoryStatus,
  formatCsvMoney,
  ReportingService,
} from './reporting.service';

function createReportingService(prisma: PrismaService): ReportingService {
  return new ReportingService(
    prisma,
    undefined as never,
    undefined as never,
    undefined as never,
  );
}

describe('ReportingService', () => {
  function createPrisma() {
    return {
      tradingDay: {
        findUnique: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(
        async (queries: Promise<unknown>[]) => Promise.all(queries),
      ),
    };
  }

  const closedDay = {
    id: '2012a72f-0eb2-4fd6-8b5f-c2df334343e0',
    businessDate: new Date('2026-07-20T00:00:00.000Z'),
    status: 'CLOSED',
    openingFloatCents: 10_000,
    cashSalesCents: 25_000n,
    onlineSalesCents: 12_500n,
    tipsCents: 1_200n,
    cashInCents: 2_000n,
    cashOutCents: 500n,
    cashExpensesCents: 3_000n,
    outstandingChangeCents: 800n,
    latestCountedCents: 32_700,
    orderCount: 3n,
  } as const;

  it('composes the selected day read model and removes Enough restock rows', async () => {
    const prisma = createPrisma();
    const day = {
      id: 'day-id',
      locationId: null,
      businessDate: new Date('2026-08-15T00:00:00.000Z'),
      dayType: 'NORMAL',
    };
    const tradingDayService = {
      findByBusinessDate: jest.fn().mockResolvedValue(day),
    };
    const packaging = {
      getForTradingDay: jest.fn().mockResolvedValue([
        {
          inventoryItemId: 'cup-id',
          itemName: '12 oz Cup',
          openingQty: 20,
          deliveriesQty: 5,
          wastageQty: 1,
          soldQty: 4,
          expectedQty: 20,
          actualQty: 18,
          varianceQty: -2,
        },
      ]),
    };
    const restock = {
      getStatusForDay: jest.fn().mockResolvedValue({
        businessDay: { businessDate: '2026-08-15' },
        hasCount: true,
        selectedPhase: 'close',
        selectedCountId: 'count-id',
        selectedCountRecordedAt: '2026-08-15T10:00:00.000Z',
        rows: [
          { inventoryItemId: 'low', status: 'LOW' },
          { inventoryItemId: 'enough', status: 'ENOUGH' },
        ],
      }),
    };
    const service = new ReportingService(
      prisma as unknown as PrismaService,
      tradingDayService as never,
      packaging as never,
      restock as never,
    );

    await expect(
      service.getDailyInventory('2026-08-15'),
    ).resolves.toMatchObject({
      businessDate: '2026-08-15',
      locationId: null,
      hasInventoryInformation: true,
      reconciliation: [{ soldQty: 4, varianceQty: -2 }],
      restock: {
        selectedPhase: 'close',
        rows: [{ inventoryItemId: 'low', status: 'LOW' }],
      },
    });
    expect(packaging.getForTradingDay).toHaveBeenCalledWith(day);
    expect(restock.getStatusForDay).toHaveBeenCalledWith(day);
  });

  it('returns a safe empty report when the date has no trading day', async () => {
    const prisma = createPrisma();
    const tradingDayService = {
      findByBusinessDate: jest.fn().mockResolvedValue(null),
      toResponse: jest.fn().mockReturnValue({
        isOpen: false,
        businessDate: null,
      }),
    };
    const packaging = { getForTradingDay: jest.fn() };
    const restock = { getStatusForDay: jest.fn() };
    const service = new ReportingService(
      prisma as unknown as PrismaService,
      tradingDayService as never,
      packaging as never,
      restock as never,
    );

    await expect(
      service.getDailyInventory('2026-08-20'),
    ).resolves.toEqual({
      businessDate: '2026-08-20',
      locationId: null,
      hasInventoryInformation: false,
      reconciliation: [],
      restock: {
        businessDay: { isOpen: false, businessDate: null },
        hasCount: false,
        selectedPhase: null,
        selectedCountId: null,
        selectedCountRecordedAt: null,
        rows: [],
      },
    });
    expect(packaging.getForTradingDay).not.toHaveBeenCalled();
    expect(restock.getStatusForDay).not.toHaveBeenCalled();
  });

  it('builds one range model with integer-cent totals and reconciliation', async () => {
    const prisma = createPrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([closedDay])
      .mockResolvedValueOnce([
        {
          productId: '2f631fdb-27e6-4010-b8d2-bfc7687d67e0',
          productName: 'Latte',
          quantitySold: 4n,
          revenueCents: 37_500n,
        },
      ]);
    const service = createReportingService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.getReport('2026-07-20', '2026-07-20'),
    ).resolves.toEqual({
      from: '2026-07-20',
      to: '2026-07-20',
      totals: {
        grossSalesCents: 37_500,
        cashSalesCents: 25_000,
        onlineSalesCents: 12_500,
        tipsCents: 1_200,
      },
      dailyReconciliation: [
        {
          date: '2026-07-20',
          status: 'closed',
          cashSalesCents: 25_000,
          onlineSalesCents: 12_500,
          grossSalesCents: 37_500,
          tipsCents: 1_200,
          cashInCents: 2_000,
          cashOutCents: 500,
          cashExpensesCents: 3_000,
          outstandingChangeCents: 800,
          expectedCashCents: 35_500,
          actualCashCents: 32_700,
          varianceCents: -2_800,
        },
      ],
      topProducts: [
        {
          productId: '2f631fdb-27e6-4010-b8d2-bfc7687d67e0',
          productName: 'Latte',
          quantitySold: 4,
          revenueCents: 37_500,
        },
      ],
    });
  });

  it('keeps actual cash and variance null for an open day', async () => {
    const prisma = createPrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          ...closedDay,
          status: 'OPEN',
          latestCountedCents: 32_700,
          orderCount: 0n,
        },
      ])
      .mockResolvedValueOnce([]);
    const service = createReportingService(
      prisma as unknown as PrismaService,
    );

    const report = await service.getReport(
      '2026-07-20',
      '2026-07-20',
    );

    expect(report.dailyReconciliation[0]).toEqual(
      expect.objectContaining({
        expectedCashCents: 35_500,
        actualCashCents: null,
        varianceCents: null,
      }),
    );
  });

  it('aggregates signed movement kinds and only unsettled change in SQL', async () => {
    const prisma = createPrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([closedDay])
      .mockResolvedValueOnce([]);
    const service = createReportingService(
      prisma as unknown as PrismaService,
    );

    await service.getReport('2026-07-20', '2026-07-20');

    const dailyQuery = prisma.$queryRaw.mock.calls[0]?.[0] as {
      strings: string[];
    };
    const sql = dailyQuery.strings.join('?');
    expect(sql).toContain('FROM cash_movements AS movement');
    expect(sql).toContain("FILTER (WHERE kind = 'CASH_IN')");
    expect(sql).toContain("FILTER (WHERE kind = 'CASH_OUT')");
    expect(sql).toContain("FILTER (WHERE kind = 'EXPENSE')");
    expect(sql).toContain('WHERE sale.change_settled_at IS NULL');
    expect(sql).not.toContain('ABS(');
    expect(sql).not.toContain('FROM cash_expenses');
  });

  it('returns zero totals and empty collections for a range without days', async () => {
    const prisma = createPrisma();
    prisma.$queryRaw.mockResolvedValue([]);
    const service = createReportingService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.getReport('2026-07-01', '2026-07-02'),
    ).resolves.toEqual({
      from: '2026-07-01',
      to: '2026-07-02',
      totals: {
        grossSalesCents: 0,
        cashSalesCents: 0,
        onlineSalesCents: 0,
        tipsCents: 0,
      },
      dailyReconciliation: [],
      topProducts: [],
    });
  });

  it('uses the Manila 14-date window and an open-day summary', async () => {
    jest.useFakeTimers().setSystemTime(
      new Date('2026-07-25T17:00:00.000Z'),
    );
    const prisma = createPrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([closedDay])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: closedDay.id,
          businessDate: closedDay.businessDate,
        },
      ])
      .mockResolvedValueOnce([closedDay]);
    const service = createReportingService(
      prisma as unknown as PrismaService,
    );

    const dashboard = await service.getDashboard();

    expect(dashboard.summary).toEqual({
      date: '2026-07-20',
      status: 'closed',
      orderCount: 3,
      grossSalesCents: 37_500,
      cashSalesCents: 25_000,
      onlineSalesCents: 12_500,
      averageOrderValueCents: 12_500,
      cashTipsCents: 1_200,
    });
    expect(dashboard.salesTrend).toEqual([
      {
        date: '2026-07-20',
        cashSalesCents: 25_000,
        onlineSalesCents: 12_500,
      },
    ]);
    const firstQuery = prisma.$queryRaw.mock.calls[0]![0] as {
      values: unknown[];
    };
    expect(firstQuery.values).toEqual([
      '2026-07-13',
      '2026-07-26',
    ]);
    jest.useRealTimers();
  });

  it('returns an absent dashboard summary when no trading day exists', async () => {
    const prisma = createPrisma();
    prisma.$queryRaw.mockResolvedValue([]);
    const service = createReportingService(
      prisma as unknown as PrismaService,
    );

    await expect(service.getDashboard()).resolves.toEqual(
      expect.objectContaining({ summary: null }),
    );
  });

  it('renders the exact CSV columns, nulls, zeroes, and negatives', () => {
    const service = createReportingService(
      createPrisma() as unknown as PrismaService,
    );

    const csv = service.toCsv({
      from: '2026-07-20',
      to: '2026-07-20',
      totals: {
        grossSalesCents: cents(0),
        cashSalesCents: cents(0),
        onlineSalesCents: cents(0),
        tipsCents: cents(0),
      },
      topProducts: [],
      dailyReconciliation: [
        {
          date: '2026-07-20',
          status: 'open',
          cashSalesCents: cents(0),
          onlineSalesCents: cents(1),
          grossSalesCents: cents(-50),
          tipsCents: cents(105),
          cashInCents: cents(-25),
          cashOutCents: cents(250),
          cashExpensesCents: cents(10_000),
          outstandingChangeCents: cents(75),
          expectedCashCents: cents(-8_944),
          actualCashCents: null,
          varianceCents: null,
        },
      ],
    });

    expect(csv).toBe(
      'Date,Status,Cash sales,Online sales,Gross,Tips,Cash in,Cash out,Cash expenses,Outstanding change,Expected cash,Actual cash,Variance\r\n' +
        '2026-07-20,open,0.00,0.01,-0.50,1.05,-0.25,2.50,100.00,0.75,-89.44,,\r\n',
    );
  });
});

describe('order history read model', () => {
  function createPrisma() {
    return {
      tradingDay: {
        findUnique: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(
        async (queries: Promise<unknown>[]) => Promise.all(queries),
      ),
    };
  }

  const baseOrder = {
    id: 'b70f5635-4c68-444e-b659-9c087d36268c',
    clientGeneratedId: '5dd5ac08-eb2b-43b8-ac52-50e61e58a83f',
    businessDay: new Date('2026-07-20T00:00:00.000Z'),
    dayOrderNumber: 4,
    storedStatus: OrderStatus.COMPLETED,
    customerName: 'Mina Santos',
    cashierNameSnapshot: 'Original Cashier Name',
    serviceType: 'DINE_IN',
    subtotalCents: 20_000,
    discountCents: 0,
    totalCents: 20_000,
    cashTipCents: 1_000,
    cashReceivedCents: 8_000,
    changeOwedCents: 0,
    changeSettledAt: null,
    completedAt: new Date('2026-07-20T06:00:00.000Z'),
    hasCorrection: false,
    voidReason: null,
    hasCash: true,
    hasOnline: true,
    cashPortionCents: 8_000n,
    onlinePortionCents: 12_000n,
  } as const;

  it('derives void status from a correcting row, never the stored status', () => {
    expect(
      deriveOrderHistoryStatus(OrderStatus.COMPLETED, true),
    ).toBe('Void');
    expect(
      deriveOrderHistoryStatus(OrderStatus.PARKED, false),
    ).toBe('Parked');
    expect(
      deriveOrderHistoryStatus(OrderStatus.COMPLETED, false),
    ).toBe('Completed');
  });

  it('derives split, cash, online, and parked payment methods', () => {
    expect(deriveOrderHistoryPaymentMethod(true, true)).toBe('Split');
    expect(deriveOrderHistoryPaymentMethod(true, false)).toBe('Cash');
    expect(deriveOrderHistoryPaymentMethod(false, true)).toBe('Online');
    expect(deriveOrderHistoryPaymentMethod(false, false)).toBeNull();
  });

  it('keeps walk-in customer names null and maps stored list money', async () => {
    const prisma = createPrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ count: 1n }])
      .mockResolvedValueOnce([
        {
          ...baseOrder,
          customerName: null,
        },
      ]);
    const service = createReportingService(
      prisma as unknown as PrismaService,
    );

    await expect(service.getOrderHistory({})).resolves.toEqual({
      items: [
        {
          id: baseOrder.id,
          businessDay: '2026-07-20',
          dayOrderNumber: 4,
          customerName: null,
          status: 'Completed',
          paymentMethod: 'Split',
          totalCents: 20_000,
          tipCents: 1_000,
          changeOwedCents: 0,
          changeSettled: true,
          completedAt: '2026-07-20T06:00:00.000Z',
        },
      ],
      page: 1,
      pageSize: 10,
      totalItems: 1,
      totalPages: 1,
    });
  });

  it('pushes combined derived filters and case-insensitive search into SQL', async () => {
    const prisma = createPrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ count: 0n }])
      .mockResolvedValueOnce([]);
    const service = createReportingService(
      prisma as unknown as PrismaService,
    );

    await service.getOrderHistory({
      status: 'Void',
      paymentMethod: 'Split',
      search: 'mInA',
    });

    const query = prisma.$queryRaw.mock.calls[1]![0] as {
      strings: readonly string[];
      values: readonly unknown[];
    };
    const sql = query.strings.join('?');
    expect(sql).toContain(
      'WHERE has_correction AND has_cash AND has_online AND customer_name ILIKE ?',
    );
    expect(query.values).toContain('%mInA%');
  });

  it('returns correct page-boundary metadata and an empty result', async () => {
    const prisma = createPrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([{ count: 6n }])
      .mockResolvedValueOnce([baseOrder])
      .mockResolvedValueOnce([{ count: 0n }])
      .mockResolvedValueOnce([]);
    const service = createReportingService(
      prisma as unknown as PrismaService,
    );

    const lastPage = await service.getOrderHistory({
      page: 2,
      pageSize: 5,
    });
    expect(lastPage).toEqual(
      expect.objectContaining({
        page: 2,
        pageSize: 5,
        totalItems: 6,
        totalPages: 2,
      }),
    );
    expect(lastPage.items).toHaveLength(1);

    await expect(
      service.getOrderHistory({ page: 1, pageSize: 25 }),
    ).resolves.toEqual({
      items: [],
      page: 1,
      pageSize: 25,
      totalItems: 0,
      totalPages: 0,
    });
  });

  it('returns one detail read with stored split portions and line values', async () => {
    const prisma = createPrisma();
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        ...baseOrder,
        cashReceivedCents: 7_500,
        lines: [
          {
            id: 'fdf3f40f-56e3-4b76-a70f-34670507a1f5',
            productName: 'Fixture Latte',
            size: 'Regular',
            quantity: 2,
            discountKind: 'SENIOR',
            discountCents: 5_000,
            lineTotalCents: 20_000,
          },
        ],
      },
    ]);
    const service = createReportingService(
      prisma as unknown as PrismaService,
    );

    const detail = await service.getOrderHistoryDetail(baseOrder.id);

    expect(detail).toEqual(
      expect.objectContaining({
        status: 'Completed',
        serviceType: 'DINE_IN',
        paymentMethod: 'Split',
        totalCents: 20_000,
        cashPortionCents: 8_000,
        onlinePortionCents: 12_000,
        cashReceivedCents: 7_500,
      }),
    );
    expect(
      detail.cashPortionCents! + detail.onlinePortionCents!,
    ).toBe(detail.totalCents);
    expect(detail.lines).toEqual([
      {
        id: 'fdf3f40f-56e3-4b76-a70f-34670507a1f5',
        productName: 'Fixture Latte',
        size: 'Regular',
        quantity: 2,
        discountKind: 'SENIOR',
        discountCents: 5_000,
        lineTotalCents: 20_000,
      },
    ]);
  });

  it('returns the correcting reason and stored completion for a void', async () => {
    const prisma = createPrisma();
    prisma.$queryRaw.mockResolvedValueOnce([
      {
        ...baseOrder,
        hasCorrection: true,
        voidReason: 'Duplicate order',
        lines: [],
      },
    ]);
    const service = createReportingService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.getOrderHistoryDetail(baseOrder.id),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'Void',
        completedAt: '2026-07-20T06:00:00.000Z',
        voidReason: 'Duplicate order',
      }),
    );
  });

  it('returns the complete staff card projection in one day-scoped query', async () => {
    const prisma = createPrisma();
    prisma.tradingDay.findUnique.mockResolvedValue({ id: 'day-id' });
    prisma.$queryRaw.mockResolvedValue([
      {
        ...baseOrder,
        customerName: null,
        cashierNameSnapshot: null,
        changeOwedCents: 3_000,
        changeSettledAt: new Date('2026-07-20T06:30:00.000Z'),
        lines: [
          {
            id: 'fdf3f40f-56e3-4b76-a70f-34670507a1f5',
            productName: 'Fixture Latte',
            size: 'Regular',
            quantity: 2,
            discountKind: 'SENIOR',
            discountCents: 5_000,
            lineTotalCents: 20_000,
          },
        ],
      },
    ]);
    const service = createReportingService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.getStaffOrderLedger('day-id', {}),
    ).resolves.toEqual({
      businessDayId: 'day-id',
      orders: [
        {
          id: baseOrder.id,
          clientGeneratedId: baseOrder.clientGeneratedId,
          dayOrderNumber: 4,
          customerName: null,
          cashierName: null,
          status: 'Completed',
          paymentMethod: 'Split',
          completedAt: '2026-07-20T06:00:00.000Z',
          totalCents: 20_000,
          lines: [
            {
              id: 'fdf3f40f-56e3-4b76-a70f-34670507a1f5',
              productName: 'Fixture Latte',
              size: 'Regular',
              quantity: 2,
              discountKind: 'SENIOR',
              discountCents: 5_000,
              lineTotalCents: 20_000,
            },
          ],
          cashPortionCents: 8_000,
          onlinePortionCents: 12_000,
          cashReceivedCents: 8_000,
          expectedChangeCents: 0,
          voidReason: null,
          changeOwedCents: 3_000,
          changeSettled: true,
          changeSettledAt: '2026-07-20T06:30:00.000Z',
        },
      ],
    });

    const sql = (
      prisma.$queryRaw.mock.calls[0]![0] as { strings: string[] }
    ).strings.join('?');
    expect(sql).toContain('sale.trading_day_id = ?::uuid');
    expect(sql).toContain(
      'ORDER BY history.day_order_number DESC, history.id ASC',
    );
  });

  it.each([
    {
      name: 'exact cash',
      row: {},
      expected: { cashReceivedCents: 8_000, expectedChangeCents: 0 },
    },
    {
      name: 'cash with change',
      row: { cashReceivedCents: 9_000 },
      expected: { cashReceivedCents: 9_000, expectedChangeCents: 1_000 },
    },
    {
      name: 'online only',
      row: {
        hasCash: false,
        hasOnline: true,
        cashReceivedCents: null,
      },
      expected: { cashReceivedCents: null, expectedChangeCents: null },
    },
    {
      name: 'split payment using only its cash portion',
      row: { cashReceivedCents: 10_000 },
      expected: { cashReceivedCents: 10_000, expectedChangeCents: 2_000 },
    },
    {
      name: 'parked order',
      row: {
        storedStatus: OrderStatus.PARKED,
        cashReceivedCents: 9_000,
      },
      expected: { cashReceivedCents: null, expectedChangeCents: null },
    },
    {
      name: 'cash payment without recorded cash received',
      row: { cashReceivedCents: null },
      expected: { cashReceivedCents: null, expectedChangeCents: null },
    },
    {
      name: 'legacy cash received without a cash payment portion',
      row: { hasCash: false, cashReceivedCents: 7_500 },
      expected: { cashReceivedCents: 7_500, expectedChangeCents: null },
    },
    {
      name: 'legacy under-received cash',
      row: { cashReceivedCents: 7_500 },
      expected: { cashReceivedCents: 7_500, expectedChangeCents: -500 },
    },
  ])(
    'maps $name without collapsing null or signed values',
    async ({ row, expected }) => {
      const prisma = createPrisma();
      prisma.tradingDay.findUnique.mockResolvedValue({ id: 'day-id' });
      prisma.$queryRaw.mockResolvedValue([
        { ...baseOrder, lines: [], ...row },
      ]);
      const service = createReportingService(
        prisma as unknown as PrismaService,
      );

      const ledger = await service.getStaffOrderLedger('day-id', {});

      expect(ledger.orders[0]).toEqual(expect.objectContaining(expected));
    },
  );

  it.each([
    [{ status: 'Completed' }, "stored_status = 'COMPLETED'"],
    [{ status: 'Parked' }, "stored_status = 'PARKED'"],
    [{ status: 'Void' }, 'WHERE has_correction'],
    [{ paymentMethod: 'Cash' }, 'has_cash AND NOT has_online'],
    [{ paymentMethod: 'Online' }, 'has_online AND NOT has_cash'],
    [{ paymentMethod: 'Split' }, 'has_cash AND has_online'],
  ] as const)('applies staff ledger filter %#', async (query, expectedSql) => {
    const prisma = createPrisma();
    prisma.tradingDay.findUnique.mockResolvedValue({ id: 'day-id' });
    prisma.$queryRaw.mockResolvedValue([]);
    const service = createReportingService(
      prisma as unknown as PrismaService,
    );

    await service.getStaffOrderLedger('day-id', query);

    const sql = (
      prisma.$queryRaw.mock.calls[0]![0] as { strings: string[] }
    ).strings.join('?');
    expect(sql).toContain(expectedSql);
  });

  it('matches only the exact Walk-in search to null customer names', async () => {
    const prisma = createPrisma();
    prisma.tradingDay.findUnique.mockResolvedValue({ id: 'day-id' });
    prisma.$queryRaw.mockResolvedValue([]);
    const service = createReportingService(
      prisma as unknown as PrismaService,
    );

    await service.getStaffOrderLedger('day-id', { search: 'Walk-in' });
    await service.getStaffOrderLedger('day-id', { search: 'walk' });

    const exactSql = (
      prisma.$queryRaw.mock.calls[0]![0] as { strings: string[] }
    ).strings.join('?');
    const partialSql = (
      prisma.$queryRaw.mock.calls[1]![0] as { strings: string[] }
    ).strings.join('?');
    expect(exactSql).toContain('OR customer_name IS NULL');
    expect(partialSql).not.toContain('customer_name IS NULL');
  });

  it('rejects an unknown business day before querying orders', async () => {
    const prisma = createPrisma();
    prisma.tradingDay.findUnique.mockResolvedValue(null);
    const service = createReportingService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.getStaffOrderLedger('unknown-day', {}),
    ).rejects.toThrow('Business day not found');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('reporting value rules', () => {
  it('rounds AOV to nearest cent with exact half cents rounded up', () => {
    expect(averageCents(cents(100), 3)).toBe(33);
    expect(averageCents(cents(101), 2)).toBe(51);
    expect(averageCents(cents(-101), 2)).toBe(-50);
    expect(averageCents(cents(999), 0)).toBe(0);
  });

  it('formats cents without floating-point conversion', () => {
    expect(formatCsvMoney(cents(12_345_678))).toBe('123456.78');
    expect(formatCsvMoney(cents(-5))).toBe('-0.05');
  });

  it('rejects malformed, impossible, and inverted ranges', () => {
    expect(() => assertValidRange('2026-02-30', '2026-03-01')).toThrow(
      BadRequestException,
    );
    expect(() => assertValidRange('07/20/2026', '2026-07-21')).toThrow(
      BadRequestException,
    );
    expect(() => assertValidRange('2026-07-21', '2026-07-20')).toThrow(
      new BadRequestException('from must be on or before to'),
    );
  });
});
