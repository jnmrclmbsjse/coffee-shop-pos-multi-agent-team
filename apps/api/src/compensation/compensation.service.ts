import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  addMoney,
  cents,
  type PayslipSummary,
  type StaffCompensationEntry,
} from '@coffee-shop/shared';
import { Prisma, type StaffMember } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CompensationEntryListQueryDto,
  CreateCompensationEntryDto,
  PayslipQueryDto,
  UpdateCompensationEntryDto,
} from './compensation.dto';

const ISO_DATE_LENGTH = 10;

const compensationEntryInclude = {
  staffMember: { select: { displayName: true } },
} satisfies Prisma.StaffCompensationEntryInclude;

type CompensationEntryRecord =
  Prisma.StaffCompensationEntryGetPayload<{
    include: typeof compensationEntryInclude;
  }>;

@Injectable()
export class CompensationService {
  constructor(private readonly prisma: PrismaService) {}

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

    const records = await this.prisma.staffCompensationEntry.findMany({
      where: {
        staffMemberId: query.staffMemberId,
        workDate: {
          gte: this.toDate(query.from),
          lt: this.dayAfter(query.to),
        },
      },
      orderBy: { workDate: 'asc' },
    });
    const entries = records.map((record) => {
      const salaryCents = cents(record.salaryCents);
      const commissionCents = cents(record.commissionCents);

      return {
        id: record.id,
        workDate: record.workDate.toISOString().slice(0, ISO_DATE_LENGTH),
        salaryCents,
        commissionCents,
        dailyTotalCents: addMoney(salaryCents, commissionCents),
      };
    });
    const salaryTotalCents = addMoney(
      ...entries.map((entry) => entry.salaryCents),
    );
    const commissionTotalCents = addMoney(
      ...entries.map((entry) => entry.commissionCents),
    );

    return {
      staffMember: {
        id: staffMember.id,
        displayName: staffMember.displayName,
      },
      from: query.from,
      to: query.to,
      entries,
      salaryTotalCents,
      commissionTotalCents,
      grandTotalCents: addMoney(salaryTotalCents, commissionTotalCents),
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
      const record = await this.prisma.staffCompensationEntry.create({
        data: {
          staffMemberId: input.staffMemberId,
          workDate: this.toDate(input.workDate),
          salaryCents: input.salaryCents,
          commissionCents: input.commissionCents,
          locationId: staffMember.locationId,
          createdByUserId: userId,
          updatedByUserId: userId,
        },
        include: compensationEntryInclude,
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

    return {
      id: record.id,
      staffMemberId: record.staffMemberId,
      staffMemberDisplayName: record.staffMember.displayName,
      workDate: record.workDate.toISOString().slice(0, ISO_DATE_LENGTH),
      salaryCents,
      commissionCents,
      dailyTotalCents: addMoney(salaryCents, commissionCents),
      locationId: record.locationId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private isPrismaError(error: unknown, code: string): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === code
    );
  }
}
