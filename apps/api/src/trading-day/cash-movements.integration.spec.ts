import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import {
  CashMovementKind as SharedCashMovementKind,
  cents,
} from '@coffee-shop/shared';
import {
  CashMovementKind,
  DayType,
  TradingDayStatus,
} from '@prisma/client';
import type { PackagingReconciliationService } from '../inventory/packaging-reconciliation.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateCashMovementDto } from './trading-day.dto';
import { TradingDayService } from './trading-day.service';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase('Cash movement capture against Postgres', () => {
  const locationId = randomUUID();
  const activeStaffId = randomUUID();
  const inactiveStaffId = randomUUID();
  const openDayId = randomUUID();
  const closedDayId = randomUUID();
  const cashInId = randomUUID();
  const concurrentCashInId = randomUUID();
  const cashOutId = randomUUID();
  const blankCategoryExpenseId = randomUUID();
  const categorizedExpenseId = randomUUID();
  const inactiveAttributionId = randomUUID();
  const closedDayMovementId = randomUUID();
  let prisma: PrismaService;
  let service: TradingDayService;

  const input = (
    overrides: Partial<CreateCashMovementDto>,
  ): CreateCashMovementDto =>
    ({
      clientGeneratedId: randomUUID(),
      kind: SharedCashMovementKind.CASH_IN,
      amountCents: cents(100),
      description: 'Test movement',
      ...overrides,
    }) as CreateCashMovementDto;

  beforeAll(async () => {
    prisma = new PrismaService({
      datasources: { db: { url: testDatabaseUrl } },
    });
    await prisma.$connect();
    service = new TradingDayService(
      prisma,
      {
        getForTradingDay: jest.fn().mockResolvedValue([]),
      } as unknown as PackagingReconciliationService,
    );

    await prisma.location.create({
      data: { id: locationId, name: `Cash movement test ${locationId}` },
    });
    await prisma.staffMember.createMany({
      data: [
        {
          id: activeStaffId,
          locationId,
          displayName: 'Original Recorder Name',
          isActive: true,
        },
        {
          id: inactiveStaffId,
          locationId,
          displayName: 'Inactive Recorder',
          isActive: false,
        },
      ],
    });
    await prisma.tradingDay.createMany({
      data: [
        {
          id: openDayId,
          locationId,
          businessDate: new Date('2099-08-01T00:00:00.000Z'),
          status: TradingDayStatus.OPEN,
          dayType: DayType.NORMAL,
          openedAt: new Date('2099-08-01T00:00:00.000Z'),
          openingFloatCents: 5_000,
          openedByStaffMemberId: activeStaffId,
        },
        {
          id: closedDayId,
          locationId,
          businessDate: new Date('2099-07-31T00:00:00.000Z'),
          status: TradingDayStatus.CLOSED,
          dayType: DayType.NORMAL,
          openedAt: new Date('2099-07-31T00:00:00.000Z'),
          closedAt: new Date('2099-07-31T12:00:00.000Z'),
          openingFloatCents: 5_000,
          openedByStaffMemberId: activeStaffId,
          closedByStaffMemberId: activeStaffId,
        },
      ],
    });
    await prisma.cashMovement.create({
      data: {
        id: closedDayMovementId,
        tradingDayId: closedDayId,
        kind: CashMovementKind.CASH_IN,
        amountCents: 99_999,
        description: 'Different day',
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.cashMovement.deleteMany({
      where: { tradingDayId: { in: [openDayId, closedDayId] } },
    });
    await prisma.tradingDay.deleteMany({
      where: { id: { in: [openDayId, closedDayId] } },
    });
    await prisma.staffMember.deleteMany({
      where: { id: { in: [activeStaffId, inactiveStaffId] } },
    });
    await prisma.location.delete({ where: { id: locationId } });
    await prisma.$disconnect();
  });

  it('records each kind, normalizes category, and rejects inactive staff', async () => {
    await service.recordCashMovement(
      input({
        clientGeneratedId: cashInId,
        kind: SharedCashMovementKind.CASH_IN,
        amountCents: cents(1_000),
        description: '  Float top-up  ',
      }),
    );
    await service.recordCashMovement(
      input({
        clientGeneratedId: cashOutId,
        kind: SharedCashMovementKind.CASH_OUT,
        amountCents: cents(200),
        description: 'Bank drop',
        recordedByStaffMemberId: activeStaffId,
      }),
    );
    await service.recordCashMovement(
      input({
        clientGeneratedId: blankCategoryExpenseId,
        kind: SharedCashMovementKind.EXPENSE,
        amountCents: cents(300),
        description: 'Ice',
        category: '   ',
      }),
    );
    await service.recordCashMovement(
      input({
        clientGeneratedId: categorizedExpenseId,
        kind: SharedCashMovementKind.EXPENSE,
        amountCents: cents(400),
        description: '  Cleaning supplies  ',
        category: '  Supplies  ',
        recordedByStaffMemberId: activeStaffId,
      }),
    );

    await expect(
      service.recordCashMovement(
        input({
          clientGeneratedId: inactiveAttributionId,
          recordedByStaffMemberId: inactiveStaffId,
        }),
      ),
    ).rejects.toThrow(
      'recordedByStaffMemberId must reference an active staff member',
    );

    await expect(
      prisma.cashMovement.findUnique({
        where: { id: blankCategoryExpenseId },
      }),
    ).resolves.toEqual(
      expect.objectContaining({ category: null, description: 'Ice' }),
    );
    await expect(
      prisma.cashMovement.findUnique({
        where: { id: categorizedExpenseId },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        category: 'Supplies',
        description: 'Cleaning supplies',
        recordedByNameSnapshot: 'Original Recorder Name',
      }),
    );
    await expect(
      prisma.cashMovement.findUnique({
        where: { id: inactiveAttributionId },
      }),
    ).resolves.toBeNull();
  });

  it('makes concurrent retries idempotent at the primary-key boundary', async () => {
    const retry = input({
      clientGeneratedId: concurrentCashInId,
      kind: SharedCashMovementKind.CASH_IN,
      amountCents: cents(50),
      description: 'Concurrent top-up',
    });

    const [first, second] = await Promise.all([
      service.recordCashMovement(retry),
      service.recordCashMovement(retry),
    ]);

    expect(first.id).toBe(concurrentCashInId);
    expect(second.id).toBe(concurrentCashInId);
    await expect(
      prisma.cashMovement.count({ where: { id: concurrentCashInId } }),
    ).resolves.toBe(1);
  });

  it('keeps snapshot attribution and scopes reads and cash totals to the open day', async () => {
    await prisma.staffMember.update({
      where: { id: activeStaffId },
      data: { displayName: 'Renamed Recorder', isActive: false },
    });

    const ledger = await service.getCashMovements();
    expect(ledger.businessDay).toEqual(
      expect.objectContaining({
        isOpen: true,
        businessDate: '2099-08-01',
      }),
    );
    expect(ledger.movements).toHaveLength(5);
    expect(
      ledger.movements.find(
        (movement) => movement.id === categorizedExpenseId,
      ),
    ).toEqual(
      expect.objectContaining({
        recordedByNameSnapshot: 'Original Recorder Name',
      }),
    );
    expect(
      ledger.movements.some(
        (movement) => movement.id === closedDayMovementId,
      ),
    ).toBe(false);

    await expect(service.getClosingSummary()).resolves.toEqual(
      expect.objectContaining({
        cashInCents: 1_050,
        cashOutCents: 200,
        cashExpensesCents: 700,
        expectedCashCents: 5_150,
      }),
    );
  });

  it('returns an empty state and rejects writes after the day closes', async () => {
    await prisma.tradingDay.update({
      where: { id: openDayId },
      data: {
        status: TradingDayStatus.CLOSED,
        closedAt: new Date('2099-08-01T12:00:00.000Z'),
        closedByStaffMemberId: activeStaffId,
      },
    });

    await expect(service.getCashMovements()).resolves.toEqual({
      businessDay: expect.objectContaining({ isOpen: false }),
      movements: [],
    });
    await expect(
      service.recordCashMovement(input({})),
    ).rejects.toThrow(new ConflictException('No business day is open'));
  });
});
