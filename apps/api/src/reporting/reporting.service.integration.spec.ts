import { randomUUID } from 'node:crypto';
import {
  CashMovementKind,
  OrderStatus,
  PaymentMethod,
  Prisma,
  SaleKind,
  ServiceType,
  TradingDayStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportingService } from './reporting.service';

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
    service = new ReportingService(prisma);

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
          kind: CashMovementKind.CASH_IN,
          amountCents: -1_000,
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
          kind: CashMovementKind.EXPENSE,
          amountCents: -250,
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

  it('returns signed movement totals and only unsettled change', async () => {
    const report = await service.getReport('2026-07-22', '2026-07-22');

    expect(report.dailyReconciliation).toEqual([
      {
        date: '2026-07-22',
        status: 'closed',
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
});

describeWithDatabase('Order History queries against Postgres', () => {
  const staffMemberId = randomUUID();
  const olderTradingDayId = randomUUID();
  const newerTradingDayId = randomUUID();
  const olderFirstOrderId = randomUUID();
  const olderSecondOrderId = randomUUID();
  const newerFirstOrderId = randomUUID();
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
    service = new ReportingService(prisma);

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
    await prisma.sale.createMany({
      data: [
        completedOrder(
          olderFirstOrderId,
          olderTradingDayId,
          1,
          customerMarker,
          {
            staffMemberId,
            nameSnapshot: 'Order History integration test',
          },
        ),
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
      ],
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.sale.deleteMany({
      where: {
        id: {
          in: [
            olderFirstOrderId,
            olderSecondOrderId,
            newerFirstOrderId,
          ],
        },
      },
    });
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
});

function completedOrder(
  id: string,
  tradingDayId: string,
  dayOrderNumber: number,
  customerName: string,
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
