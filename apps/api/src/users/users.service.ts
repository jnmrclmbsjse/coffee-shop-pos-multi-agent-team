import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
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
}
