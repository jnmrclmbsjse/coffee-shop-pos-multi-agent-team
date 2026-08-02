import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import {
  DayType,
  LineDiscountKind,
  OrderStatus,
  PaymentMethod,
  ServiceType,
  TradingDayStatus,
} from '@prisma/client';
import type { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import type {
  CompleteOrderDto,
  CreateOrderDto,
  VoidOrderDto,
} from './orders.dto';
import {
  NO_OPEN_DAY_MESSAGE,
  ORDER_FROZEN_MESSAGE,
  OrdersService,
} from './orders.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase('Order capture against Postgres', () => {
  const locationId = randomUUID();
  const openerId = randomUUID();
  const tradingDayId = randomUUID();
  const categoryId = randomUUID();
  const productId = randomUUID();
  const variantId = randomUUID();
  const clientGeneratedId = randomUUID();
  const voidClientGeneratedId = randomUUID();
  let prisma: PrismaService;
  let service: OrdersService;

  const createInput: CreateOrderDto = {
    clientGeneratedId,
    deviceId: `orders-test-${clientGeneratedId}`,
    productVariantId: variantId,
    quantity: 1,
    discountKind: LineDiscountKind.SENIOR,
    preferences: [],
    preferenceNote: null,
    freeUpsizeCount: 1,
    customerName: null,
    serviceType: ServiceType.DINE_IN,
  };

  beforeAll(async () => {
    prisma = new PrismaService({
      datasources: { db: { url: testDatabaseUrl } },
    });
    await prisma.$connect();
    service = new OrdersService(
      prisma,
      new SalesService(prisma, {} as AuthService),
    );

    await prisma.location.create({
      data: { id: locationId, name: `Orders test ${locationId}` },
    });
    await prisma.staffMember.create({
      data: {
        id: openerId,
        locationId,
        displayName: 'Orders Test Opener',
      },
    });
    await prisma.category.create({
      data: {
        id: categoryId,
        name: `Eligible ${categoryId}`,
        sortWeight: 999,
        freeUpsizeEligible: true,
      },
    });
    await prisma.product.create({
      data: {
        id: productId,
        sku: `ORDERS-${productId}`,
        name: 'Test Coffee',
        categoryId,
      },
    });
    await prisma.productVariant.create({
      data: {
        id: variantId,
        productId,
        name: 'Regular',
        priceCents: 15_000,
        sortWeight: 1,
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    const sales = await prisma.sale.findMany({
      where: {
        clientGeneratedId: {
          in: [clientGeneratedId, voidClientGeneratedId],
        },
      },
      select: { id: true },
    });
    const saleIds = sales.map(({ id }) => id);
    await prisma.salePayment.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.saleLine.deleteMany({ where: { saleId: { in: saleIds } } });
    await prisma.sale.deleteMany({ where: { id: { in: saleIds } } });
    await prisma.productVariant.delete({ where: { id: variantId } });
    await prisma.product.delete({ where: { id: productId } });
    await prisma.category.delete({ where: { id: categoryId } });
    await prisma.tradingDay.deleteMany({ where: { id: tradingDayId } });
    await prisma.staffMember.delete({ where: { id: openerId } });
    await prisma.location.delete({ where: { id: locationId } });
    await prisma.$disconnect();
  });

  it('rejects first-line capture when no business day is open', async () => {
    await expect(service.create(createInput)).rejects.toThrow(
      NO_OPEN_DAY_MESSAGE,
    );
    await expect(
      prisma.sale.findUnique({ where: { clientGeneratedId } }),
    ).resolves.toBeNull();

    await prisma.tradingDay.create({
      data: {
        id: tradingDayId,
        locationId,
        businessDate: new Date('2099-08-02T00:00:00.000Z'),
        status: TradingDayStatus.OPEN,
        dayType: DayType.NORMAL,
        openedAt: new Date('2099-08-02T00:00:00.000Z'),
        openingFloatCents: 5_000,
        openedByStaffMemberId: openerId,
      },
    });
  });

  it('creates on the first line, snapshots a NULL cashier, and replays unchanged', async () => {
    const first = await service.create(createInput);
    const replay = await service.create(createInput);

    expect(first).toEqual(
      expect.objectContaining({
        id: replay.id,
        dayOrderNumber: replay.dayOrderNumber,
        status: OrderStatus.PARKED,
        cashierStaffMemberId: null,
        cashierNameSnapshot: null,
        subtotalCents: 15_000,
        freeUpsizeCents: 3_000,
        discountCents: 2_400,
        totalCents: 9_600,
      }),
    );
    expect(replay.lines).toHaveLength(1);
    await expect(
      prisma.sale.count({ where: { tradingDayId } }),
    ).resolves.toBe(1);
  });

  it('lists and resumes the parked order for the open day', async () => {
    await expect(service.listParked()).resolves.toEqual([
      expect.objectContaining({ clientGeneratedId }),
    ]);
    await expect(service.get(clientGeneratedId)).resolves.toEqual(
      expect.objectContaining({ clientGeneratedId, customerName: null }),
    );
  });

  it('completes without a cashier, replays without another payment, and freezes mutations', async () => {
    const settlement: CompleteOrderDto = {
      payments: [
        { method: PaymentMethod.CASH, amountCents: 9_600 },
      ],
      cashReceivedCents: 10_000,
      cashTipCents: 100,
      changeOwedCents: 400,
    };
    const completed = await service.complete(clientGeneratedId, settlement);
    const replay = await service.complete(clientGeneratedId, settlement);

    expect(completed.status).toBe(OrderStatus.COMPLETED);
    expect(completed.cashierStaffMemberId).toBeNull();
    expect(replay.id).toBe(completed.id);
    expect(replay.completedAt).toEqual(completed.completedAt);
    await expect(
      prisma.salePayment.count({ where: { saleId: completed.id } }),
    ).resolves.toBe(1);
    await expect(
      service.update(clientGeneratedId, {
        serviceType: ServiceType.TAKE_OUT,
      }),
    ).rejects.toThrow(ORDER_FROZEN_MESSAGE);
  });

  it('settles change through the narrow completed-row exception without changing the amount owed', async () => {
    const settled = await service.settleChange(clientGeneratedId);
    const replay = await service.settleChange(clientGeneratedId);

    expect(settled.changeOwedCents).toBe(400);
    expect(settled.changeSettledAt).not.toBeNull();
    expect(replay.changeSettledAt).toEqual(settled.changeSettledAt);
  });

  it('voids through a correcting row with negative payments and NULL cashier attribution', async () => {
    const input: VoidOrderDto = {
      clientGeneratedId: voidClientGeneratedId,
      deviceId: createInput.deviceId,
      voidReason: '  Incorrect item  ',
    };
    const correction = await service.void(clientGeneratedId, input);
    const replay = await service.void(clientGeneratedId, input);

    expect(correction).toEqual(
      expect.objectContaining({
        id: replay.id,
        correctsSaleId: expect.any(String),
        totalCents: -9_600,
        voidReason: 'Incorrect item',
        cashierStaffMemberId: null,
      }),
    );
    expect(correction.payments).toEqual([
      expect.objectContaining({ amountCents: -9_600 }),
    ]);
    await expect(
      service.void(clientGeneratedId, {
        ...input,
        clientGeneratedId: randomUUID(),
      }),
    ).rejects.toThrow(ConflictException);
  });
});
