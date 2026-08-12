import { Injectable } from '@nestjs/common';
import type { ActiveCashier } from '@coffee-shop/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AppendCashierSelectionInput {
  deviceId: string;
  locationId: string | null;
  staffMemberId: string | null;
  selectedByUserId: string;
}

@Injectable()
export class CashierSelectionService {
  constructor(private readonly prisma: PrismaService) {}

  async activeCashier(
    deviceId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<ActiveCashier | null> {
    const latest = await client.cashierSelection.findFirst({
      where: { deviceId },
      select: {
        staffMember: {
          select: { id: true, displayName: true },
        },
      },
      orderBy: { selectedAt: 'desc' },
    });

    return latest?.staffMember ?? null;
  }

  async appendSelection(input: AppendCashierSelectionInput): Promise<void> {
    await this.prisma.cashierSelection.create({ data: input });
  }
}
