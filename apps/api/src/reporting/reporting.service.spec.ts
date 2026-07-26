import { BadRequestException } from '@nestjs/common';
import { cents } from '@coffee-shop/shared';
import type { PrismaService } from '../prisma/prisma.service';
import {
  assertValidRange,
  averageCents,
  formatCsvMoney,
  ReportingService,
} from './reporting.service';

describe('ReportingService', () => {
  function createPrisma() {
    return {
      $queryRaw: jest.fn(),
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
