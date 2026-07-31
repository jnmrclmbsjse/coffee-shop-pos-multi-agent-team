import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  CashMovementKind as SharedCashMovementKind,
  DayType as SharedDayType,
} from '@coffee-shop/shared';
import {
  CashMovementKind,
  DayType,
  TradingDayStatus,
} from '@prisma/client';
import type { PackagingReconciliationService } from '../inventory/packaging-reconciliation.service';
import type { PrismaService } from '../prisma/prisma.service';
import type {
  CloseBusinessDayDto,
  CreateCashMovementDto,
  OpenBusinessDayDto,
} from './trading-day.dto';
import { TradingDayService } from './trading-day.service';

describe('TradingDayService', () => {
  const day = {
    id: '10000000-0000-4000-8000-000000000001',
    locationId: null,
    businessDate: new Date('2026-07-23T00:00:00.000Z'),
    dayType: DayType.PEAK,
    openingFloatCents: 50000,
    openedAt: new Date('2026-07-22T23:00:00.000Z'),
    openedByStaffMember: {
      displayName: 'Current Opener Name',
    },
  };
  const closer = {
    id: '20000000-0000-4000-8000-000000000001',
    displayName: 'Closing Staff Snapshot',
  };
  const closeInput: CloseBusinessDayDto = {
    clientGeneratedId: '30000000-0000-4000-8000-000000000001',
    actualCashCents: 62000 as CloseBusinessDayDto['actualCashCents'],
    closedByStaffMemberId: closer.id,
  };
  const openingInput: OpenBusinessDayDto = {
    businessDate: '2026-07-23',
    dayType: SharedDayType.PEAK,
    openingFloatCents: 50000 as OpenBusinessDayDto['openingFloatCents'],
    openedByStaffMemberId:
      '40000000-0000-4000-8000-000000000001',
  };
  const movementInput: CreateCashMovementDto = {
    clientGeneratedId: '90000000-0000-4000-8000-000000000001',
    kind: SharedCashMovementKind.EXPENSE,
    amountCents: 750 as CreateCashMovementDto['amountCents'],
    description: '  Cleaning supplies  ',
    category: '  Supplies  ',
    recordedByStaffMemberId: closer.id,
  };
  const packagingRows = [
    {
      inventoryItemId:
        '50000000-0000-4000-8000-000000000001',
      itemName: '12 oz cup',
      expectedQty: 18,
      actualQty: 17,
      varianceQty: -1,
    },
  ];

  function closingRecord(
    overrides: Record<string, unknown> = {},
  ) {
    return {
      id: closeInput.clientGeneratedId,
      tradingDayId: day.id,
      cashCountId: '60000000-0000-4000-8000-000000000001',
      openingFloatCents: 50000,
      cashSalesCents: 10000,
      onlineSalesCents: 2000,
      cashTipsCents: 500,
      cashInCents: 1000,
      cashOutCents: 200,
      cashExpensesCents: 300,
      outstandingChangeCents: 100,
      expectedCashCents: 61100,
      actualCashCents: 62000,
      varianceCents: 900,
      varianceReason: null,
      closedByStaffMemberId: closer.id,
      closedByNameSnapshot: closer.displayName,
      closedAt: new Date('2026-07-23T13:00:00.000Z'),
      lines: [
        {
          id: '70000000-0000-4000-8000-000000000001',
          dayClosingId: closeInput.clientGeneratedId,
          inventoryItemId: packagingRows[0]!.inventoryItemId,
          itemNameSnapshot: packagingRows[0]!.itemName,
          expectedQty: 18,
          actualQty: 17,
          varianceQty: -1,
        },
      ],
      ...overrides,
    };
  }

  function createHarness() {
    const prisma = {
      tradingDay: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      staffMember: {
        findFirst: jest.fn(),
      },
      stockCount: {
        findFirst: jest.fn(),
      },
      salePayment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      sale: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      cashMovement: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      cashCount: {
        create: jest.fn(),
      },
      dayClosing: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(),
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: unknown) => unknown) =>
        callback(prisma),
    );
    const packaging = {
      getForTradingDay: jest.fn().mockResolvedValue(packagingRows),
    };
    const service = new TradingDayService(
      prisma as unknown as PrismaService,
      packaging as unknown as PackagingReconciliationService,
    );

    return { prisma, packaging, service };
  }

  function arrangeCash(prisma: ReturnType<typeof createHarness>['prisma']) {
    prisma.salePayment.findMany.mockResolvedValue([
      { method: 'CASH', amountCents: 10000 },
      { method: 'ONLINE', amountCents: 2000 },
    ]);
    prisma.sale.findMany.mockResolvedValue([
      {
        cashTipCents: 500,
        changeOwedCents: 100,
        changeSettledAt: null,
      },
      {
        cashTipCents: 0,
        changeOwedCents: 900,
        changeSettledAt: new Date(),
      },
    ]);
    prisma.cashMovement.findMany.mockResolvedValue([
      { kind: CashMovementKind.CASH_IN, amountCents: 1000 },
      { kind: CashMovementKind.CASH_OUT, amountCents: 200 },
      { kind: CashMovementKind.EXPENSE, amountCents: 300 },
    ]);
  }

  function arrangeSuccessfulClose(
    harness: ReturnType<typeof createHarness>,
    record = closingRecord(),
  ) {
    const { prisma } = harness;
    prisma.dayClosing.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.tradingDay.findFirst.mockResolvedValue(day);
    prisma.tradingDay.findUnique.mockResolvedValue({
      ...day,
      status: TradingDayStatus.OPEN,
    });
    prisma.staffMember.findFirst.mockResolvedValue(closer);
    prisma.tradingDay.updateMany.mockResolvedValue({ count: 1 });
    prisma.cashCount.create.mockResolvedValue({
      id: record.cashCountId,
    });
    prisma.dayClosing.create.mockResolvedValue(record);
    arrangeCash(prisma);
  }

  it('returns the open business day with additive summary fields', async () => {
    const { prisma, service } = createHarness();
    prisma.tradingDay.findFirst.mockResolvedValue(day);

    await expect(service.getCurrentOpenDay()).resolves.toEqual({
      isOpen: true,
      businessDate: '2026-07-23',
      dayType: 'PEAK',
      openingFloatCents: 50000,
      openedByDisplayName: 'Current Opener Name',
      openedAt: '2026-07-22T23:00:00.000Z',
    });
    expect(prisma.tradingDay.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: TradingDayStatus.OPEN },
      }),
    );
  });

  it('returns an explicit no-open-day result', async () => {
    const { prisma, service } = createHarness();
    prisma.tradingDay.findFirst.mockResolvedValue(null);

    await expect(service.getCurrentOpenDay()).resolves.toEqual({
      isOpen: false,
      businessDate: null,
      dayType: null,
      openingFloatCents: null,
      openedByDisplayName: null,
      openedAt: null,
    });
  });

  it('lists newest business days and identifies the open day', async () => {
    const { prisma, service } = createHarness();
    prisma.tradingDay.findMany.mockResolvedValue([
      {
        id: day.id,
        businessDate: day.businessDate,
        status: TradingDayStatus.OPEN,
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        businessDate: new Date('2026-07-22T00:00:00.000Z'),
        status: TradingDayStatus.CLOSED,
      },
    ]);

    await expect(service.listBusinessDays()).resolves.toEqual({
      items: [
        {
          id: day.id,
          businessDate: '2026-07-23',
          status: 'OPEN',
        },
        {
          id: '10000000-0000-4000-8000-000000000002',
          businessDate: '2026-07-22',
          status: 'CLOSED',
        },
      ],
      currentOpenBusinessDayId: day.id,
    });
    expect(prisma.tradingDay.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [
          { businessDate: 'desc' },
          { openedAt: 'desc' },
          { id: 'asc' },
        ],
      }),
    );
  });

  it('lists closed days without requiring an open day', async () => {
    const { prisma, service } = createHarness();
    prisma.tradingDay.findMany.mockResolvedValue([
      {
        id: day.id,
        businessDate: day.businessDate,
        status: TradingDayStatus.CLOSED,
      },
    ]);

    await expect(service.listBusinessDays()).resolves.toEqual(
      expect.objectContaining({ currentOpenBusinessDayId: null }),
    );
  });

  it('opens a valid unused business date for active staff', async () => {
    const { prisma, service } = createHarness();
    prisma.tradingDay.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.staffMember.findFirst.mockResolvedValue({
      id: openingInput.openedByStaffMemberId,
    });
    prisma.tradingDay.create.mockResolvedValue(day);

    await expect(service.open(openingInput)).resolves.toEqual(
      expect.objectContaining({
        isOpen: true,
        businessDate: '2026-07-23',
        openingFloatCents: 50000,
        openedByDisplayName: 'Current Opener Name',
      }),
    );
    expect(prisma.tradingDay.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          locationId: null,
          businessDate: new Date('2026-07-23T00:00:00.000Z'),
          status: TradingDayStatus.OPEN,
          dayType: DayType.PEAK,
          openingFloatCents: 50000,
          openedByStaffMemberId:
            openingInput.openedByStaffMemberId,
        }),
      }),
    );
  });

  it('rejects opening while another business day is open', async () => {
    const { prisma, service } = createHarness();
    prisma.tradingDay.findFirst
      .mockResolvedValueOnce({ id: day.id })
      .mockResolvedValueOnce(null);
    prisma.staffMember.findFirst.mockResolvedValue({
      id: openingInput.openedByStaffMemberId,
    });

    await expect(service.open(openingInput)).rejects.toThrow(
      new ConflictException('A business day is already open'),
    );
    expect(prisma.tradingDay.create).not.toHaveBeenCalled();
  });

  it('rejects a business date that was already used', async () => {
    const { prisma, service } = createHarness();
    prisma.tradingDay.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: day.id });
    prisma.staffMember.findFirst.mockResolvedValue({
      id: openingInput.openedByStaffMemberId,
    });

    await expect(service.open(openingInput)).rejects.toThrow(
      'A business day already exists for this business date',
    );
    expect(prisma.tradingDay.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown or inactive opener without writing', async () => {
    const { prisma, service } = createHarness();
    prisma.tradingDay.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.staffMember.findFirst.mockResolvedValue(null);

    await expect(service.open(openingInput)).rejects.toThrow(
      'openedByStaffMemberId must reference an active staff member',
    );
    expect(prisma.tradingDay.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...openingInput, businessDate: '' }, 'businessDate'],
    [
      { ...openingInput, businessDate: '2026-02-30' },
      'businessDate',
    ],
    [{ ...openingInput, dayType: 'HOLIDAY' }, 'dayType'],
    [
      { ...openingInput, openingFloatCents: -1 },
      'openingFloatCents',
    ],
    [
      { ...openingInput, openingFloatCents: 1.5 },
      'openingFloatCents',
    ],
    [
      { ...openingInput, openedByStaffMemberId: '' },
      'openedByStaffMemberId',
    ],
  ])('rejects invalid open input %#', async (invalid, message) => {
    const { prisma, service } = createHarness();

    await expect(
      service.open(invalid as OpenBusinessDayDto),
    ).rejects.toThrow(message);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('composes the closing summary from shared cash and Inventory data', async () => {
    const { prisma, packaging, service } = createHarness();
    prisma.tradingDay.findFirst.mockResolvedValue(day);
    prisma.stockCount.findFirst.mockResolvedValue({ id: 'count-id' });
    arrangeCash(prisma);

    await expect(service.getClosingSummary()).resolves.toEqual({
      isOpen: true,
      businessDate: '2026-07-23',
      openingFloatCents: 50000,
      cashSalesCents: 10000,
      onlineSalesCents: 2000,
      grossSalesCents: 12000,
      cashTipsCents: 500,
      cashInCents: 1000,
      cashOutCents: 200,
      cashExpensesCents: 300,
      outstandingChangeCents: 100,
      expectedCashCents: 61100,
      packaging: packagingRows,
      hasClosingStockCount: true,
    });
    expect(packaging.getForTradingDay).toHaveBeenCalledWith(day);
  });

  it('returns a well-formed closing summary when no day is open', async () => {
    const { prisma, packaging, service } = createHarness();
    prisma.tradingDay.findFirst.mockResolvedValue(null);

    await expect(service.getClosingSummary()).resolves.toEqual({
      isOpen: false,
      businessDate: null,
      openingFloatCents: null,
      cashSalesCents: null,
      onlineSalesCents: null,
      grossSalesCents: null,
      cashTipsCents: null,
      cashInCents: null,
      cashOutCents: null,
      cashExpensesCents: null,
      outstandingChangeCents: null,
      expectedCashCents: null,
      packaging: [],
      hasClosingStockCount: false,
    });
    expect(packaging.getForTradingDay).not.toHaveBeenCalled();
  });

  it('marks a missing closing stock count as advisory', async () => {
    const { prisma, service } = createHarness();
    prisma.tradingDay.findFirst.mockResolvedValue(day);
    prisma.stockCount.findFirst.mockResolvedValue(null);

    await expect(service.getClosingSummary()).resolves.toEqual(
      expect.objectContaining({
        isOpen: true,
        packaging: packagingRows,
        hasClosingStockCount: false,
      }),
    );
  });

  it('lists only the open day movements newest first', async () => {
    const { prisma, service } = createHarness();
    prisma.tradingDay.findFirst.mockResolvedValue(day);
    prisma.cashMovement.findMany.mockResolvedValue([
      {
        id: movementInput.clientGeneratedId,
        tradingDayId: day.id,
        kind: CashMovementKind.EXPENSE,
        amountCents: 750,
        description: 'Cleaning supplies',
        category: 'Supplies',
        recordedByStaffMemberId: closer.id,
        recordedByNameSnapshot: closer.displayName,
        recordedAt: new Date('2026-07-23T09:00:00.000Z'),
      },
    ]);

    await expect(service.getCashMovements()).resolves.toEqual({
      businessDay: expect.objectContaining({
        isOpen: true,
        businessDate: '2026-07-23',
      }),
      movements: [
        {
          id: movementInput.clientGeneratedId,
          tradingDayId: day.id,
          kind: SharedCashMovementKind.EXPENSE,
          amountCents: 750,
          description: 'Cleaning supplies',
          category: 'Supplies',
          recordedByStaffMemberId: closer.id,
          recordedByNameSnapshot: closer.displayName,
          recordedAt: '2026-07-23T09:00:00.000Z',
        },
      ],
    });
    expect(prisma.cashMovement.findMany).toHaveBeenCalledWith({
      where: { tradingDayId: day.id },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('returns an empty movement list when no day is open', async () => {
    const { prisma, service } = createHarness();
    prisma.tradingDay.findFirst.mockResolvedValue(null);

    await expect(service.getCashMovements()).resolves.toEqual({
      businessDay: {
        isOpen: false,
        businessDate: null,
        dayType: null,
        openingFloatCents: null,
        openedByDisplayName: null,
        openedAt: null,
      },
      movements: [],
    });
    expect(prisma.cashMovement.findMany).not.toHaveBeenCalled();
  });

  it.each([
    SharedCashMovementKind.CASH_IN,
    SharedCashMovementKind.CASH_OUT,
    SharedCashMovementKind.EXPENSE,
  ])('records one %s movement against the locked open day', async (kind) => {
    const { prisma, service } = createHarness();
    const input = {
      ...movementInput,
      kind,
      category:
        kind === SharedCashMovementKind.EXPENSE ? '  Supplies  ' : null,
    };
    prisma.tradingDay.findFirst
      .mockResolvedValueOnce(day)
      .mockResolvedValueOnce({ id: day.id });
    prisma.staffMember.findFirst.mockResolvedValue(closer);
    prisma.cashMovement.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        recordedAt: new Date('2026-07-23T09:00:00.000Z'),
      }),
    );

    await expect(service.recordCashMovement(input)).resolves.toEqual(
      expect.objectContaining({
        id: movementInput.clientGeneratedId,
        tradingDayId: day.id,
        kind,
        amountCents: 750,
        description: 'Cleaning supplies',
        category:
          kind === SharedCashMovementKind.EXPENSE ? 'Supplies' : null,
        recordedByNameSnapshot: closer.displayName,
      }),
    );
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.cashMovement.create).toHaveBeenCalledWith({
      data: {
        id: movementInput.clientGeneratedId,
        tradingDayId: day.id,
        kind,
        amountCents: 750,
        description: 'Cleaning supplies',
        category:
          kind === SharedCashMovementKind.EXPENSE ? 'Supplies' : null,
        recordedByStaffMemberId: closer.id,
        recordedByNameSnapshot: closer.displayName,
      },
    });
  });

  it('records an unattributed movement with null attribution', async () => {
    const { prisma, service } = createHarness();
    prisma.tradingDay.findFirst
      .mockResolvedValueOnce(day)
      .mockResolvedValueOnce({ id: day.id });
    prisma.cashMovement.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...data,
        recordedAt: new Date('2026-07-23T09:00:00.000Z'),
      }),
    );

    await service.recordCashMovement({
      ...movementInput,
      recordedByStaffMemberId: undefined,
      category: '   ',
    });

    expect(prisma.staffMember.findFirst).not.toHaveBeenCalled();
    expect(prisma.cashMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category: null,
        recordedByStaffMemberId: null,
        recordedByNameSnapshot: null,
      }),
    });
  });

  it('rejects inactive attribution without writing', async () => {
    const { prisma, service } = createHarness();
    prisma.tradingDay.findFirst
      .mockResolvedValueOnce(day)
      .mockResolvedValueOnce({ id: day.id });
    prisma.staffMember.findFirst.mockResolvedValue(null);

    await expect(
      service.recordCashMovement(movementInput),
    ).rejects.toThrow(
      'recordedByStaffMemberId must reference an active staff member',
    );
    expect(prisma.cashMovement.create).not.toHaveBeenCalled();
  });

  it('replays a movement ID without another write', async () => {
    const { prisma, service } = createHarness();
    prisma.cashMovement.findUnique.mockResolvedValue({
      id: movementInput.clientGeneratedId,
      tradingDayId: day.id,
      kind: CashMovementKind.EXPENSE,
      amountCents: 750,
      description: 'Cleaning supplies',
      category: 'Supplies',
      recordedByStaffMemberId: closer.id,
      recordedByNameSnapshot: 'Original Staff Name',
      recordedAt: new Date('2026-07-23T09:00:00.000Z'),
    });

    await expect(
      service.recordCashMovement(movementInput),
    ).resolves.toEqual(
      expect.objectContaining({
        id: movementInput.clientGeneratedId,
        recordedByNameSnapshot: 'Original Staff Name',
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.cashMovement.create).not.toHaveBeenCalled();
  });

  it('rejects when the selected day closes before the write lock is acquired', async () => {
    const { prisma, service } = createHarness();
    prisma.tradingDay.findFirst
      .mockResolvedValueOnce(day)
      .mockResolvedValueOnce(null);
    prisma.staffMember.findFirst.mockResolvedValue(closer);

    await expect(
      service.recordCashMovement(movementInput),
    ).rejects.toThrow(new ConflictException('No business day is open'));
    expect(prisma.cashMovement.create).not.toHaveBeenCalled();
  });

  it('rejects recording when no business day is open', async () => {
    const { prisma, service } = createHarness();
    prisma.tradingDay.findFirst.mockResolvedValue(null);

    await expect(
      service.recordCashMovement(movementInput),
    ).rejects.toThrow(new ConflictException('No business day is open'));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...movementInput, amountCents: 0 }, 'amountCents'],
    [{ ...movementInput, amountCents: -1 }, 'amountCents'],
    [{ ...movementInput, amountCents: 1.5 }, 'amountCents'],
    [{ ...movementInput, description: '   ' }, 'description'],
    [
      {
        ...movementInput,
        kind: SharedCashMovementKind.CASH_IN,
        category: 'Supplies',
      },
      'category',
    ],
  ])('rejects invalid movement input %# without writing', async (input, field) => {
    const { prisma, service } = createHarness();

    await expect(
      service.recordCashMovement(input as CreateCashMovementDto),
    ).rejects.toThrow(field);
    expect(prisma.cashMovement.findUnique).not.toHaveBeenCalled();
    expect(prisma.cashMovement.create).not.toHaveBeenCalled();
  });

  it('closes once and writes the complete immutable snapshot transaction', async () => {
    const harness = createHarness();
    arrangeSuccessfulClose(harness);

    await expect(harness.service.close(closeInput)).resolves.toEqual(
      expect.objectContaining({
        id: closeInput.clientGeneratedId,
        expectedCashCents: 61100,
        actualCashCents: 62000,
        varianceCents: 900,
        closedByNameSnapshot: closer.displayName,
        lines: [
          expect.objectContaining({
            itemNameSnapshot: '12 oz cup',
            expectedQty: 18,
            actualQty: 17,
            varianceQty: -1,
          }),
        ],
      }),
    );
    expect(harness.prisma.tradingDay.updateMany).toHaveBeenCalledWith({
      where: {
        id: day.id,
        status: TradingDayStatus.OPEN,
      },
      data: {
        status: TradingDayStatus.CLOSED,
        closedAt: expect.any(Date),
        closedByStaffMemberId: closer.id,
      },
    });
    expect(harness.prisma.cashCount.create).toHaveBeenCalledWith({
      data: {
        tradingDayId: day.id,
        countedCents: 62000,
        countedAt: expect.any(Date),
        countedByStaffMemberId: closer.id,
      },
      select: { id: true },
    });
    expect(harness.prisma.dayClosing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: closeInput.clientGeneratedId,
        tradingDayId: day.id,
        openingFloatCents: 50000,
        cashSalesCents: 10000,
        onlineSalesCents: 2000,
        cashTipsCents: 500,
        cashInCents: 1000,
        cashOutCents: 200,
        cashExpensesCents: 300,
        outstandingChangeCents: 100,
        expectedCashCents: 61100,
        actualCashCents: 62000,
        varianceCents: 900,
        varianceReason: null,
        closedByStaffMemberId: closer.id,
        closedByNameSnapshot: closer.displayName,
        lines: {
          create: [
            {
              inventoryItemId: packagingRows[0]!.inventoryItemId,
              itemNameSnapshot: '12 oz cup',
              expectedQty: 18,
              actualQty: 17,
              varianceQty: -1,
            },
          ],
        },
      }),
      include: expect.any(Object),
    });
  });

  it('replays a close client ID without any additional writes', async () => {
    const { prisma, service } = createHarness();
    prisma.dayClosing.findUnique.mockResolvedValue(closingRecord());

    await expect(service.close(closeInput)).resolves.toEqual(
      expect.objectContaining({ id: closeInput.clientGeneratedId }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.cashCount.create).not.toHaveBeenCalled();
    expect(prisma.dayClosing.create).not.toHaveBeenCalled();
  });

  it('returns the existing closing when a concurrent request loses the transition', async () => {
    const { prisma, service } = createHarness();
    const existing = closingRecord({
      id: '80000000-0000-4000-8000-000000000001',
    });
    prisma.dayClosing.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    prisma.tradingDay.findFirst.mockResolvedValue(day);
    prisma.tradingDay.findUnique.mockResolvedValue({
      ...day,
      status: TradingDayStatus.OPEN,
    });
    prisma.staffMember.findFirst.mockResolvedValue(closer);
    prisma.tradingDay.updateMany.mockResolvedValue({ count: 0 });
    arrangeCash(prisma);

    await expect(service.close(closeInput)).resolves.toEqual(
      expect.objectContaining({ id: existing.id }),
    );
    expect(prisma.cashCount.create).not.toHaveBeenCalled();
    expect(prisma.dayClosing.create).not.toHaveBeenCalled();
  });

  it('closes without a closing stock count and preserves null line values', async () => {
    const harness = createHarness();
    harness.packaging.getForTradingDay.mockResolvedValue([
      {
        ...packagingRows[0],
        expectedQty: null,
        actualQty: null,
        varianceQty: null,
      },
    ]);
    arrangeSuccessfulClose(
      harness,
      closingRecord({
        lines: [
          {
            id: '70000000-0000-4000-8000-000000000001',
            dayClosingId: closeInput.clientGeneratedId,
            inventoryItemId: packagingRows[0]!.inventoryItemId,
            itemNameSnapshot: '12 oz cup',
            expectedQty: null,
            actualQty: null,
            varianceQty: null,
          },
        ],
      }),
    );

    await expect(harness.service.close(closeInput)).resolves.toEqual(
      expect.objectContaining({
        lines: [
          expect.objectContaining({
            expectedQty: null,
            actualQty: null,
            varianceQty: null,
          }),
        ],
      }),
    );
    expect(harness.prisma.dayClosing.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lines: {
            create: [
              expect.objectContaining({
                expectedQty: null,
                actualQty: null,
                varianceQty: null,
              }),
            ],
          },
        }),
      }),
    );
  });

  it('allows a non-zero variance without a reason', async () => {
    const harness = createHarness();
    arrangeSuccessfulClose(harness);

    await expect(harness.service.close(closeInput)).resolves.toEqual(
      expect.objectContaining({
        varianceCents: 900,
        varianceReason: null,
      }),
    );
  });

  it('rejects an unknown or inactive closer without writing', async () => {
    const { prisma, service } = createHarness();
    prisma.dayClosing.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    prisma.tradingDay.findFirst.mockResolvedValue(day);
    prisma.tradingDay.findUnique.mockResolvedValue({
      ...day,
      status: TradingDayStatus.OPEN,
    });
    prisma.staffMember.findFirst.mockResolvedValue(null);

    await expect(service.close(closeInput)).rejects.toThrow(
      'closedByStaffMemberId must reference an active staff member',
    );
    expect(prisma.tradingDay.updateMany).not.toHaveBeenCalled();
    expect(prisma.cashCount.create).not.toHaveBeenCalled();
    expect(prisma.dayClosing.create).not.toHaveBeenCalled();
  });

  it('rejects closing when no day is open', async () => {
    const { prisma, service } = createHarness();
    prisma.dayClosing.findUnique.mockResolvedValue(null);
    prisma.tradingDay.findFirst.mockResolvedValue(null);

    await expect(service.close(closeInput)).rejects.toThrow(
      new ConflictException('No business day is open'),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...closeInput, actualCashCents: -1 }, 'actualCashCents'],
    [{ ...closeInput, actualCashCents: 1.5 }, 'actualCashCents'],
    [{ ...closeInput, clientGeneratedId: '' }, 'clientGeneratedId'],
    [
      { ...closeInput, closedByStaffMemberId: '' },
      'closedByStaffMemberId',
    ],
  ])('rejects invalid close input %#', async (invalid, message) => {
    const { prisma, service } = createHarness();

    await expect(
      service.close(invalid as CloseBusinessDayDto),
    ).rejects.toThrow(message);
    expect(prisma.dayClosing.findUnique).not.toHaveBeenCalled();
  });

  it('uses bad-request domain errors for invalid monetary input', async () => {
    const { service } = createHarness();

    await expect(
      service.close({
        ...closeInput,
        actualCashCents:
          Number.NaN as CloseBusinessDayDto['actualCashCents'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
