import { randomUUID } from 'node:crypto';
import {
  OrderStatus,
  Prisma,
  SaleKind,
  ServiceType,
  TradingDayStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportingService } from './reporting.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

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
): Prisma.SaleCreateManyInput {
  return {
    id,
    clientGeneratedId: randomUUID(),
    tradingDayId,
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
