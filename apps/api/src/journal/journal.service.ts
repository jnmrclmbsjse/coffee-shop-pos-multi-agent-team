import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  addMoney,
  cents,
  type JournalDeposit,
  type JournalLedger,
  type JournalLedgerBalance,
  JournalSuggestionKind,
  type JournalWithdrawal,
} from '@coffee-shop/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportingService } from '../reporting/reporting.service';
import type {
  CreateJournalDepositDto,
  CreateJournalLedgerDto,
  CreateJournalWithdrawalDto,
  UpdateJournalDepositDto,
  UpdateJournalWithdrawalDto,
} from './journal.dto';

const ISO_DATE_LENGTH = 10;

const ledgerActivityInclude = {
  deposits: {
    orderBy: [{ businessDate: 'desc' }, { recordedAt: 'desc' }],
  },
  withdrawals: {
    orderBy: [{ withdrawnOn: 'desc' }, { recordedAt: 'desc' }],
  },
} satisfies Prisma.JournalLedgerInclude;

type LedgerActivityRecord = Prisma.JournalLedgerGetPayload<{
  include: typeof ledgerActivityInclude;
}>;
type DepositRecord = Prisma.JournalDepositGetPayload<object>;
type WithdrawalRecord = Prisma.JournalWithdrawalGetPayload<object>;

export interface JournalLedgerDetail extends JournalLedgerBalance {
  deposits: JournalDeposit[];
  withdrawals: JournalWithdrawal[];
}

