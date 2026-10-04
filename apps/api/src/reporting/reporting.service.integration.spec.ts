import { randomUUID } from 'node:crypto';
import { ServiceType as SharedServiceType } from '@coffee-shop/shared';
import {
  CashMovementKind,
  DayType,
  LineDiscountKind,
  OrderStatus,
  PaymentMethod,
  Prisma,
  SaleKind,
  ServiceType,
  TradingDayStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { PackagingReconciliationService } from '../inventory/packaging-reconciliation.service';
import { TradingDayService } from '../trading-day/trading-day.service';
import { ReportingService } from './reporting.service';

function createReportingService(prisma: PrismaService): ReportingService {
  return new ReportingService(
    prisma,
    undefined as never,
    undefined as never,
    undefined as never,
  );
}

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase('Daily reconciliation queries against Postgres', () => {
  const staffMemberId = randomUUID();
  const tradingDayId = randomUUID();
  const cashSaleId = randomUUID();
  const settledOnlineSaleId = randomUUID();
  const movementIds = Array.from({ length: 5 }, () => randomUUID());
  const cashCountId = randomUUID();
  let prisma: PrismaService;
  let service: ReportingService;

  beforeAll(async () => {
    prisma = new PrismaService({
      datasources: {
        db: { url: testDatabaseUrl },
      },
    });
    await prisma.$connect();
    service = createReportingService(prisma);

    await prisma.staffMember.create({
      data: {
        id: staffMemberId,
        displayName: 'Daily reconciliation integration test',
      },
    });
    await prisma.tradingDay.create({
      data: {
        id: tradingDayId,
        businessDate: new Date('2026-07-22T00:00:00.000Z'),
        status: TradingDayStatus.CLOSED,
        openedAt: new Date('2026-07-22T00:00:00.000Z'),
        closedAt: new Date('2026-07-22T12:00:00.000Z'),
        openingFloatCents: 10_000,
        openedByStaffMemberId: staffMemberId,
        closedByStaffMemberId: staffMemberId,
      },
    });
    await prisma.sale.createMany({
      data: [
        {
          ...completedOrder(
            cashSaleId,
            tradingDayId,
            1,
            'Unsettled change sale',
          ),
          totalCents: 20_000,
          subtotalCents: 20_000,
          cashTipCents: 1_000,
          changeOwedCents: 300,
        },
        {
          ...completedOrder(
            settledOnlineSaleId,
            tradingDayId,
            2,
            'Settled change sale',
          ),
          totalCents: 7_000,
          subtotalCents: 7_000,
          changeOwedCents: 400,
          changeSettledAt: new Date('2026-07-22T08:00:00.000Z'),
        },
      ],
    });
    await prisma.salePayment.createMany({
      data: [
        {
          saleId: cashSaleId,
          method: PaymentMethod.CASH,
          amountCents: 20_000,
        },
        {
          saleId: settledOnlineSaleId,
          method: PaymentMethod.ONLINE,
          amountCents: 7_000,
        },
      ],
    });
    await prisma.cashMovement.createMany({
      data: [
        {
          id: movementIds[0],
          tradingDayId,
          kind: CashMovementKind.CASH_IN,
          amountCents: 5_000,
          description: 'Cash added',
        },
        {
          id: movementIds[1],
          tradingDayId,
          amendsCashMovementId: movementIds[0],
          kind: CashMovementKind.CASH_IN,
          amountCents: 4_000,
          description: 'Correct cash added',
        },
        {
          id: movementIds[2],
          tradingDayId,
          kind: CashMovementKind.CASH_OUT,
          amountCents: 2_500,
          description: 'Cash removed',
        },
        {
          id: movementIds[3],
          tradingDayId,
          kind: CashMovementKind.EXPENSE,
          amountCents: 750,
          description: 'Supplies',
        },
        {
          id: movementIds[4],
          tradingDayId,
          amendsCashMovementId: movementIds[3],
          kind: CashMovementKind.EXPENSE,
          amountCents: 500,
          description: 'Correct supplies',
        },
      ],
    });
    await prisma.cashCount.create({
      data: {
        id: cashCountId,
        tradingDayId,
        countedCents: 32_000,
        countedAt: new Date('2026-07-22T12:00:00.000Z'),
        countedByStaffMemberId: staffMemberId,
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.salePayment.deleteMany({
      where: { saleId: { in: [cashSaleId, settledOnlineSaleId] } },
    });
    await prisma.cashCount.deleteMany({ where: { id: cashCountId } });
    await prisma.cashMovement.deleteMany({
      where: { id: { in: movementIds } },
    });
    await prisma.sale.deleteMany({
      where: { id: { in: [cashSaleId, settledOnlineSaleId] } },
    });
    await prisma.tradingDay.delete({ where: { id: tradingDayId } });
    await prisma.staffMember.delete({ where: { id: staffMemberId } });
    await prisma.$disconnect();
  });

  it('returns effective movement totals and only unsettled change', async () => {
    const report = await service.getReport('2026-07-22', '2026-07-22');

    expect(report.dailyReconciliation).toEqual([
      {
        tradingDayId,
        date: '2026-07-22',
        status: 'closed',
        openingFloatCents: 10_000,
        cashSalesCents: 20_000,
        onlineSalesCents: 7_000,
        grossSalesCents: 27_000,
        tipsCents: 1_000,
        cashInCents: 4_000,
        cashOutCents: 2_500,
        cashExpensesCents: 500,
        outstandingChangeCents: 300,
        expectedCashCents: 32_300,
        actualCashCents: 32_000,
        varianceCents: -300,
      },
    ]);
  });

  it('uses the same effective expense total as daily reconciliation', async () => {
    const [expenseReport, salesReport] = await Promise.all([
      service.getExpenseReport('2026-07-22', '2026-07-22'),
      service.getReport('2026-07-22', '2026-07-22'),
    ]);

    expect(expenseReport.items).toEqual([
      expect.objectContaining({
        id: movementIds[4],
        category: null,
        description: 'Correct supplies',
        amountCents: 500,
        amended: true,
      }),
    ]);
    expect(expenseReport.byCategory).toEqual([
      { category: null, entryCount: 1, totalCents: 500 },
    ]);
    expect(expenseReport.totalCents).toBe(
      salesReport.dailyReconciliation.reduce(
        (total, day) => total + day.cashExpensesCents,
        0,
      ),
    );
  });
});

describeWithDatabase('Daily reconciliation ordering against Postgres', () => {
  const staffMemberId = randomUUID();
  const tradingDays = [
    {
      id: '10000000-0000-4000-8000-000000000001',
      businessDate: new Date('2097-01-01T00:00:00.000Z'),
      openedAt: new Date('2097-01-01T08:00:00.000Z'),
      openingFloatCents: 100,
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      businessDate: new Date('2097-01-02T00:00:00.000Z'),
      openedAt: new Date('2097-01-02T08:00:00.000Z'),
      openingFloatCents: 200,
    },
    {
      id: '10000000-0000-4000-8000-000000000003',
      businessDate: new Date('2097-01-02T00:00:00.000Z'),
      openedAt: new Date('2097-01-02T09:00:00.000Z'),
      openingFloatCents: 300,
    },
    {
      id: '10000000-0000-4000-8000-000000000004',
      businessDate: new Date('2097-01-02T00:00:00.000Z'),
      openedAt: new Date('2097-01-02T09:00:00.000Z'),
      openingFloatCents: 400,
    },
  ] as const;
  let prisma: PrismaService;
  let service: ReportingService;

  beforeAll(async () => {
    prisma = new PrismaService({
      datasources: {
        db: { url: testDatabaseUrl },
      },
    });
    await prisma.$connect();
    service = createReportingService(prisma);

    await prisma.staffMember.create({
      data: {
        id: staffMemberId,
        displayName: 'Daily reconciliation ordering integration test',
      },
    });
    await prisma.tradingDay.createMany({
      data: tradingDays.map((day) => ({
        ...day,
        status: TradingDayStatus.CLOSED,
        closedAt: new Date('2097-01-02T12:00:00.000Z'),
        openedByStaffMemberId: staffMemberId,
        closedByStaffMemberId: staffMemberId,
      })),
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.tradingDay.deleteMany({
      where: { id: { in: tradingDays.map((day) => day.id) } },
    });
    await prisma.staffMember.delete({ where: { id: staffMemberId } });
    await prisma.$disconnect();
  });

  it('orders the API newest-first with opened-at and id tie-breaks', async () => {
    const report = await service.getReport('2097-01-01', '2097-01-02');

    expect(
      report.dailyReconciliation.map((day) => ({
        tradingDayId: day.tradingDayId,
        date: day.date,
        openingFloatCents: day.openingFloatCents,
      })),
    ).toEqual([
      {
        tradingDayId: tradingDays[3].id,
        date: '2097-01-02',
        openingFloatCents: 400,
      },
      {
        tradingDayId: tradingDays[2].id,
        date: '2097-01-02',
        openingFloatCents: 300,
      },
      {
        tradingDayId: tradingDays[1].id,
        date: '2097-01-02',
        openingFloatCents: 200,
      },
      {
        tradingDayId: tradingDays[0].id,
        date: '2097-01-01',
        openingFloatCents: 100,
      },
    ]);
  });

  it('keeps CSV rows in their historical ascending order', async () => {
    const report = await service.getReport('2097-01-01', '2097-01-02');
    const rows = service
      .toCsv(report)
      .split('\r\n')
      .slice(1, 5)
      .map((row) => {
        const columns = row.split(',');
        return { date: columns[0], expectedCash: columns[10] };
      });

    expect(rows).toEqual([
      { date: '2097-01-01', expectedCash: '1.00' },
      { date: '2097-01-02', expectedCash: '2.00' },
      { date: '2097-01-02', expectedCash: '3.00' },
      { date: '2097-01-02', expectedCash: '4.00' },
    ]);
  });
});

describeWithDatabase('Cash amendment totals across close and reporting paths', () => {
  const locationId = randomUUID();
  const staffMemberId = randomUUID();
  const tradingDayId = randomUUID();
  const movementIds = Array.from({ length: 3 }, () => randomUUID());
  let prisma: PrismaService;
  let reporting: ReportingService;
  let tradingDay: TradingDayService;

  beforeAll(async () => {
    prisma = new PrismaService({
      datasources: { db: { url: testDatabaseUrl } },
    });
    await prisma.$connect();
    reporting = createReportingService(prisma);
    tradingDay = new TradingDayService(
      prisma,
      {
        getForTradingDay: jest.fn().mockResolvedValue([]),
      } as unknown as PackagingReconciliationService,
    );

    await prisma.location.create({
      data: { id: locationId, name: `Amendment totals ${locationId}` },
    });
    await prisma.staffMember.create({
      data: {
        id: staffMemberId,
        locationId,
        displayName: 'Amendment totals integration test',
      },
    });
    await prisma.tradingDay.create({
      data: {
        id: tradingDayId,
        locationId,
        businessDate: new Date('2100-01-02T00:00:00.000Z'),
        status: TradingDayStatus.OPEN,
        dayType: DayType.NORMAL,
        openedAt: new Date('2100-01-02T00:00:00.000Z'),
        openingFloatCents: 1_000,
        openedByStaffMemberId: staffMemberId,
      },
    });
    await prisma.cashMovement.create({
      data: {
        id: movementIds[0],
        tradingDayId,
        kind: CashMovementKind.CASH_IN,
        amountCents: 10_000,
        description: 'Original',
      },
    });
    await prisma.cashMovement.create({
      data: {
        id: movementIds[1],
        tradingDayId,
        amendsCashMovementId: movementIds[0],
        kind: CashMovementKind.CASH_OUT,
        amountCents: 8_000,
        description: 'First correction',
      },
    });
    await prisma.cashMovement.create({
      data: {
        id: movementIds[2],
        tradingDayId,
        amendsCashMovementId: movementIds[1],
        kind: CashMovementKind.EXPENSE,
        amountCents: 600,
        description: 'Chain tip',
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.cashMovement.deleteMany({
      where: { tradingDayId },
    });
    await prisma.tradingDay.delete({ where: { id: tradingDayId } });
    await prisma.staffMember.delete({ where: { id: staffMemberId } });
    await prisma.location.delete({ where: { id: locationId } });
    await prisma.$disconnect();
  });

  it('returns byte-identical effective totals for an amendment chain', async () => {
    const [closingSummary, report] = await Promise.all([
      tradingDay.getClosingSummary(),
      reporting.getReport('2100-01-02', '2100-01-02'),
    ]);
    const daily = report.dailyReconciliation[0]!;

    expect({
      cashInCents: closingSummary.cashInCents,
      cashOutCents: closingSummary.cashOutCents,
      cashExpensesCents: closingSummary.cashExpensesCents,
    }).toEqual({
      cashInCents: daily.cashInCents,
      cashOutCents: daily.cashOutCents,
      cashExpensesCents: daily.cashExpensesCents,
    });
    expect({
      cashInCents: daily.cashInCents,
      cashOutCents: daily.cashOutCents,
      cashExpensesCents: daily.cashExpensesCents,
    }).toEqual({
      cashInCents: 0,
      cashOutCents: 0,
      cashExpensesCents: 600,
    });
  });
});

describeWithDatabase('Order History queries against Postgres', () => {
  const staffMemberId = randomUUID();
  const olderTradingDayId = randomUUID();
  const newerTradingDayId = randomUUID();
  const olderFirstOrderId = randomUUID();
  const olderSecondOrderId = randomUUID();
  const newerFirstOrderId = randomUUID();
  const parkedOrderId = randomUUID();
  const voidedOrderId = randomUUID();
  const correctingVoidId = randomUUID();
  const splitOrderId = randomUUID();
  const underReceivedOrderId = randomUUID();
  const cashReceivedWithoutCashPortionOrderId = randomUUID();
  const categoryId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const lineId = randomUUID();
  const customerMarker = `order-history-integration-${randomUUID()}`;
  let prisma: PrismaService;
  let service: ReportingService;

  beforeAll(async () => {
    prisma = new PrismaService({
      datasources: {
        db: { url: testDatabaseUrl },
      },
    });
    await prisma.$connect();
    service = createReportingService(prisma);

    await prisma.staffMember.create({
      data: {
        id: staffMemberId,
        displayName: 'Order History integration test',
      },
    });
    await prisma.tradingDay.createMany({
      data: [
        {
          id: olderTradingDayId,
          businessDate: new Date('2026-07-20T00:00:00.000Z'),
          status: TradingDayStatus.CLOSED,
          openedAt: new Date('2026-07-20T00:00:00.000Z'),
          closedAt: new Date('2026-07-20T12:00:00.000Z'),
          openingFloatCents: 0,
          openedByStaffMemberId: staffMemberId,
          closedByStaffMemberId: staffMemberId,
        },
        {
          id: newerTradingDayId,
          businessDate: new Date('2026-07-21T00:00:00.000Z'),
          status: TradingDayStatus.CLOSED,
          openedAt: new Date('2026-07-21T00:00:00.000Z'),
          closedAt: new Date('2026-07-21T12:00:00.000Z'),
          openingFloatCents: 0,
          openedByStaffMemberId: staffMemberId,
          closedByStaffMemberId: staffMemberId,
        },
      ],
    });
    await prisma.category.create({
      data: {
        id: categoryId,
        name: `Ledger category ${categoryId}`,
        sortWeight: 1,
      },
    });
    await prisma.product.create({
      data: {
        id: productId,
        sku: `ledger-${productId}`,
        name: 'Ledger Latte',
        categoryId,
      },
    });
    await prisma.productVariant.create({
      data: {
        id: variantId,
        productId,
        name: 'Regular',
        priceCents: 5_000,
        sortWeight: 1,
      },
    });
    await prisma.sale.createMany({
      data: [
        {
          ...completedOrder(
            olderFirstOrderId,
            olderTradingDayId,
            1,
            customerMarker,
            {
              staffMemberId,
              nameSnapshot: 'Order History integration test',
            },
          ),
          serviceType: ServiceType.DINE_IN,
        },
        completedOrder(
          olderSecondOrderId,
          olderTradingDayId,
          2,
          customerMarker,
        ),
        completedOrder(
          newerFirstOrderId,
          newerTradingDayId,
          1,
          customerMarker,
        ),
        {
          ...completedOrder(
            parkedOrderId,
            olderTradingDayId,
            3,
            'Parked Customer',
          ),
          status: OrderStatus.PARKED,
          completedAt: null,
          serviceType: ServiceType.DINE_IN,
        },
        {
          ...completedOrder(
            voidedOrderId,
            olderTradingDayId,
            4,
            'Voided Customer',
          ),
          cashReceivedCents: 5_000,
          serviceType: ServiceType.DINE_IN,
        },
        {
          ...completedOrder(
            correctingVoidId,
            olderTradingDayId,
            5,
            null,
          ),
          kind: SaleKind.VOID,
          correctsSaleId: voidedOrderId,
          subtotalCents: -5_000,
          totalCents: -5_000,
          completedAt: null,
          voidReason: 'Incorrect item',
        },
        {
          ...completedOrder(
            splitOrderId,
            olderTradingDayId,
            6,
            null,
          ),
          subtotalCents: 10_000,
          discountCents: 2_000,
          totalCents: 8_000,
          cashReceivedCents: 5_000,
          changeOwedCents: 1_000,
          changeSettledAt: new Date('2026-07-20T06:30:00.000Z'),
          serviceType: ServiceType.DINE_IN,
        },
        {
          ...completedOrder(
            underReceivedOrderId,
            olderTradingDayId,
            7,
            'Legacy under-received cash',
          ),
          cashReceivedCents: 4_500,
          serviceType: ServiceType.DINE_IN,
        },
        {
          ...completedOrder(
            cashReceivedWithoutCashPortionOrderId,
            olderTradingDayId,
            8,
            'Legacy cash received without cash payment',
          ),
          cashReceivedCents: 5_500,
          serviceType: ServiceType.DINE_IN,
        },
      ],
    });
    await prisma.salePayment.createMany({
      data: [
        {
          saleId: olderFirstOrderId,
          method: PaymentMethod.CASH,
          amountCents: 5_000,
        },
        {
          saleId: olderSecondOrderId,
          method: PaymentMethod.ONLINE,
          amountCents: 5_000,
        },
        {
          saleId: voidedOrderId,
          method: PaymentMethod.CASH,
          amountCents: 5_000,
        },
        {
          saleId: splitOrderId,
          method: PaymentMethod.CASH,
          amountCents: 4_000,
        },
        {
          saleId: splitOrderId,
          method: PaymentMethod.ONLINE,
          amountCents: 4_000,
        },
        {
          saleId: underReceivedOrderId,
          method: PaymentMethod.CASH,
          amountCents: 5_000,
        },
      ],
    });
    await prisma.saleLine.create({
      data: {
        id: lineId,
        saleId: splitOrderId,
        productVariantId: variantId,
        quantity: 2,
        unitPriceCents: 5_000,
        lineGrossCents: 10_000,
        discountKind: LineDiscountKind.SENIOR,
        discountCents: 2_000,
        freeUpsizeEligible: false,
        lineTotalCents: 8_000,
        productNameSnapshot: 'Ledger Latte',
        variantNameSnapshot: 'Regular',
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.saleLine.deleteMany({ where: { id: lineId } });
    await prisma.salePayment.deleteMany({
      where: {
        saleId: {
          in: [
            olderFirstOrderId,
            olderSecondOrderId,
            voidedOrderId,
            splitOrderId,
            underReceivedOrderId,
          ],
        },
      },
    });
    await prisma.sale.deleteMany({
      where: {
        id: {
          in: [
            olderFirstOrderId,
            olderSecondOrderId,
            newerFirstOrderId,
            parkedOrderId,
            voidedOrderId,
            correctingVoidId,
            splitOrderId,
            underReceivedOrderId,
            cashReceivedWithoutCashPortionOrderId,
          ],
        },
      },
    });
    await prisma.productVariant.delete({ where: { id: variantId } });
    await prisma.product.delete({ where: { id: productId } });
    await prisma.category.delete({ where: { id: categoryId } });
    await prisma.tradingDay.deleteMany({
      where: {
        id: { in: [olderTradingDayId, newerTradingDayId] },
      },
    });
    await prisma.staffMember.delete({
      where: { id: staffMemberId },
    });
    await prisma.$disconnect();
  });

  it('executes list and detail queries and sorts order numbers day-then-number', async () => {
    const list = await service.getOrderHistory({
      search: customerMarker,
      sort: 'orderNumber',
      direction: 'asc',
      pageSize: 5,
    });

    expect(
      list.items.map(({ id, businessDay, dayOrderNumber }) => ({
        id,
        businessDay,
        dayOrderNumber,
      })),
    ).toEqual([
      {
        id: olderFirstOrderId,
        businessDay: '2026-07-20',
        dayOrderNumber: 1,
      },
      {
        id: olderSecondOrderId,
        businessDay: '2026-07-20',
        dayOrderNumber: 2,
      },
      {
        id: newerFirstOrderId,
        businessDay: '2026-07-21',
        dayOrderNumber: 1,
      },
    ]);

    await expect(
      service.getOrderHistoryDetail(olderFirstOrderId),
    ).resolves.toEqual(
      expect.objectContaining({
        id: olderFirstOrderId,
        businessDay: '2026-07-20',
        dayOrderNumber: 1,
        completedAt: '2026-07-20T06:00:00.000Z',
        lines: [],
      }),
    );
  });

  it('filters each service type and leaves the omitted query unfiltered', async () => {
    const [all, dineIn, takeOut] = await Promise.all([
      service.getOrderHistory({ search: customerMarker }),
      service.getOrderHistory({
        search: customerMarker,
        serviceType: SharedServiceType.DINE_IN,
      }),
      service.getOrderHistory({
        search: customerMarker,
        serviceType: SharedServiceType.TAKE_OUT,
      }),
    ]);

    expect(all.items.map(({ serviceType }) => serviceType).sort()).toEqual([
      'DINE_IN',
      'TAKE_OUT',
      'TAKE_OUT',
    ]);
    expect(dineIn.items).toEqual([
      expect.objectContaining({
        id: olderFirstOrderId,
        serviceType: 'DINE_IN',
      }),
    ]);
    expect(takeOut.items).toHaveLength(2);
    expect(takeOut.items.every(({ serviceType }) => serviceType === 'TAKE_OUT'))
      .toBe(true);
  });

  it('composes service, payment, and search filters', async () => {
    await expect(
      service.getOrderHistory({
        serviceType: SharedServiceType.DINE_IN,
        paymentMethod: 'Cash',
        search: customerMarker,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        totalItems: 1,
        items: [expect.objectContaining({ id: olderFirstOrderId })],
      }),
    );
  });

  it('calculates paging metadata from the service-filtered count', async () => {
    const firstPage = await service.getOrderHistory({
      serviceType: SharedServiceType.DINE_IN,
      page: 1,
      pageSize: 5,
    });
    const secondPage = await service.getOrderHistory({
      serviceType: SharedServiceType.DINE_IN,
      page: 2,
      pageSize: 5,
    });

    expect(firstPage).toEqual(
      expect.objectContaining({
        page: 1,
        totalItems: 6,
        totalPages: 2,
      }),
    );
    expect(firstPage.items).toHaveLength(5);
    expect(secondPage).toEqual(
      expect.objectContaining({
        page: 2,
        totalItems: 6,
        totalPages: 2,
      }),
    );
    expect(secondPage.items).toHaveLength(1);
  });

  it('does not apply an admin service filter to the staff ledger', async () => {
    await service.getOrderHistory({
      serviceType: SharedServiceType.TAKE_OUT,
    });

    const ledger = await service.getStaffOrderLedger(
      olderTradingDayId,
      {},
    );

    expect(ledger.orders).toHaveLength(7);
    expect(new Set(ledger.orders.map(({ serviceType }) => serviceType))).toEqual(
      new Set(['DINE_IN', 'TAKE_OUT']),
    );
  });

  it('keeps completed, parked, and derived void orders on a closed day', async () => {
    const ledger = await service.getStaffOrderLedger(
      olderTradingDayId,
      {},
    );

    expect(
      ledger.orders.map(({ id, dayOrderNumber, status }) => ({
        id,
        dayOrderNumber,
        status,
      })),
    ).toEqual([
      {
        id: cashReceivedWithoutCashPortionOrderId,
        dayOrderNumber: 8,
        status: 'Completed',
      },
      {
        id: underReceivedOrderId,
        dayOrderNumber: 7,
        status: 'Completed',
      },
      { id: splitOrderId, dayOrderNumber: 6, status: 'Completed' },
      { id: voidedOrderId, dayOrderNumber: 4, status: 'Void' },
      { id: parkedOrderId, dayOrderNumber: 3, status: 'Parked' },
      { id: olderSecondOrderId, dayOrderNumber: 2, status: 'Completed' },
      { id: olderFirstOrderId, dayOrderNumber: 1, status: 'Completed' },
    ]);

    const voided = ledger.orders.find(({ id }) => id === voidedOrderId);
    expect(voided).toEqual(
      expect.objectContaining({
        voidReason: 'Incorrect item',
        completedAt: '2026-07-20T06:00:00.000Z',
        cashReceivedCents: 5_000,
        expectedChangeCents: 0,
      }),
    );

    const split = ledger.orders.find(({ id }) => id === splitOrderId);
    expect(split).toEqual(
      expect.objectContaining({
        cashierName: null,
        paymentMethod: 'Split',
        cashPortionCents: 4_000,
        onlinePortionCents: 4_000,
        cashReceivedCents: 5_000,
        expectedChangeCents: 1_000,
        changeOwedCents: 1_000,
        changeSettled: true,
        lines: [
          expect.objectContaining({
            productName: 'Ledger Latte',
            size: 'Regular',
            quantity: 2,
            discountKind: 'SENIOR',
            discountCents: 2_000,
          }),
        ],
      }),
    );

    expect(
      ledger.orders.find(({ id }) => id === olderSecondOrderId),
    ).toEqual(
      expect.objectContaining({
        cashReceivedCents: null,
        expectedChangeCents: null,
      }),
    );
    expect(
      ledger.orders.find(({ id }) => id === parkedOrderId),
    ).toEqual(
      expect.objectContaining({
        cashReceivedCents: null,
        expectedChangeCents: null,
      }),
    );
    expect(
      ledger.orders.find(({ id }) => id === olderFirstOrderId),
    ).toEqual(
      expect.objectContaining({
        cashReceivedCents: null,
        expectedChangeCents: null,
      }),
    );
    expect(
      ledger.orders.find(({ id }) => id === underReceivedOrderId),
    ).toEqual(
      expect.objectContaining({
        cashReceivedCents: 4_500,
        expectedChangeCents: -500,
      }),
    );
    expect(
      ledger.orders.find(
        ({ id }) => id === cashReceivedWithoutCashPortionOrderId,
      ),
    ).toEqual(
      expect.objectContaining({
        cashReceivedCents: 5_500,
        expectedChangeCents: null,
      }),
    );
  });

  it('applies status, payment, and customer filters conjunctively', async () => {
    await expect(
      service.getStaffOrderLedger(olderTradingDayId, {
        status: 'Completed',
        paymentMethod: 'Split',
        search: 'Walk-in',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        orders: [expect.objectContaining({ id: splitOrderId })],
      }),
    );

    const [cash, online, parked, voided, partialWalkIn] =
      await Promise.all([
        service.getStaffOrderLedger(olderTradingDayId, {
          paymentMethod: 'Cash',
        }),
        service.getStaffOrderLedger(olderTradingDayId, {
          paymentMethod: 'Online',
        }),
        service.getStaffOrderLedger(olderTradingDayId, {
          status: 'Parked',
        }),
        service.getStaffOrderLedger(olderTradingDayId, {
          status: 'Void',
        }),
        service.getStaffOrderLedger(olderTradingDayId, {
          search: 'walk',
        }),
      ]);

    expect(cash.orders.map(({ id }) => id)).toEqual([
      underReceivedOrderId,
      voidedOrderId,
      olderFirstOrderId,
    ]);
    expect(online.orders.map(({ id }) => id)).toEqual([
      olderSecondOrderId,
    ]);
    expect(parked.orders.map(({ id }) => id)).toEqual([parkedOrderId]);
    expect(voided.orders.map(({ id }) => id)).toEqual([voidedOrderId]);
    expect(partialWalkIn.orders).toEqual([]);
  });
});

function completedOrder(
  id: string,
  tradingDayId: string,
  dayOrderNumber: number,
  customerName: string | null,
  cashier: {
    staffMemberId: string;
    nameSnapshot: string;
  } | null = null,
): Prisma.SaleCreateManyInput {
  return {
    id,
    clientGeneratedId: randomUUID(),
    tradingDayId,
    cashierStaffMemberId: cashier?.staffMemberId ?? null,
    cashierNameSnapshot: cashier?.nameSnapshot ?? null,
    kind: SaleKind.PURCHASE,
    dayOrderNumber,
    status: OrderStatus.COMPLETED,
    customerName,
    serviceType: ServiceType.TAKE_OUT,
    subtotalCents: 5_000,
    discountCents: 0,
    taxCents: 0,
    totalCents: 5_000,
    cashTipCents: 0,
    cashReceivedCents: null,
    changeOwedCents: 0,
    changeSettledAt: null,
    completedAt: new Date('2026-07-20T06:00:00.000Z'),
    voidReason: null,
  };
}
