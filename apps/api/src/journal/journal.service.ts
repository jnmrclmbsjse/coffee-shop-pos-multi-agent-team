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
  type JournalMissingDay,
  type JournalSuggestionRate,
  JournalSuggestionKind,
  type JournalWithdrawal,
  type MoneyCents,
  suggestChairDepositCents,
  suggestRentDepositCents,
} from '@coffee-shop/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportingService, shopDate } from '../reporting/reporting.service';
import type {
  BulkCreateJournalDepositsDto,
  CreateJournalDepositDto,
  CreateJournalLedgerDto,
  CreateJournalWithdrawalDto,
  UpdateJournalDepositDto,
  UpdateJournalLedgerDto,
  UpdateJournalSuggestionRateDto,
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
type SuggestionRateRecord = Prisma.JournalSuggestionRateGetPayload<object>;
type LedgerRecord = Prisma.JournalLedgerGetPayload<object>;
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

  async updateLedger(
    id: string,
    input: UpdateJournalLedgerDto,
  ): Promise<JournalLedgerBalance> {
    await this.requireLedger(id);
    // A start date past a recorded deposit would leave that deposit outside
    // the ledger's own range, where it could no longer be edited.
    const earliestDeposit = await this.prisma.journalDeposit.findFirst({
      where: { ledgerId: id },
      orderBy: { businessDate: 'asc' },
      select: { businessDate: true },
    });
    if (earliestDeposit) {
      const earliest = this.toIsoDate(earliestDeposit.businessDate);
      if (input.startDate > earliest) {
        throw new BadRequestException({
          message: `startDate must be on or before the earliest recorded deposit (${earliest})`,
          field: 'startDate',
          reason: 'START_DATE_AFTER_RECORDED_DEPOSIT',
          businessDate: earliest,
        });
      }
    }

    try {
      const ledger = await this.prisma.journalLedger.update({
        where: { id },
        data: {
          startDate: this.toDate(input.startDate),
          startingBalanceCents: input.startingBalanceCents,
        },
        include: ledgerActivityInclude,
      });

      return this.toLedgerBalance(ledger);
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Journal ledger not found');
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

  async getRate(ledgerId: string): Promise<JournalSuggestionRate | null> {
    const ledger = await this.requireLedger(ledgerId);
    if (ledger.suggestionKind === JournalSuggestionKind.NONE) {
      return null;
    }

    const rate = await this.findRateInForce(ledgerId, this.serverToday());
    return rate ? this.toRate(rate) : null;
  }

  async updateRate(
    ledgerId: string,
    input: UpdateJournalSuggestionRateDto,
    userId: string,
  ): Promise<JournalSuggestionRate> {
    const ledger = await this.requireLedger(ledgerId);
    const data = this.rateDataForKind(ledger, input);
    // Effective from the current server calendar date, never backdated: a
    // change may only move business dates from today onward (ADR 0018 §4).
    const effectiveFrom = this.toDate(this.serverToday());

    const rate = await this.prisma.journalSuggestionRate.upsert({
      where: { ledgerId_effectiveFrom: { ledgerId, effectiveFrom } },
      create: {
        ledgerId,
        effectiveFrom,
        ...data,
        locationId: ledger.locationId,
        createdByUserId: userId,
      },
      update: { ...data, createdByUserId: userId, createdAt: new Date() },
    });

    return this.toRate(rate);
  }

  async getMissingDays(ledgerId: string): Promise<JournalMissingDay[]> {
    const ledger = await this.requireLedger(ledgerId);
    const from = this.toIsoDate(ledger.startDate);
    const to = this.serverToday();
    if (from > to) {
      return [];
    }

    const [closedDays, recorded, rates] = await Promise.all([
      this.reportingService.getClosedDailyGross(from, to),
      this.prisma.journalDeposit.findMany({
        where: { ledgerId },
        select: { businessDate: true },
      }),
      ledger.suggestionKind === JournalSuggestionKind.NONE
        ? Promise.resolve([] as SuggestionRateRecord[])
        : this.prisma.journalSuggestionRate.findMany({
            where: { ledgerId },
            orderBy: { effectiveFrom: 'asc' },
          }),
    ]);

    const recordedDates = new Set(
      recorded.map((deposit) => this.toIsoDate(deposit.businessDate)),
    );

    // An anti-join, so a day with a deposit row — including a ₱0 row — is
    // not missing and no suggestion is computed for it at all.
    return closedDays
      .filter((day) => !recordedDates.has(day.businessDate))
      .sort((left, right) => left.businessDate.localeCompare(right.businessDate))
      .map((day) => ({
        businessDate: day.businessDate,
        grossSalesCents: day.grossSalesCents,
        suggestedAmountCents: this.suggestFor(
          ledger.suggestionKind,
          day.grossSalesCents,
          this.rateInForceFor(rates, day.businessDate),
        ),
      }));
  }

  async createDepositsBulk(
    ledgerId: string,
    input: BulkCreateJournalDepositsDto,
    userId: string,
  ): Promise<JournalDeposit[]> {
    const ledger = await this.requireLedger(ledgerId);
    const rows = [...input.deposits].sort((left, right) =>
      left.businessDate.localeCompare(right.businessDate),
    );
    this.assertNoRepeatedBusinessDate(rows);
    await this.assertEligibleDepositDates(
      ledger,
      rows.map((row) => row.businessDate),
    );

    try {
      // All-or-nothing is the transaction, not application ordering.
      const deposits = await this.prisma.$transaction(
        rows.map((row) =>
          this.prisma.journalDeposit.create({
            data: {
              ledgerId,
              businessDate: this.toDate(row.businessDate),
              amountCents: row.amountCents,
              note: this.normalizeNote(row.note),
              locationId: ledger.locationId,
              recordedByUserId: userId,
              updatedByUserId: userId,
            },
          }),
        ),
      );

      return deposits.map((deposit) => this.toDeposit(deposit));
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw this.conflictingBulkDeposits();
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
    await this.assertEligibleDepositDates(ledger, [businessDate]);
  }

  private async assertEligibleDepositDates(
    ledger: { startDate: Date },
    businessDates: readonly string[],
  ): Promise<void> {
    const startDate = this.toIsoDate(ledger.startDate);
    for (const businessDate of businessDates) {
      if (businessDate < startDate) {
        throw new BadRequestException({
          message: `businessDate must be on or after the ledger start date (${startDate})`,
          field: 'businessDate',
          reason: 'BEFORE_LEDGER_START_DATE',
          businessDate,
        });
      }
    }

    const sorted = [...businessDates].sort((left, right) =>
      left.localeCompare(right),
    );
    const closedDays = await this.reportingService.getClosedDailyGross(
      sorted[0]!,
      sorted[sorted.length - 1]!,
    );
    const closedDates = new Set(closedDays.map((day) => day.businessDate));
    for (const businessDate of businessDates) {
      if (!closedDates.has(businessDate)) {
        throw new BadRequestException({
          message: 'businessDate must identify a closed business day',
          field: 'businessDate',
          reason: 'BUSINESS_DAY_NOT_CLOSED',
          businessDate,
        });
      }
    }
  }

  private assertNoRepeatedBusinessDate(
    rows: readonly { businessDate: string }[],
  ): void {
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.businessDate)) {
        throw new BadRequestException({
          message: `deposits must not list ${row.businessDate} more than once`,
          field: 'deposits',
          reason: 'REPEATED_BUSINESS_DATE',
          businessDate: row.businessDate,
        });
      }
      seen.add(row.businessDate);
    }
  }

  private async findRateInForce(
    ledgerId: string,
    businessDate: string,
  ): Promise<SuggestionRateRecord | null> {
    return this.prisma.journalSuggestionRate.findFirst({
      where: { ledgerId, effectiveFrom: { lte: this.toDate(businessDate) } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /** The row with the greatest `effectiveFrom <= businessDate` (ADR 0018 §4). */
  private rateInForceFor(
    rates: readonly SuggestionRateRecord[],
    businessDate: string,
  ): SuggestionRateRecord | null {
    let inForce: SuggestionRateRecord | null = null;
    for (const rate of rates) {
      if (this.toIsoDate(rate.effectiveFrom) > businessDate) continue;
      if (
        !inForce ||
        rate.effectiveFrom.getTime() > inForce.effectiveFrom.getTime()
      ) {
        inForce = rate;
      }
    }
    return inForce;
  }

  private suggestFor(
    suggestionKind: string,
    grossSalesCents: MoneyCents,
    rate: SuggestionRateRecord | null,
  ): MoneyCents | null {
    // `null` and `cents(0)` are different states and must not be flattened:
    // a Chair ledger genuinely suggests ₱0 below its threshold.
    if (suggestionKind === JournalSuggestionKind.NONE || !rate) {
      return null;
    }

    if (suggestionKind === JournalSuggestionKind.RENT_PERCENT_OF_ROUNDED_GROSS) {
      return rate.rentPercentBasisPoints === null
        ? null
        : suggestRentDepositCents(
            grossSalesCents,
            rate.rentPercentBasisPoints,
          );
    }

    if (
      rate.chairAmountCents === null ||
      rate.chairThresholdCents === null
    ) {
      return null;
    }
    return suggestChairDepositCents(
      grossSalesCents,
      cents(rate.chairAmountCents),
      cents(rate.chairThresholdCents),
    );
  }

  private rateDataForKind(
    ledger: LedgerRecord,
    input: UpdateJournalSuggestionRateDto,
  ): {
    rentPercentBasisPoints: number | null;
    chairAmountCents: number | null;
    chairThresholdCents: number | null;
  } {
    if (ledger.suggestionKind === JournalSuggestionKind.NONE) {
      throw new BadRequestException({
        message: `${ledger.name} is a fully manual ledger and has no suggestion rate`,
        field: 'ledgerId',
        reason: 'LEDGER_HAS_NO_SUGGESTION_RATE',
      });
    }

    if (
      ledger.suggestionKind === JournalSuggestionKind.RENT_PERCENT_OF_ROUNDED_GROSS
    ) {
      this.assertRateFields(input, ['rentPercentBasisPoints']);
      return {
        rentPercentBasisPoints: input.rentPercentBasisPoints!,
        chairAmountCents: null,
        chairThresholdCents: null,
      };
    }

    this.assertRateFields(input, ['chairAmountCents', 'chairThresholdCents']);
    return {
      rentPercentBasisPoints: null,
      chairAmountCents: input.chairAmountCents!,
      chairThresholdCents: input.chairThresholdCents!,
    };
  }

  private assertRateFields(
    input: UpdateJournalSuggestionRateDto,
    required: readonly (keyof UpdateJournalSuggestionRateDto)[],
  ): void {
    const fields = [
      'rentPercentBasisPoints',
      'chairAmountCents',
      'chairThresholdCents',
    ] as const;

    for (const field of fields) {
      const expected = required.includes(field);
      const present = input[field] !== undefined;
      if (expected && !present) {
        throw new BadRequestException({
          message: `${field} is required for this ledger`,
          field,
          reason: 'RATE_FIELD_REQUIRED',
        });
      }
      if (!expected && present) {
        throw new BadRequestException({
          message: `${field} does not apply to this ledger`,
          field,
          reason: 'RATE_FIELD_NOT_APPLICABLE',
        });
      }
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

  private toRate(record: SuggestionRateRecord): JournalSuggestionRate {
    return {
      id: record.id,
      ledgerId: record.ledgerId,
      effectiveFrom: this.toIsoDate(record.effectiveFrom),
      rentPercentBasisPoints: record.rentPercentBasisPoints,
      chairAmountCents:
        record.chairAmountCents === null
          ? null
          : cents(record.chairAmountCents),
      chairThresholdCents:
        record.chairThresholdCents === null
          ? null
          : cents(record.chairThresholdCents),
      locationId: record.locationId,
      createdByUserId: record.createdByUserId,
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

  // "The current server calendar date" is the shop's date (Asia/Manila), not
  // the UTC one. Between 00:00 and 08:00 Manila the UTC date is still
  // yesterday, and using it would write `effectiveFrom` onto an already-closed
  // business day — backdating a rate change the AC and ADR 0018 §4 forbid.
  private serverToday(): string {
    return shopDate(new Date());
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

  private conflictingBulkDeposits(): ConflictException {
    return new ConflictException({
      message:
        'A deposit is already recorded for one of the selected business days; no deposits were saved',
      field: 'deposits',
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