@Injectable()
export class JournalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportingService: ReportingService,
  ) {}

  async listLedgers(): Promise<JournalLedgerBalance[]> {
    const ledgers = await this.prisma.journalLedger.findMany({
      include: ledgerActivityInclude,
      orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }],
    });

    return ledgers.map((ledger) => this.toLedgerBalance(ledger));
  }

  async createLedger(
    input: CreateJournalLedgerDto,
  ): Promise<JournalLedgerBalance> {
    const duplicate = await this.prisma.journalLedger.findFirst({
      where: { name: { equals: input.name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (duplicate) {
      throw this.duplicateLedgerName(input.name);
    }

    try {
      const ledger = await this.prisma.journalLedger.create({
        data: {
          name: input.name,
          startDate: this.toDate(input.startDate),
          startingBalanceCents: input.startingBalanceCents ?? 0,
          suggestionKind: JournalSuggestionKind.NONE,
          isBuiltIn: false,
          locationId: null,
        },
        include: ledgerActivityInclude,
      });

      return this.toLedgerBalance(ledger);
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw this.duplicateLedgerName(input.name);
      }
      throw error;
    }
  }

  async getLedger(id: string): Promise<JournalLedgerDetail> {
    const ledger = await this.prisma.journalLedger.findUnique({
      where: { id },
      include: ledgerActivityInclude,
    });
    if (!ledger) {
      throw new NotFoundException('Journal ledger not found');
    }

    return {
      ...this.toLedgerBalance(ledger),
      deposits: ledger.deposits.map((deposit) => this.toDeposit(deposit)),
      withdrawals: ledger.withdrawals.map((withdrawal) =>
        this.toWithdrawal(withdrawal),
      ),
    };
  }

  async createDeposit(
    ledgerId: string,
    input: CreateJournalDepositDto,
    userId: string,
  ): Promise<JournalDeposit> {
    const ledger = await this.requireLedger(ledgerId);
    await this.assertEligibleDepositDate(ledger, input.businessDate);

    try {
      const deposit = await this.prisma.journalDeposit.create({
        data: {
          ledgerId,
          businessDate: this.toDate(input.businessDate),
          amountCents: input.amountCents,
          note: this.normalizeNote(input.note),
          locationId: ledger.locationId,
          recordedByUserId: userId,
          updatedByUserId: userId,
        },
      });

      return this.toDeposit(deposit);
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw this.duplicateDeposit(input.businessDate);
      }
      throw error;
    }
  }

  async updateDeposit(
    id: string,
    input: UpdateJournalDepositDto,
    userId: string,
  ): Promise<JournalDeposit> {
    const existing = await this.prisma.journalDeposit.findUnique({
      where: { id },
      include: { ledger: true },
    });
    if (!existing) {
      throw new NotFoundException('Journal deposit not found');
    }
    await this.assertEligibleDepositDate(
      existing.ledger,
      input.businessDate,
    );

    try {
      const deposit = await this.prisma.journalDeposit.update({
        where: { id },
        data: {
          businessDate: this.toDate(input.businessDate),
          amountCents: input.amountCents,
          note: this.normalizeNote(input.note),
          updatedByUserId: userId,
        },
      });

      return this.toDeposit(deposit);
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw this.duplicateDeposit(input.businessDate);
      }
      if (this.isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Journal deposit not found');
      }
      throw error;
    }
  }

  async removeDeposit(id: string): Promise<void> {
    try {
      await this.prisma.journalDeposit.delete({ where: { id } });
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Journal deposit not found');
      }
      throw error;
    }
  }

  async createWithdrawal(
    ledgerId: string,
    input: CreateJournalWithdrawalDto,
    userId: string,
  ): Promise<JournalWithdrawal> {
    const ledger = await this.requireLedger(ledgerId);
    const withdrawal = await this.prisma.journalWithdrawal.create({
      data: {
        ledgerId,
        withdrawnOn: this.toDate(input.withdrawnOn),
        amountCents: input.amountCents,
        note: this.normalizeNote(input.note),
        locationId: ledger.locationId,
        recordedByUserId: userId,
        updatedByUserId: userId,
      },
    });

    return this.toWithdrawal(withdrawal);
  }

  async updateWithdrawal(
    id: string,
    input: UpdateJournalWithdrawalDto,
    userId: string,
  ): Promise<JournalWithdrawal> {
    try {
      const withdrawal = await this.prisma.journalWithdrawal.update({
        where: { id },
        data: {
          withdrawnOn: this.toDate(input.withdrawnOn),
          amountCents: input.amountCents,
          note: this.normalizeNote(input.note),
          updatedByUserId: userId,
        },
      });

      return this.toWithdrawal(withdrawal);
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Journal withdrawal not found');
      }
      throw error;
    }
  }

  async removeWithdrawal(id: string): Promise<void> {
    try {
      await this.prisma.journalWithdrawal.delete({ where: { id } });
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Journal withdrawal not found');
      }
      throw error;
    }
  }

  private async requireLedger(id: string) {
    const ledger = await this.prisma.journalLedger.findUnique({
      where: { id },
    });
    if (!ledger) {
      throw new NotFoundException('Journal ledger not found');
    }
    return ledger;
  }

  private async assertEligibleDepositDate(
    ledger: { startDate: Date },
    businessDate: string,
  ): Promise<void> {
    const startDate = this.toIsoDate(ledger.startDate);
    if (businessDate < startDate) {
      throw new BadRequestException({
        message: `businessDate must be on or after the ledger start date (${startDate})`,
        field: 'businessDate',
        reason: 'BEFORE_LEDGER_START_DATE',
      });
    }

    const closedDays = await this.reportingService.getClosedDailyGross(
      businessDate,
      businessDate,
    );
    if (!closedDays.some((day) => day.businessDate === businessDate)) {
      throw new BadRequestException({
        message: 'businessDate must identify a closed business day',
        field: 'businessDate',
        reason: 'BUSINESS_DAY_NOT_CLOSED',
      });
    }
  }

  private toLedgerBalance(record: LedgerActivityRecord): JournalLedgerBalance {
    const balanceCents = addMoney(
      cents(record.startingBalanceCents),
      ...record.deposits.map((deposit) => cents(deposit.amountCents)),
      ...record.withdrawals.map((withdrawal) =>
        cents(-withdrawal.amountCents),
      ),
    );

    return { ...this.toLedger(record), balanceCents };
  }

  private toLedger(
    record: Omit<LedgerActivityRecord, 'deposits' | 'withdrawals'>,
  ): JournalLedger {
    return {
      id: record.id,
      name: record.name,
      startDate: this.toIsoDate(record.startDate),
      startingBalanceCents: cents(record.startingBalanceCents),
      suggestionKind: record.suggestionKind as JournalSuggestionKind,
      isBuiltIn: record.isBuiltIn,
      locationId: record.locationId,
      createdAt: record.createdAt.toISOString(),
    };
  }

  private toDeposit(record: DepositRecord): JournalDeposit {
    return {
      id: record.id,
      ledgerId: record.ledgerId,
      businessDate: this.toIsoDate(record.businessDate),
      amountCents: cents(record.amountCents),
      note: record.note,
      locationId: record.locationId,
      recordedByUserId: record.recordedByUserId,
      recordedAt: record.recordedAt.toISOString(),
      updatedByUserId: record.updatedByUserId,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toWithdrawal(record: WithdrawalRecord): JournalWithdrawal {
    return {
      id: record.id,
      ledgerId: record.ledgerId,
      withdrawnOn: this.toIsoDate(record.withdrawnOn),
      amountCents: cents(record.amountCents),
      note: record.note,
      locationId: record.locationId,
      recordedByUserId: record.recordedByUserId,
      recordedAt: record.recordedAt.toISOString(),
      updatedByUserId: record.updatedByUserId,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private normalizeNote(note: string | null | undefined): string | null {
    const trimmed = note?.trim();
    return trimmed ? trimmed : null;
  }

  private toDate(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private toIsoDate(value: Date): string {
    return value.toISOString().slice(0, ISO_DATE_LENGTH);
  }

  private duplicateLedgerName(name: string): ConflictException {
    return new ConflictException({
      message: `A Journal ledger named ${name} already exists`,
      field: 'name',
      reason: 'DUPLICATE_JOURNAL_LEDGER_NAME',
    });
  }

  private duplicateDeposit(businessDate: string): ConflictException {
    return new ConflictException({
      message: `A deposit is already recorded for ${businessDate}`,
      field: 'businessDate',
      reason: 'DUPLICATE_JOURNAL_DEPOSIT',
    });
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
  }
}
