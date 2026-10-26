import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  addMoney,
  ALLOWANCE_DESCRIPTION_PRESETS,
  cents,
  CompensationAdjustmentKind,
  suggestCommissionCents,
  suggestPersonalCommissionCents,
  type DailyGrossSalesSuggestion,
  type PayslipAdjustmentGroup,
  type StaffCompensationAdjustment,
  type PayslipSummary,
  type StaffCompensationEntry,
  type StaffCommissionRate,
} from '@coffee-shop/shared';
import { Prisma, type StaffMember } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReportingService } from '../reporting/reporting.service';
import type {
  CompensationEntryListQueryDto,
  CompensationAdjustmentListQueryDto,
  CreateCompensationAdjustmentDto,
  CreateCompensationEntryDto,
  PayslipQueryDto,
  UpdateCompensationAdjustmentDto,
  UpdateCompensationEntryDto,
  CreateStaffCommissionRateDto,
} from './compensation.dto';

const ISO_DATE_LENGTH = 10;

const compensationEntryInclude = {
  staffMember: { select: { displayName: true } },
} satisfies Prisma.StaffCompensationEntryInclude;

type CompensationEntryRecord =
  Prisma.StaffCompensationEntryGetPayload<{
    include: typeof compensationEntryInclude;
  }>;

const compensationAdjustmentInclude = {
  staffMember: { select: { displayName: true } },
} satisfies Prisma.StaffCompensationAdjustmentInclude;

type CompensationAdjustmentRecord =
  Prisma.StaffCompensationAdjustmentGetPayload<{
    include: typeof compensationAdjustmentInclude;
  }>;

