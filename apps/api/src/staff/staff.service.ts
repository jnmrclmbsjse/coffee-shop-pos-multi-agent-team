import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateStaffAccountResponse,
  SelectableStaffMember,
  StaffMember,
  UpdateStaffCredentialsResponse,
} from '@coffee-shop/shared';
import type { Prisma } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type {
  CreateStaffAccountDto,
  CreateStaffMemberDto,
  StaffMemberListQueryDto,
  UpdateStaffCredentialsDto,
  UpdateStaffMemberDto,
} from './staff.dto';

// Only the username is exposed; password and PIN hashes never leave the API.
const staffMemberAccountInclude = {
  user: { select: { username: true } },
} satisfies Prisma.StaffMemberInclude;

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

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
      include: staffMemberAccountInclude,
    });

    return records.map((record) => this.toStaffMember(record));
  }

  async listSelectable(): Promise<SelectableStaffMember[]> {
    const records = await this.prisma.staffMember.findMany({
      where: { isActive: true },
      select: {
        id: true,
        displayName: true,
        user: { select: { pinHash: true } },
      },
      orderBy: { displayName: 'asc' },
    });

    return records.map((record) => ({
      id: record.id,
      displayName: record.displayName,
      requiresPin: record.user?.pinHash != null,
    }));
  }

  async create(input: CreateStaffMemberDto): Promise<StaffMember> {
    await this.requireLocation(input.locationId);
    const record = await this.prisma.staffMember.create({
      data: {
        displayName: input.displayName,
        isActive: input.isActive,
        locationId: input.locationId ?? null,
      },
      include: staffMemberAccountInclude,
    });

    return this.toStaffMember(record);
  }

  async createAccount(
    staffMemberId: string,
    input: CreateStaffAccountDto,
  ): Promise<CreateStaffAccountResponse> {
    const hashes = await this.authService.hashStaffCredentials(
      input.password,
      input.pin,
    );

    return this.usersService.createStaffAccount({
      staffMemberId,
      username: input.username,
      displayName: input.displayName,
      ...hashes,
    });
  }

  async updateCredentials(
    staffMemberId: string,
    input: UpdateStaffCredentialsDto,
  ): Promise<UpdateStaffCredentialsResponse> {
    const [passwordHash, pinHash] = await Promise.all([
      input.password === undefined
        ? Promise.resolve(undefined)
        : this.authService.hashStaffPassword(input.password),
      input.pin === undefined
        ? Promise.resolve(undefined)
        : this.authService.hashStaffPin(input.pin),
    ]);

    const result = await this.usersService.updateStaffCredentials({
      staffMemberId,
      passwordHash,
      pinHash,
    });

    return {
      staffMember: this.toStaffMember(result.staffMember),
      passwordChanged: input.password !== undefined,
      pinChanged: input.pin !== undefined,
      pinSet: result.pinSet,
    };
  }

  async update(
    id: string,
    input: UpdateStaffMemberDto,
  ): Promise<StaffMember> {
    await this.requireStaffMember(id);
    const record = await this.prisma.staffMember.update({
      where: { id },
      data: input,
      include: staffMemberAccountInclude,
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
    user?: { username: string } | null;
  }): StaffMember {
    const { user, ...rest } = record;
    return {
      ...rest,
      hasAccount: user != null,
      accountUsername: user?.username ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
