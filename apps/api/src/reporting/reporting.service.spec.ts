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

describe('ReportingService', () => {
  function createPrisma() {
    return {
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
    cashExpensesCents: 3_000n,
    latestCountedCents: 32_700,
    orderCount: 3n,
  } as const;

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
    const service = new ReportingService(
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
          cashExpensesCents: 3_000,
          expectedCashCents: 33_200,
          actualCashCents: 32_700,
          varianceCents: -500,
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
    const service = new ReportingService(
      prisma as unknown as PrismaService,
    );

    const report = await service.getReport(
      '2026-07-20',
      '2026-07-20',
    );

    expect(report.dailyReconciliation[0]).toEqual(
      expect.objectContaining({
        expectedCashCents: 33_200,
        actualCashCents: null,
        varianceCents: null,
      }),
    );
  });

  it('aggregates expenses only from EXPENSE cash movements', async () => {
    const prisma = createPrisma();
    prisma.$queryRaw
      .mockResolvedValueOnce([closedDay])
      .mockResolvedValueOnce([]);
    const service = new ReportingService(
      prisma as unknown as PrismaService,
    );

    await service.getReport('2026-07-20', '2026-07-20');

    const dailyQuery = prisma.$queryRaw.mock.calls[0]?.[0] as {
      strings: string[];
    };
    const sql = dailyQuery.strings.join('?');
    expect(sql).toContain('FROM cash_movements AS expense');
    expect(sql).toContain("WHERE expense.kind = 'EXPENSE'");
    expect(sql).not.toContain('FROM cash_expenses');
  });

  it('returns zero totals and empty collections for a range without days', async () => {
    const prisma = createPrisma();
    prisma.$queryRaw.mockResolvedValue([]);
    const service = new ReportingService(
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
    const service = new ReportingService(
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
    const service = new ReportingService(
      prisma as unknown as PrismaService,
    );

    await expect(service.getDashboard()).resolves.toEqual(
      expect.objectContaining({ summary: null }),
    );
  });

  it('renders the exact CSV columns, nulls, zeroes, and negatives', () => {
    const service = new ReportingService(
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
          cashExpensesCents: cents(10_000),
          expectedCashCents: cents(-8_944),
          actualCashCents: null,
          varianceCents: null,
        },
      ],
    });

    expect(csv).toBe(
      'Date,Status,Cash sales,Online sales,Gross,Tips,Cash expenses,Expected cash,Actual cash,Variance\r\n' +
        '2026-07-20,open,0.00,0.01,-0.50,1.05,100.00,-89.44,,\r\n',
    );
  });
});

describe('order history read model', () => {
  function createPrisma() {
    return {
      $queryRaw: jest.fn(),
      $transaction: jest.fn(
        async (queries: Promise<unknown>[]) => Promise.all(queries),
      ),
    };
  }

  const baseOrder = {
    id: 'b70f5635-4c68-444e-b659-9c087d36268c',
    businessDay: new Date('2026-07-20T00:00:00.000Z'),
    dayOrderNumber: 4,
    storedStatus: OrderStatus.COMPLETED,
    customerName: 'Mina Santos',
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
    const service = new ReportingService(
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
    const service = new ReportingService(
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
    const service = new ReportingService(
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
            lineTotalCents: 20_000,
          },
        ],
      },
    ]);
    const service = new ReportingService(
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
    const service = new ReportingService(
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