@Injectable()
export class CompensationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportingService: ReportingService,
  ) {}

  async getDailyGrossSuggestion(
    workDate: string,
    staffMemberId?: string,
  ): Promise<DailyGrossSalesSuggestion> {
    const dailyGross = await this.reportingService.getDailyGrossSales(workDate);
    let personalCommissionRateCents = null;
    if (staffMemberId) {
      await this.requireStaffMember(staffMemberId);
      const rate = await this.prisma.staffCommissionRate.findFirst({
        where: { staffMemberId, effectiveFrom: { lte: this.toDate(workDate) } },
        orderBy: { effectiveFrom: 'desc' },
      });
      personalCommissionRateCents = rate ? cents(rate.ratePerBandCents) : null;
    }

    return {
      workDate,
      ...dailyGross,
      suggestedCommissionCents: suggestCommissionCents(
        dailyGross.grossSalesCents,
      ),
      personalCommissionRateCents,
      suggestedPersonalCommissionCents: suggestPersonalCommissionCents(dailyGross.grossSalesCents, personalCommissionRateCents),
    };
  }

  async listCommissionRates(staffMemberId: string): Promise<StaffCommissionRate[]> {
    await this.requireStaffMember(staffMemberId);
    const rows = await this.prisma.staffCommissionRate.findMany({ where: { staffMemberId }, orderBy: { effectiveFrom: 'asc' } });
    return rows.map((row) => this.toCommissionRate(row));
  }

  async upsertCommissionRate(staffMemberId: string, input: CreateStaffCommissionRateDto, userId: string): Promise<StaffCommissionRate> {
    const staff = await this.requireStaffMember(staffMemberId);
    const row = await this.prisma.staffCommissionRate.upsert({
      where: { staffMemberId_effectiveFrom: { staffMemberId, effectiveFrom: this.toDate(input.effectiveFrom) } },
      create: { staffMemberId, effectiveFrom: this.toDate(input.effectiveFrom), ratePerBandCents: input.ratePerBandCents, locationId: staff.locationId, createdByUserId: userId },
      update: { ratePerBandCents: input.ratePerBandCents, locationId: staff.locationId, createdByUserId: userId },
    });
    return this.toCommissionRate(row);
  }

  async removeCommissionRate(id: string): Promise<void> {
    try { await this.prisma.staffCommissionRate.delete({ where: { id } }); }
    catch (error) { if (this.isPrismaError(error, 'P2025')) throw new NotFoundException('Commission rate not found'); throw error; }
  }

  async getPayslip(query: PayslipQueryDto): Promise<PayslipSummary> {
    if (query.to < query.from) {
      throw new BadRequestException({
        message: 'to must be on or after from',
        field: 'to',
        reason: 'INVALID_DATE_RANGE',
      });
    }

    const staffMember = await this.prisma.staffMember.findUnique({
      where: { id: query.staffMemberId },
      select: { id: true, displayName: true },
    });
    if (!staffMember) {
      throw new NotFoundException('Staff member not found');
    }

    const [entryRecords, adjustmentRecords, rateRecords] = await Promise.all([
      this.prisma.staffCompensationEntry.findMany({
        where: {
          staffMemberId: query.staffMemberId,
          workDate: {
            gte: this.toDate(query.from),
            lt: this.dayAfter(query.to),
          },
        },
        orderBy: { workDate: 'asc' },
      }),
      this.prisma.staffCompensationAdjustment.findMany({
        where: {
          staffMemberId: query.staffMemberId,
          effectiveDate: {
            gte: this.toDate(query.from),
            lt: this.dayAfter(query.to),
          },
        },
        include: compensationAdjustmentInclude,
        orderBy: [{ effectiveDate: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.staffCommissionRate?.findMany?.({
        where: { staffMemberId: query.staffMemberId, effectiveFrom: { lte: this.toDate(query.to) } },
        orderBy: { effectiveFrom: 'asc' },
      }) ?? Promise.resolve([]),
    ]);
    const entries = entryRecords.map((record) => {
      const salaryCents = cents(record.salaryCents);
      const commissionCents = cents(record.commissionCents);
      const personalCommissionCents = cents(record.personalCommissionCents ?? 0);

      return {
        id: record.id,
        workDate: record.workDate.toISOString().slice(0, ISO_DATE_LENGTH),
        salaryCents,
        commissionCents,
        personalCommissionCents,
        dailyTotalCents: addMoney(salaryCents, commissionCents, personalCommissionCents),
      };
    });
    const salaryTotalCents = addMoney(
      ...entries.map((entry) => entry.salaryCents),
    );
    const commissionTotalCents = addMoney(
      ...entries.map((entry) => entry.commissionCents),
    );
    const personalCommissionTotalCents = addMoney(...entries.map((entry) => entry.personalCommissionCents));
    const fromDate = this.toDate(query.from);
    const baselineRateIndex = rateRecords.findLastIndex(
      (row) => row.effectiveFrom <= fromDate,
    );
    const personalCommissionRates = rateRecords
      .filter(
        (row, index) =>
          index === baselineRateIndex || row.effectiveFrom > fromDate,
      )
      .map((row) => ({
        effectiveFrom: row.effectiveFrom.toISOString().slice(0, ISO_DATE_LENGTH),
        ratePerBandCents: cents(row.ratePerBandCents),
      }));
    const adjustments = adjustmentRecords.map((record) =>
      this.toAdjustment(record),
    );
    const adjustmentGroups = this.groupAdjustments(adjustments);
    const allowanceTotalCents = this.sumAdjustments(
      adjustments,
      CompensationAdjustmentKind.ALLOWANCE,
    );
    const bonusTotalCents = this.sumAdjustments(
      adjustments,
      CompensationAdjustmentKind.BONUS,
    );
    const advanceTotalCents = this.sumAdjustments(
      adjustments,
      CompensationAdjustmentKind.ADVANCE,
    );
    const grandTotalCents = addMoney(
      salaryTotalCents,
      commissionTotalCents,
      personalCommissionTotalCents,
    );
    const earningsTotalCents = addMoney(
      grandTotalCents,
      allowanceTotalCents,
      bonusTotalCents,
    );

    return {
      staffMember: {
        id: staffMember.id,
        displayName: staffMember.displayName,
      },
      from: query.from,
      to: query.to,
      entries,
      adjustments,
      adjustmentGroups,
      salaryTotalCents,
      commissionTotalCents,
      personalCommissionTotalCents,
      personalCommissionRates,
      grandTotalCents,
      allowanceTotalCents,
      bonusTotalCents,
      advanceTotalCents,
      earningsTotalCents,
      netPayableCents: addMoney(
        earningsTotalCents,
        cents(-advanceTotalCents),
      ),
    };
  }

  async list(
    query: CompensationEntryListQueryDto,
  ): Promise<StaffCompensationEntry[]> {
    const records = await this.prisma.staffCompensationEntry.findMany({
      where: {
        ...(query.staffMemberId
          ? { staffMemberId: query.staffMemberId }
          : {}),
        ...(query.from || query.to
          ? {
              workDate: {
                ...(query.from ? { gte: this.toDate(query.from) } : {}),
                ...(query.to ? { lte: this.toDate(query.to) } : {}),
              },
            }
          : {}),
      },
      include: compensationEntryInclude,
      orderBy: [
        { workDate: 'desc' },
        { staffMember: { displayName: 'asc' } },
      ],
    });

    return records.map((record) => this.toEntry(record));
  }

  async create(
    input: CreateCompensationEntryDto,
    userId: string,
  ): Promise<StaffCompensationEntry> {
    const staffMember = await this.requireStaffMember(input.staffMemberId);

    try {
      const record = await this.prisma.$transaction(async (transaction) => {
        const entry = await transaction.staffCompensationEntry.create({
          data: {
            staffMemberId: input.staffMemberId,
            workDate: this.toDate(input.workDate),
            salaryCents: input.salaryCents,
            commissionCents: input.commissionCents,
            personalCommissionCents: input.personalCommissionCents ?? 0,
            locationId: staffMember.locationId,
            createdByUserId: userId,
            updatedByUserId: userId,
          },
          include: compensationEntryInclude,
        });

        if (input.loadAllowance) {
          await transaction.staffCompensationAdjustment.create({
            data: {
              staffMemberId: input.staffMemberId,
              kind: CompensationAdjustmentKind.ALLOWANCE,
              effectiveDate: this.toDate(input.workDate),
              amountCents: input.loadAllowance.amountCents,
              description: ALLOWANCE_DESCRIPTION_PRESETS[0],
              locationId: staffMember.locationId,
              createdByUserId: userId,
              updatedByUserId: userId,
            },
          });
        }

        return entry;
      });

      return this.toEntry(record);
    } catch (error) {
      if (this.isPrismaError(error, 'P2002')) {
        throw new ConflictException({
          message: `A compensation entry already exists for ${staffMember.displayName} on ${input.workDate}`,
          field: 'workDate',
          reason: 'DUPLICATE_COMPENSATION_ENTRY',
        });
      }
      throw error;
    }
  }

  async listAdjustments(
    query: CompensationAdjustmentListQueryDto,
  ): Promise<StaffCompensationAdjustment[]> {
    if (query.from && query.to && query.to < query.from) {
      throw new BadRequestException({
        message: 'to must be on or after from',
        field: 'to',
        reason: 'INVALID_DATE_RANGE',
      });
    }
    if (query.staffMemberId) {
      await this.requireStaffMember(query.staffMemberId);
    }

    const records = await this.prisma.staffCompensationAdjustment.findMany({
      where: {
        ...(query.staffMemberId
          ? { staffMemberId: query.staffMemberId }
          : {}),
        ...(query.from || query.to
          ? {
              effectiveDate: {
                ...(query.from ? { gte: this.toDate(query.from) } : {}),
                ...(query.to ? { lte: this.toDate(query.to) } : {}),
              },
            }
          : {}),
      },
      include: compensationAdjustmentInclude,
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'asc' }],
    });

    return records.map((record) => this.toAdjustment(record));
  }

  async createAdjustment(
    input: CreateCompensationAdjustmentDto,
    userId: string,
  ): Promise<StaffCompensationAdjustment> {
    const staffMember = await this.requireStaffMember(input.staffMemberId);
    const record = await this.prisma.staffCompensationAdjustment.create({
      data: {
        staffMemberId: input.staffMemberId,
        kind: input.kind,
        effectiveDate: this.toDate(input.effectiveDate),
        amountCents: input.amountCents,
        description: input.description.trim(),
        locationId: staffMember.locationId,
        createdByUserId: userId,
        updatedByUserId: userId,
      },
      include: compensationAdjustmentInclude,
    });

    return this.toAdjustment(record);
  }

  async updateAdjustment(
    id: string,
    input: UpdateCompensationAdjustmentDto,
    userId: string,
  ): Promise<StaffCompensationAdjustment> {
    try {
      const record = await this.prisma.staffCompensationAdjustment.update({
        where: { id },
        data: {
          effectiveDate: this.toDate(input.effectiveDate),
          amountCents: input.amountCents,
          description: input.description.trim(),
          updatedByUserId: userId,
        },
        include: compensationAdjustmentInclude,
      });

      return this.toAdjustment(record);
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Compensation adjustment not found');
      }
      throw error;
    }
  }

  async removeAdjustment(id: string): Promise<void> {
    try {
      await this.prisma.staffCompensationAdjustment.delete({ where: { id } });
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Compensation adjustment not found');
      }
      throw error;
    }
  }

  async update(
    id: string,
    input: UpdateCompensationEntryDto,
    userId: string,
  ): Promise<StaffCompensationEntry> {
    try {
      const record = await this.prisma.staffCompensationEntry.update({
        where: { id },
        data: {
          salaryCents: input.salaryCents,
          commissionCents: input.commissionCents,
          ...(input.personalCommissionCents === undefined ? {} : { personalCommissionCents: input.personalCommissionCents }),
          updatedByUserId: userId,
        },
        include: compensationEntryInclude,
      });

      return this.toEntry(record);
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Compensation entry not found');
      }
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.prisma.staffCompensationEntry.delete({ where: { id } });
    } catch (error) {
      if (this.isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Compensation entry not found');
      }
      throw error;
    }
  }

  private async requireStaffMember(
    id: string,
  ): Promise<Pick<StaffMember, 'displayName' | 'locationId'>> {
    const staffMember = await this.prisma.staffMember.findUnique({
      where: { id },
      select: {
        displayName: true,
        locationId: true,
      },
    });
    if (!staffMember) {
      throw new NotFoundException('Staff member not found');
    }

    return staffMember;
  }

  private toDate(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private dayAfter(value: string): Date {
    const date = this.toDate(value);
    date.setUTCDate(date.getUTCDate() + 1);
    return date;
  }

  private toEntry(record: CompensationEntryRecord): StaffCompensationEntry {
    const salaryCents = cents(record.salaryCents);
    const commissionCents = cents(record.commissionCents);
    const personalCommissionCents = cents(record.personalCommissionCents ?? 0);

    return {
      id: record.id,
      staffMemberId: record.staffMemberId,
      staffMemberDisplayName: record.staffMember.displayName,
      workDate: record.workDate.toISOString().slice(0, ISO_DATE_LENGTH),
      salaryCents,
      commissionCents,
      personalCommissionCents,
      dailyTotalCents: addMoney(salaryCents, commissionCents, personalCommissionCents),
      locationId: record.locationId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private toCommissionRate(record: { id: string; staffMemberId: string; effectiveFrom: Date; ratePerBandCents: number; createdAt: Date }): StaffCommissionRate {
    return { id: record.id, staffMemberId: record.staffMemberId, effectiveFrom: record.effectiveFrom.toISOString().slice(0, 10), ratePerBandCents: cents(record.ratePerBandCents), createdAt: record.createdAt.toISOString() };
  }

  private toAdjustment(
    record: CompensationAdjustmentRecord,
  ): StaffCompensationAdjustment {
    return {
      id: record.id,
      staffMemberId: record.staffMemberId,
      staffMemberDisplayName: record.staffMember.displayName,
      kind: CompensationAdjustmentKind[record.kind],
      effectiveDate: record.effectiveDate
        .toISOString()
        .slice(0, ISO_DATE_LENGTH),
      amountCents: cents(record.amountCents),
      description: record.description,
      locationId: record.locationId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private sumAdjustments(
    adjustments: readonly StaffCompensationAdjustment[],
    kind: CompensationAdjustmentKind,
  ) {
    return addMoney(
      ...adjustments
        .filter((adjustment) => adjustment.kind === kind)
        .map((adjustment) => adjustment.amountCents),
    );
  }

  private groupAdjustments(
    adjustments: readonly StaffCompensationAdjustment[],
  ): PayslipAdjustmentGroup[] {
    const groups: PayslipAdjustmentGroup[] = [];
    const groupsByKey = new Map<string, PayslipAdjustmentGroup>();

    for (const adjustment of adjustments) {
      const key = JSON.stringify([
        adjustment.kind,
        adjustment.description.trim().toLowerCase(),
      ]);
      const existingGroup = groupsByKey.get(key);

      if (existingGroup) {
        existingGroup.totalCents = addMoney(
          existingGroup.totalCents,
          adjustment.amountCents,
        );
        existingGroup.effectiveDates.push(adjustment.effectiveDate);
        existingGroup.adjustmentIds.push(adjustment.id);
        existingGroup.itemCount += 1;
        continue;
      }

      const group: PayslipAdjustmentGroup = {
        kind: adjustment.kind,
        description: adjustment.description,
        totalCents: addMoney(adjustment.amountCents),
        effectiveDates: [adjustment.effectiveDate],
        itemCount: 1,
        adjustmentIds: [adjustment.id],
      };
      groupsByKey.set(key, group);
      groups.push(group);
    }

    return groups;
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
  }
}
