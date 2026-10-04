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
