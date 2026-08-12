import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import type { ActiveCashier } from '@coffee-shop/shared';
import type { Prisma } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { CashierSelectionService } from './cashier-selection.service';

export const CASHIER_UNAVAILABLE_MESSAGE = 'Cashier cannot be selected.';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly cashierSelectionService: CashierSelectionService,
  ) {}

  async activeCashier(
    deviceId: string,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<ActiveCashier | null> {
    return this.cashierSelectionService.activeCashier(deviceId, client);
  }

  async selectCashier(
    deviceId: string,
    staffMemberId: string,
    pin: unknown,
    selectedByUserId: string,
  ): Promise<ActiveCashier> {
    if (!UUID_PATTERN.test(staffMemberId)) {
      throw new BadRequestException(CASHIER_UNAVAILABLE_MESSAGE);
    }

    const member = await this.prisma.staffMember.findUnique({
      where: { id: staffMemberId },
      select: {
        id: true,
        displayName: true,
        isActive: true,
        locationId: true,
        user: { select: { pinHash: true } },
      },
    });

    if (!member?.isActive) {
      throw new BadRequestException(CASHIER_UNAVAILABLE_MESSAGE);
    }

    const requiresPin = member.user?.pinHash != null;
    if (requiresPin) {
      await this.authService.authorizeCashierPin(
        member.id,
        pin,
        deviceId,
      );
    }

    await this.cashierSelectionService.appendSelection({
      deviceId,
      locationId: member.locationId,
      staffMemberId: member.id,
      selectedByUserId,
    });

    return { id: member.id, displayName: member.displayName };
  }

  async clearCashier(
    deviceId: string,
    selectedByUserId: string,
  ): Promise<null> {
    await this.cashierSelectionService.appendSelection({
      deviceId,
      locationId: null,
      staffMemberId: null,
      selectedByUserId,
    });

    return null;
  }
}
