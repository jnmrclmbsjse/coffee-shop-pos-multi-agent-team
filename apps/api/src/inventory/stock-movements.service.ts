import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type {
  StockMovementList,
  StockMovementListItem,
} from '@coffee-shop/shared';
import { MovementType as SharedMovementType } from '@coffee-shop/shared';
import {
  MovementType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  OpenTradingDay,
  TradingDayService,
} from '../trading-day/trading-day.service';
import { CreateStockMovementDto } from './inventory.dto';

const movementInclude = {
  inventoryItem: {
    select: { name: true },
  },
} satisfies Prisma.StockMovementInclude;

type StockMovementRecord = Prisma.StockMovementGetPayload<{
  include: typeof movementInclude;
}>;

@Injectable()
export class StockMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tradingDayService: TradingDayService,
  ) {}

  async list(): Promise<StockMovementList> {
    const openDay = await this.tradingDayService.findCurrentOpenDay();
    if (openDay === null) {
      return {
        businessDay: this.tradingDayService.toResponse(null),
        movements: [],
      };
    }

    const movements = await this.prisma.stockMovement.findMany({
      where: {
        locationId: openDay.locationId,
        businessDate: openDay.businessDate,
      },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      include: movementInclude,
    });

    return {
      businessDay: this.tradingDayService.toResponse(openDay),
      movements: movements.map((movement) =>
        this.toListItem(movement),
      ),
    };
  }

  async create(
    input: CreateStockMovementDto,
  ): Promise<StockMovementListItem> {
    const openDay = await this.requireOpenDay();
    if (!Number.isInteger(input.quantity) || input.quantity < 0) {
      throw new BadRequestException(
        'Movement quantity must be a whole number zero or greater',
      );
    }
    if (
      !Object.values(SharedMovementType).includes(input.type)
    ) {
      throw new BadRequestException('Movement type is invalid');
    }

    return this.prisma.$transaction(async (transaction) => {
      const [item, recorder] = await Promise.all([
        transaction.inventoryItem.findFirst({
          where: { id: input.inventoryItemId, active: true },
          select: { id: true },
        }),
        input.recordedByStaffMemberId
          ? transaction.staffMember.findFirst({
              where: {
                id: input.recordedByStaffMemberId,
                isActive: true,
              },
              select: { id: true, displayName: true },
            })
          : Promise.resolve(null),
      ]);

      if (item === null) {
        throw new BadRequestException(
          'inventoryItemId must reference an active inventory item',
        );
      }
      if (input.recordedByStaffMemberId && recorder === null) {
        throw new BadRequestException(
          'recordedByStaffMemberId must reference an active staff member',
        );
      }

      const movement = await transaction.stockMovement.create({
        data: {
          locationId: openDay.locationId,
          businessDate: openDay.businessDate,
          inventoryItemId: item.id,
          type: input.type as MovementType,
          quantity: input.quantity,
          recordedByStaffMemberId: recorder?.id ?? null,
          recordedByNameSnapshot: recorder?.displayName ?? null,
          reason: input.reason?.trim() || null,
        },
        include: movementInclude,
      });

      return this.toListItem(movement);
    });
  }

  private async requireOpenDay(): Promise<OpenTradingDay> {
    const day = await this.tradingDayService.findCurrentOpenDay();
    if (day === null) {
      throw new ConflictException('No business day is open');
    }
    return day;
  }

  private toListItem(
    movement: StockMovementRecord,
  ): StockMovementListItem {
    return {
      id: movement.id,
      locationId: movement.locationId,
      businessDate: movement.businessDate.toISOString().slice(0, 10),
      inventoryItemId: movement.inventoryItemId,
      itemName: movement.inventoryItem.name,
      type: movement.type as SharedMovementType,
      quantity: movement.quantity,
      recordedByStaffMemberId: movement.recordedByStaffMemberId,
      recordedByNameSnapshot: movement.recordedByNameSnapshot,
      reason: movement.reason,
      recordedAt: movement.recordedAt.toISOString(),
    };
  }
}
