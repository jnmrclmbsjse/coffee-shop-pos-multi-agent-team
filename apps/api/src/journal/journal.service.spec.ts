import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { JournalSuggestionKind } from '@coffee-shop/shared';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { ReportingService } from '../reporting/reporting.service';
import { JournalService } from './journal.service';

describe('JournalService', () => {
  const ledgerId = '9e55c455-879c-4ea8-8365-433e0e2cf4a3';
  const depositId = '190d7f48-9389-4a6d-9348-fe056148bb97';
  const withdrawalId = '378de65f-e46d-45eb-a5c2-9d35cfe95d94';
  const adminUserId = '44fc441b-a59f-45c3-b7ae-7ea93d1b06d3';
  const updatedAdminUserId = '3e428f7e-d295-45a4-9fe7-c9c8e39f2b46';
  const locationId = '0dd85c48-9de0-405e-a899-803108c161d4';
  const now = new Date('2026-10-04T08:00:00.000Z');
  const deposit = {
    id: depositId,
    ledgerId,
    businessDate: new Date('2026-10-02T00:00:00.000Z'),
    amountCents: 0,
    note: null,
    locationId,
    recordedByUserId: adminUserId,
    recordedAt: now,
    updatedByUserId: adminUserId,
    updatedAt: now,
  };
  const withdrawal = {
    id: withdrawalId,
    ledgerId,
    withdrawnOn: new Date('2026-10-03T00:00:00.000Z'),
    amountCents: 1_500,
    note: 'Supplies',
    locationId,
    recordedByUserId: adminUserId,
    recordedAt: now,
    updatedByUserId: adminUserId,
    updatedAt: now,
  };
  const ledger = {
    id: ledgerId,
    name: 'Rent',
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    startingBalanceCents: 1_000,
    suggestionKind: 'RENT_PERCENT_OF_ROUNDED_GROSS' as const,
    isBuiltIn: true,
    locationId,
    createdAt: now,
    deposits: [deposit],
    withdrawals: [withdrawal],
  };

  function prismaError(code: string): Error {
    return new Prisma.PrismaClientKnownRequestError('Database error', {
      code,
      clientVersion: '6.19.0',
    });
  }

  function setup(options: {
    ledgerResult?: typeof ledger | null;
    duplicateLedger?: boolean;
    ledgerCreateError?: Error;
    depositCreateError?: Error;
    depositUpdateError?: Error;
    depositDeleteError?: Error;
    depositResult?: (typeof deposit & { ledger: typeof ledger }) | null;
    withdrawalUpdateError?: Error;
    withdrawalDeleteError?: Error;
    closedDay?: boolean;
  } = {}) {
    const ledgerResult =
      options.ledgerResult === undefined ? ledger : options.ledgerResult;
    const prisma = {
      journalLedger: {
        findMany: jest.fn().mockResolvedValue(ledgerResult ? [ledgerResult] : []),
        findFirst: jest
          .fn()
          .mockResolvedValue(options.duplicateLedger ? { id: ledgerId } : null),
        findUnique: jest.fn().mockResolvedValue(ledgerResult),
        create: options.ledgerCreateError
          ? jest.fn().mockRejectedValue(options.ledgerCreateError)
          : jest.fn().mockResolvedValue({
              ...ledger,
              name: 'Equipment',
              suggestionKind: 'NONE' as const,
              isBuiltIn: false,
              deposits: [],
              withdrawals: [],
            }),
      },
      journalDeposit: {
        findUnique: jest.fn().mockResolvedValue(
          options.depositResult === undefined
            ? { ...deposit, ledger }
            : options.depositResult,
        ),
        create: options.depositCreateError
          ? jest.fn().mockRejectedValue(options.depositCreateError)
          : jest.fn().mockResolvedValue(deposit),
        update: options.depositUpdateError
          ? jest.fn().mockRejectedValue(options.depositUpdateError)
          : jest.fn().mockResolvedValue({
              ...deposit,
              businessDate: new Date('2026-10-03T00:00:00.000Z'),
              amountCents: 250,
              updatedByUserId: updatedAdminUserId,
            }),
        delete: options.depositDeleteError
          ? jest.fn().mockRejectedValue(options.depositDeleteError)
          : jest.fn().mockResolvedValue(deposit),
      },
      journalWithdrawal: {
        create: jest.fn().mockResolvedValue(withdrawal),
        update: options.withdrawalUpdateError
          ? jest.fn().mockRejectedValue(options.withdrawalUpdateError)
          : jest.fn().mockResolvedValue({
              ...withdrawal,
              amountCents: 99_999,
              updatedByUserId: updatedAdminUserId,
            }),
        delete: options.withdrawalDeleteError
          ? jest.fn().mockRejectedValue(options.withdrawalDeleteError)
          : jest.fn().mockResolvedValue(withdrawal),
      },
    };
    const reportingService = {
      getClosedDailyGross: jest.fn().mockResolvedValue(
        options.closedDay === false
          ? []
          : [{ businessDate: '2026-10-02', grossSalesCents: 50_000 }],
      ),
    };

    return {
      prisma,
      reportingService,
      service: new JournalService(
        prisma as unknown as PrismaService,
        reportingService as unknown as ReportingService,
      ),
    };
  }

  it('computes balances over complete ledger history and returns detail rows', async () => {
    const { service } = setup();

    await expect(service.listLedgers()).resolves.toEqual([
      expect.objectContaining({
        id: ledgerId,
        balanceCents: -500,
        startingBalanceCents: 1_000,
      }),
    ]);
    await expect(service.getLedger(ledgerId)).resolves.toEqual(
      expect.objectContaining({
        balanceCents: -500,
        deposits: [expect.objectContaining({ amountCents: 0 })],
        withdrawals: [expect.objectContaining({ amountCents: 1_500 })],
      }),
    );
  });

  it('creates a fully manual ledger and preserves an explicit zero balance', async () => {
    const { prisma, service } = setup();

    await service.createLedger({
      name: 'Equipment',
      startDate: '2026-10-01',
      startingBalanceCents: 0,
    } as never);

    expect(prisma.journalLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          startingBalanceCents: 0,
          suggestionKind: JournalSuggestionKind.NONE,
          isBuiltIn: false,
        }),
      }),
    );
  });

  it.each([
    ['preflight', { duplicateLedger: true }],
    ['concurrent write', { ledgerCreateError: prismaError('P2002') }],
  ] as const)('refuses a case-insensitive duplicate ledger name at %s', async (_case, options) => {
    const { service } = setup(options);

    await expect(
      service.createLedger({ name: 'rent', startDate: '2026-10-01' } as never),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        field: 'name',
        reason: 'DUPLICATE_JOURNAL_LEDGER_NAME',
      }),
    });
  });

  it('persists a zero deposit verbatim and inherits the ledger location', async () => {
    const { prisma, service } = setup();

    await service.createDeposit(
      ledgerId,
      { businessDate: '2026-10-02', amountCents: 0, note: '   ' } as never,
      adminUserId,
    );

    expect(prisma.journalDeposit.create).toHaveBeenCalledWith({
      data: {
        ledgerId,
        businessDate: new Date('2026-10-02T00:00:00.000Z'),
        amountCents: 0,
        note: null,
        locationId,
        recordedByUserId: adminUserId,
        updatedByUserId: adminUserId,
      },
    });
  });

  it('refuses a deposit before the ledger start date without querying sales', async () => {
    const { reportingService, service } = setup();

    await expect(
      service.createDeposit(
        ledgerId,
        { businessDate: '2026-09-30', amountCents: 1 } as never,
        adminUserId,
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ reason: 'BEFORE_LEDGER_START_DATE' }),
    });
    expect(reportingService.getClosedDailyGross).not.toHaveBeenCalled();
  });

  it('refuses an open, future, or absent business day', async () => {
    const { service } = setup({ closedDay: false });

    await expect(
      service.createDeposit(
        ledgerId,
        { businessDate: '2026-10-02', amountCents: 1 } as never,
        adminUserId,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps a duplicate deposit create or edit to 409 without overwriting it', async () => {
    const createSetup = setup({ depositCreateError: prismaError('P2002') });
    const updateSetup = setup({ depositUpdateError: prismaError('P2002') });

    await expect(
      createSetup.service.createDeposit(
        ledgerId,
        { businessDate: '2026-10-02', amountCents: 1 } as never,
        adminUserId,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      updateSetup.service.updateDeposit(
        depositId,
        { businessDate: '2026-10-02', amountCents: 1 } as never,
        updatedAdminUserId,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ reason: 'DUPLICATE_JOURNAL_DEPOSIT' }),
    });
  });

  it('sets deposit edit audit fields and allows a real row delete', async () => {
    const { prisma, reportingService, service } = setup();
    reportingService.getClosedDailyGross.mockResolvedValue([
      { businessDate: '2026-10-03', grossSalesCents: 60_000 },
    ]);

    await service.updateDeposit(
      depositId,
      { businessDate: '2026-10-03', amountCents: 250, note: ' Saved ' } as never,
      updatedAdminUserId,
    );
    await service.removeDeposit(depositId);

    expect(prisma.journalDeposit.update).toHaveBeenCalledWith({
      where: { id: depositId },
      data: {
        businessDate: new Date('2026-10-03T00:00:00.000Z'),
        amountCents: 250,
        note: 'Saved',
        updatedByUserId: updatedAdminUserId,
      },
    });
    expect(prisma.journalDeposit.delete).toHaveBeenCalledWith({
      where: { id: depositId },
    });
  });

  it('allows a withdrawal larger than the balance and audits edits', async () => {
    const { prisma, service } = setup();

    await service.createWithdrawal(
      ledgerId,
      { withdrawnOn: '2026-10-03', amountCents: 99_999 } as never,
      adminUserId,
    );
    await service.updateWithdrawal(
      withdrawalId,
      { withdrawnOn: '2026-10-03', amountCents: 99_999 } as never,
      updatedAdminUserId,
    );

    expect(prisma.journalWithdrawal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amountCents: 99_999 }),
      }),
    );
    expect(prisma.journalWithdrawal.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amountCents: 99_999,
          updatedByUserId: updatedAdminUserId,
        }),
      }),
    );
  });

  it.each([
    ['ledger read', () => setup({ ledgerResult: null }).service.getLedger(ledgerId)],
    ['deposit edit', () => setup({ depositResult: null }).service.updateDeposit(depositId, { businessDate: '2026-10-02', amountCents: 1 } as never, adminUserId)],
    ['deposit delete', () => setup({ depositDeleteError: prismaError('P2025') }).service.removeDeposit(depositId)],
    ['withdrawal edit', () => setup({ withdrawalUpdateError: prismaError('P2025') }).service.updateWithdrawal(withdrawalId, { withdrawnOn: '2026-10-03', amountCents: 1 } as never, adminUserId)],
    ['withdrawal delete', () => setup({ withdrawalDeleteError: prismaError('P2025') }).service.removeWithdrawal(withdrawalId)],
  ] as const)('maps a missing row on %s to 404', async (_case, operation) => {
    await expect(operation()).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('JournalService suggestions, rates and bulk catch-up', () => {
  const ledgerId = '9e55c455-879c-4ea8-8365-433e0e2cf4a3';
  const adminUserId = '44fc441b-a59f-45c3-b7ae-7ea93d1b06d3';
  const today = '2026-10-10';
  const date = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date(`${today}T08:30:00.000Z`));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  function rateRow(
    effectiveFrom: string,
    fields: {
      rentPercentBasisPoints?: number | null;
      chairAmountCents?: number | null;
      chairThresholdCents?: number | null;
    },
  ) {
    return {
      id: `rate-${effectiveFrom}`,
      ledgerId,
      effectiveFrom: date(effectiveFrom),
      rentPercentBasisPoints: fields.rentPercentBasisPoints ?? null,
      chairAmountCents: fields.chairAmountCents ?? null,
      chairThresholdCents: fields.chairThresholdCents ?? null,
      locationId: null,
      createdByUserId: adminUserId,
      createdAt: date(effectiveFrom),
    };
  }

  function setup(options: {
    suggestionKind?: JournalSuggestionKind;
    startDate?: string;
    rates?: ReturnType<typeof rateRow>[];
    closedDays?: { businessDate: string; grossSalesCents: number }[];
    recordedDates?: string[];
    depositCreateError?: Error;
  } = {}) {
    const suggestionKind =
      options.suggestionKind ??
      JournalSuggestionKind.RENT_PERCENT_OF_ROUNDED_GROSS;
    const ledger = {
      id: ledgerId,
      name: suggestionKind === JournalSuggestionKind.NONE ? 'Equipment' : 'Rent',
      startDate: date(options.startDate ?? '2026-10-01'),
      startingBalanceCents: 0,
      suggestionKind,
      isBuiltIn: suggestionKind !== JournalSuggestionKind.NONE,
      locationId: null,
      createdAt: date('2026-10-01'),
    };
    const prisma = {
      journalLedger: {
        findUnique: jest.fn().mockResolvedValue(ledger),
      },
      journalDeposit: {
        findMany: jest.fn().mockResolvedValue(
          (options.recordedDates ?? []).map((businessDate) => ({
            businessDate: date(businessDate),
          })),
        ),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
          options.depositCreateError
            ? Promise.reject(options.depositCreateError)
            : Promise.resolve({
                id: `deposit-${String(data.businessDate)}`,
                note: null,
                recordedAt: date(today),
                updatedAt: date(today),
                ...data,
              }),
        ),
      },
      journalSuggestionRate: {
        findMany: jest.fn().mockResolvedValue(options.rates ?? []),
        findFirst: jest.fn().mockImplementation(() => {
          const rates = [...(options.rates ?? [])].sort(
            (left, right) =>
              right.effectiveFrom.getTime() - left.effectiveFrom.getTime(),
          );
          return Promise.resolve(
            rates.find(
              (rate) => rate.effectiveFrom.getTime() <= date(today).getTime(),
            ) ?? null,
          );
        }),
        upsert: jest.fn(
          ({
            where,
            create,
          }: {
            where: { ledgerId_effectiveFrom: { effectiveFrom: Date } };
            create: Record<string, unknown>;
            update: Record<string, unknown>;
          }) =>
            Promise.resolve({
              id: 'rate-upserted',
              locationId: null,
              createdByUserId: adminUserId,
              createdAt: date(today),
              rentPercentBasisPoints: null,
              chairAmountCents: null,
              chairThresholdCents: null,
              ...create,
              effectiveFrom: where.ledgerId_effectiveFrom.effectiveFrom,
            }),
        ),
      },
      $transaction: jest.fn((operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    };
    const reportingService = {
      getClosedDailyGross: jest
        .fn()
        .mockResolvedValue(options.closedDays ?? []),
    };

    return {
      ledger,
      prisma,
      reportingService,
      service: new JournalService(
        prisma as unknown as PrismaService,
        reportingService as unknown as ReportingService,
      ),
    };
  }

  it('suggests each day at the rate in force on its own business date', async () => {
    const { prisma, reportingService, service } = setup({
      rates: [
        rateRow('2026-10-01', { rentPercentBasisPoints: 1_000 }),
        rateRow('2026-10-05', { rentPercentBasisPoints: 1_500 }),
      ],
      closedDays: [
        { businessDate: '2026-10-05', grossSalesCents: 780_000 },
        { businessDate: '2026-10-04', grossSalesCents: 780_000 },
      ],
    });

    await expect(service.getMissingDays(ledgerId)).resolves.toEqual([
      {
        businessDate: '2026-10-04',
        grossSalesCents: 780_000,
        suggestedAmountCents: 80_000,
      },
      {
        businessDate: '2026-10-05',
        grossSalesCents: 780_000,
        suggestedAmountCents: 120_000,
      },
    ]);
    expect(reportingService.getClosedDailyGross).toHaveBeenCalledWith(
      '2026-10-01',
      today,
    );
    expect(prisma.journalDeposit.findMany).toHaveBeenCalledWith({
      where: { ledgerId },
      select: { businessDate: true },
    });
  });

  it('excludes a day that already has a deposit, including a zero-peso one', async () => {
    const { service } = setup({
      rates: [rateRow('2026-10-01', { rentPercentBasisPoints: 1_000 })],
      closedDays: [
        { businessDate: '2026-10-02', grossSalesCents: 760_000 },
        { businessDate: '2026-10-03', grossSalesCents: 760_000 },
      ],
      recordedDates: ['2026-10-02'],
    });

    await expect(service.getMissingDays(ledgerId)).resolves.toEqual([
      {
        businessDate: '2026-10-03',
        grossSalesCents: 760_000,
        suggestedAmountCents: 70_000,
      },
    ]);
  });

  it('keeps a zero-peso Chair suggestion distinct from a manual ledger null', async () => {
    const chair = setup({
      suggestionKind: JournalSuggestionKind.CHAIR_FLAT_ABOVE_THRESHOLD,
      rates: [
        rateRow('2026-10-01', {
          chairAmountCents: 10_000,
          chairThresholdCents: 300_000,
        }),
      ],
      closedDays: [
        { businessDate: '2026-10-02', grossSalesCents: 299_999 },
        { businessDate: '2026-10-03', grossSalesCents: 300_000 },
      ],
    });

    await expect(chair.service.getMissingDays(ledgerId)).resolves.toEqual([
      {
        businessDate: '2026-10-02',
        grossSalesCents: 299_999,
        suggestedAmountCents: 0,
      },
      {
        businessDate: '2026-10-03',
        grossSalesCents: 300_000,
        suggestedAmountCents: 10_000,
      },
    ]);

    const manual = setup({
      suggestionKind: JournalSuggestionKind.NONE,
      closedDays: [
        { businessDate: '2026-10-02', grossSalesCents: 299_999 },
        { businessDate: '2026-10-03', grossSalesCents: 300_000 },
      ],
    });

    await expect(manual.service.getMissingDays(ledgerId)).resolves.toEqual([
      {
        businessDate: '2026-10-02',
        grossSalesCents: 299_999,
        suggestedAmountCents: null,
      },
      {
        businessDate: '2026-10-03',
        grossSalesCents: 300_000,
        suggestedAmountCents: null,
      },
    ]);
    expect(manual.prisma.journalSuggestionRate.findMany).not.toHaveBeenCalled();
  });

  it('lists only the closed days the reporting seam returns', async () => {
    const { service } = setup({
      rates: [rateRow('2026-10-01', { rentPercentBasisPoints: 1_000 })],
      closedDays: [{ businessDate: '2026-10-02', grossSalesCents: 760_000 }],
    });

    await expect(service.getMissingDays(ledgerId)).resolves.toEqual([
      expect.objectContaining({ businessDate: '2026-10-02' }),
    ]);
  });

  it('suggests nothing for a business date before the ledger has any rate row', async () => {
    const { service } = setup({
      rates: [rateRow('2026-10-05', { rentPercentBasisPoints: 1_000 })],
      closedDays: [{ businessDate: '2026-10-02', grossSalesCents: 760_000 }],
    });

    await expect(service.getMissingDays(ledgerId)).resolves.toEqual([
      {
        businessDate: '2026-10-02',
        grossSalesCents: 760_000,
        suggestedAmountCents: null,
      },
    ]);
  });

  it('asks reporting for nothing when the ledger starts after today', async () => {
    const { reportingService, service } = setup({ startDate: '2026-12-01' });

    await expect(service.getMissingDays(ledgerId)).resolves.toEqual([]);
    expect(reportingService.getClosedDailyGross).not.toHaveBeenCalled();
  });

  it('returns the rate in force today, and none at all for a manual ledger', async () => {
    const rent = setup({
      rates: [
        rateRow('2026-10-01', { rentPercentBasisPoints: 1_000 }),
        rateRow('2026-10-08', { rentPercentBasisPoints: 1_500 }),
      ],
    });

    await expect(rent.service.getRate(ledgerId)).resolves.toMatchObject({
      effectiveFrom: '2026-10-08',
      rentPercentBasisPoints: 1_500,
      chairAmountCents: null,
    });

    const manual = setup({ suggestionKind: JournalSuggestionKind.NONE });
    await expect(manual.service.getRate(ledgerId)).resolves.toBeNull();
    expect(
      manual.prisma.journalSuggestionRate.findFirst,
    ).not.toHaveBeenCalled();
  });

  it('writes a rate change as a new row effective from today, never backdated', async () => {
    const { prisma, service } = setup();

    await expect(
      service.updateRate(
        ledgerId,
        { rentPercentBasisPoints: 1_500 },
        adminUserId,
      ),
    ).resolves.toMatchObject({
      effectiveFrom: today,
      rentPercentBasisPoints: 1_500,
    });

    expect(prisma.journalSuggestionRate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ledgerId_effectiveFrom: { ledgerId, effectiveFrom: date(today) },
        },
        create: expect.objectContaining({
          ledgerId,
          effectiveFrom: date(today),
          rentPercentBasisPoints: 1_500,
          chairAmountCents: null,
          chairThresholdCents: null,
          createdByUserId: adminUserId,
        }),
        update: expect.objectContaining({ rentPercentBasisPoints: 1_500 }),
      }),
    );
  });

  // Manila is UTC+8, so between 00:00 and 08:00 shop time the UTC date is
  // still yesterday — an already-closed business day. Pinning the clock inside
  // that window is the only way this bites.
  describe('inside the 00:00-08:00 Asia/Manila window', () => {
    const utcYesterday = '2026-10-09';

    beforeEach(() => {
      jest.setSystemTime(new Date(`${utcYesterday}T17:30:00.000Z`));
    });

    afterEach(() => {
      jest.setSystemTime(new Date(`${today}T08:30:00.000Z`));
    });

    it('dates a rate change by the shop calendar, not by UTC', async () => {
      const { prisma, service } = setup();

      await expect(
        service.updateRate(
          ledgerId,
          { rentPercentBasisPoints: 1_500 },
          adminUserId,
        ),
      ).resolves.toMatchObject({ effectiveFrom: today });

      const where = prisma.journalSuggestionRate.upsert.mock.calls[0]![0].where;
      expect(where).toEqual({
        ledgerId_effectiveFrom: { ledgerId, effectiveFrom: date(today) },
      });
      expect(where.ledgerId_effectiveFrom.effectiveFrom).not.toEqual(
        date(utcYesterday),
      );
    });

    it('bounds missing-days and the rate in force by the shop calendar', async () => {
      const { prisma, reportingService, service } = setup({
        rates: [rateRow(today, { rentPercentBasisPoints: 1_000 })],
      });

      await service.getMissingDays(ledgerId);
      expect(reportingService.getClosedDailyGross).toHaveBeenCalledWith(
        '2026-10-01',
        today,
      );

      // A rate effective today is in force today; under the UTC date it would
      // read as a future row and `getRate` would return null.
      await expect(service.getRate(ledgerId)).resolves.toMatchObject({
        effectiveFrom: today,
        rentPercentBasisPoints: 1_000,
      });
      expect(
        prisma.journalSuggestionRate.findFirst.mock.calls[0]![0],
      ).toMatchObject({
        where: expect.objectContaining({
          effectiveFrom: { lte: date(today) },
        }),
      });
    });
  });

  it('upserts the same day on a second change so no earlier day moves', async () => {
    const { prisma, service } = setup();

    await service.updateRate(
      ledgerId,
      { rentPercentBasisPoints: 1_200 },
      adminUserId,
    );
    await service.updateRate(
      ledgerId,
      { rentPercentBasisPoints: 1_800 },
      adminUserId,
    );

    expect(prisma.journalSuggestionRate.upsert).toHaveBeenCalledTimes(2);
    for (const call of prisma.journalSuggestionRate.upsert.mock.calls) {
      expect(call[0]!.where).toEqual({
        ledgerId_effectiveFrom: { ledgerId, effectiveFrom: date(today) },
      });
    }
    expect(
      prisma.journalSuggestionRate.upsert.mock.calls[1]![0].update,
    ).toMatchObject({ rentPercentBasisPoints: 1_800 });
  });

  it('refuses a rate on a fully manual ledger', async () => {
    const { prisma, service } = setup({
      suggestionKind: JournalSuggestionKind.NONE,
    });

    await expect(
      service.updateRate(
        ledgerId,
        { rentPercentBasisPoints: 1_000 },
        adminUserId,
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        reason: 'LEDGER_HAS_NO_SUGGESTION_RATE',
      }),
    });
    expect(prisma.journalSuggestionRate.upsert).not.toHaveBeenCalled();
  });

  it('refuses a rate field that does not belong to the ledger kind', async () => {
    const rent = setup();
    await expect(
      rent.service.updateRate(
        ledgerId,
        {
          rentPercentBasisPoints: 1_000,
          chairAmountCents: 10_000,
        } as never,
        adminUserId,
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        field: 'chairAmountCents',
        reason: 'RATE_FIELD_NOT_APPLICABLE',
      }),
    });

    const chair = setup({
      suggestionKind: JournalSuggestionKind.CHAIR_FLAT_ABOVE_THRESHOLD,
    });
    await expect(
      chair.service.updateRate(
        ledgerId,
        { chairAmountCents: 10_000 } as never,
        adminUserId,
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        field: 'chairThresholdCents',
        reason: 'RATE_FIELD_REQUIRED',
      }),
    });
  });

  it('writes every selected day, including a zero, in one transaction', async () => {
    const { prisma, service } = setup({
      closedDays: [
        { businessDate: '2026-10-02', grossSalesCents: 760_000 },
        { businessDate: '2026-10-03', grossSalesCents: 10_000 },
      ],
    });

    await expect(
      service.createDepositsBulk(
        ledgerId,
        {
          deposits: [
            { businessDate: '2026-10-03', amountCents: 0, note: '  ' },
            { businessDate: '2026-10-02', amountCents: 70_000 },
          ],
        } as never,
        adminUserId,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        businessDate: '2026-10-02',
        amountCents: 70_000,
      }),
      expect.objectContaining({ businessDate: '2026-10-03', amountCents: 0 }),
    ]);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.journalDeposit.create).toHaveBeenCalledTimes(2);
    expect(prisma.journalDeposit.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          businessDate: date('2026-10-02'),
          amountCents: 70_000,
        }),
      }),
    );
    expect(prisma.journalDeposit.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          businessDate: date('2026-10-03'),
          amountCents: 0,
          note: null,
        }),
      }),
    );
  });

  it('rolls the whole batch back with a 409 when a day was recorded meanwhile', async () => {
    const { service } = setup({
      closedDays: [
        { businessDate: '2026-10-02', grossSalesCents: 760_000 },
        { businessDate: '2026-10-03', grossSalesCents: 10_000 },
      ],
      depositCreateError: new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed',
        { code: 'P2002', clientVersion: '6.19.0' },
      ),
    });

    await expect(
      service.createDepositsBulk(
        ledgerId,
        {
          deposits: [
            { businessDate: '2026-10-02', amountCents: 70_000 },
            { businessDate: '2026-10-03', amountCents: 0 },
          ],
        } as never,
        adminUserId,
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        reason: 'DUPLICATE_JOURNAL_DEPOSIT',
      }),
    });
  });

  it('refuses a batch holding an open day or a day before the start date', async () => {
    const openDay = setup({
      closedDays: [{ businessDate: '2026-10-02', grossSalesCents: 760_000 }],
    });
    await expect(
      openDay.service.createDepositsBulk(
        ledgerId,
        {
          deposits: [
            { businessDate: '2026-10-02', amountCents: 70_000 },
            { businessDate: '2026-10-03', amountCents: 0 },
          ],
        } as never,
        adminUserId,
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        reason: 'BUSINESS_DAY_NOT_CLOSED',
        businessDate: '2026-10-03',
      }),
    });
    expect(openDay.prisma.$transaction).not.toHaveBeenCalled();

    const early = setup();
    await expect(
      early.service.createDepositsBulk(
        ledgerId,
        {
          deposits: [{ businessDate: '2026-09-30', amountCents: 0 }],
        } as never,
        adminUserId,
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({
        reason: 'BEFORE_LEDGER_START_DATE',
        businessDate: '2026-09-30',
      }),
    });
    expect(early.reportingService.getClosedDailyGross).not.toHaveBeenCalled();
  });

  it('refuses a batch that lists the same business day twice', async () => {
    const { prisma, reportingService, service } = setup();

    await expect(
      service.createDepositsBulk(
        ledgerId,
        {
          deposits: [
            { businessDate: '2026-10-02', amountCents: 70_000 },
            { businessDate: '2026-10-02', amountCents: 0 },
          ],
        } as never,
        adminUserId,
      ),
    ).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ reason: 'REPEATED_BUSINESS_DATE' }),
    });
    expect(reportingService.getClosedDailyGross).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
