import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { StaffMember } from '@coffee-shop/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateStaffMemberDto,
  StaffMemberListQueryDto,
  UpdateStaffMemberDto,
} from './staff.dto';

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: StaffMemberListQueryDto): Promise<StaffMember[]> {
    const records = await this.prisma.staffMember.findMany({
      where: {
        ...(query.search
          ? {
              displayName: {
                contains: query.search,
                mode: 'insensitive',
              },
            }
          : {}),
        ...(query.active === undefined
          ? {}
          : { isActive: query.active }),
      },
      orderBy: this.orderBy(query),
    });

    return records.map((record) => this.toStaffMember(record));
  }

  async create(input: CreateStaffMemberDto): Promise<StaffMember> {
    await this.requireLocation(input.locationId);
    const record = await this.prisma.staffMember.create({
      data: {
        displayName: input.displayName,
        isActive: input.isActive,
        locationId: input.locationId ?? null,
      },
    });

    return this.toStaffMember(record);
  }

  async update(
    id: string,
    input: UpdateStaffMemberDto,
  ): Promise<StaffMember> {
    await this.requireStaffMember(id);
    const record = await this.prisma.staffMember.update({
      where: { id },
      data: input,
    });

    return this.toStaffMember(record);
  }

  private orderBy(
    query: StaffMemberListQueryDto,
  ): Prisma.StaffMemberOrderByWithRelationInput[] {
    if (query.sort === 'active') {
      return [
        { isActive: query.direction },
        { displayName: 'asc' },
      ];
    }

    return [{ displayName: query.direction }];
  }

  private async requireStaffMember(id: string): Promise<void> {
    const staffMember = await this.prisma.staffMember.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!staffMember) {
      throw new NotFoundException('Staff member not found');
    }
  }

  private async requireLocation(
    locationId: string | null | undefined,
  ): Promise<void> {
    if (!locationId) return;

    const location = await this.prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true },
    });
    if (!location) {
      throw new BadRequestException({
        message: 'Selected location does not exist',
        field: 'locationId',
        reason: 'LOCATION_NOT_FOUND',
      });
    }
  }

  private toStaffMember(record: {
    id: string;
    displayName: string;
    isActive: boolean;
    locationId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): StaffMember {
    return {
      ...record,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
