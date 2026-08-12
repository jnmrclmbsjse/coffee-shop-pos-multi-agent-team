import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreateStaffAccountResponse,
  Role,
} from '@coffee-shop/shared';
import { Prisma, type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: {
        username: {
          equals: username.trim(),
          mode: 'insensitive',
        },
      },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByStaffMemberId(staffMemberId: string): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: { staffMember: { id: staffMemberId } },
    });
  }

  findLinkedStaffMember(userId: string): Promise<{
    id: string;
    isActive: boolean;
    locationId: string | null;
  } | null> {
    return this.prisma.staffMember.findUnique({
      where: { userId },
      select: { id: true, isActive: true, locationId: true },
    });
  }

  async createStaffAccount(input: {
    staffMemberId: string;
    username: string;
    displayName?: string;
    passwordHash: string;
    pinHash: string | null;
  }): Promise<CreateStaffAccountResponse> {
    const username = input.username.trim().toLowerCase();

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const staffMember = await transaction.staffMember.findUnique({
          where: { id: input.staffMemberId },
          select: {
            displayName: true,
            isActive: true,
            userId: true,
          },
        });

        if (!staffMember) {
          throw new NotFoundException('Staff member not found');
        }
        if (!staffMember.isActive) {
          throw this.inactiveStaffMemberConflict();
        }
        if (staffMember.userId) {
          throw this.linkedStaffMemberConflict();
        }

        const existingUser = await transaction.user.findFirst({
          where: {
            username: {
              equals: username,
              mode: 'insensitive',
            },
          },
          select: { id: true },
        });
        if (existingUser) {
          throw this.usernameConflict();
        }

        const user = await transaction.user.create({
          data: {
            username,
            displayName: input.displayName ?? staffMember.displayName,
            passwordHash: input.passwordHash,
            pinHash: input.pinHash,
            role: Role.STAFF,
            isActive: true,
          },
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        });

        const linked = await transaction.staffMember.updateMany({
          where: {
            id: input.staffMemberId,
            isActive: true,
            userId: null,
          },
          data: { userId: user.id },
        });

        if (linked.count !== 1) {
          const current = await transaction.staffMember.findUnique({
            where: { id: input.staffMemberId },
            select: { isActive: true, userId: true },
          });
          if (!current) {
            throw new NotFoundException('Staff member not found');
          }
          if (!current.isActive) {
            throw this.inactiveStaffMemberConflict();
          }
          throw this.linkedStaffMemberConflict();
        }

        return {
          username: user.username,
          displayName: user.displayName,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw this.usernameConflict();
      }
      throw error;
    }
  }

  private usernameConflict(): ConflictException {
    return new ConflictException({
      message: 'This username is already in use',
      field: 'username',
      reason: 'USERNAME_TAKEN',
    });
  }

  private inactiveStaffMemberConflict(): ConflictException {
    return new ConflictException({
      message: 'A login account cannot be created for an inactive staff member',
      reason: 'STAFF_MEMBER_INACTIVE',
    });
  }

  private linkedStaffMemberConflict(): ConflictException {
    return new ConflictException({
      message: 'This staff member already has a login account',
      reason: 'STAFF_MEMBER_ALREADY_HAS_ACCOUNT',
    });
  }
}
