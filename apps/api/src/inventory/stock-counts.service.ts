import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type {
  CountSheet,
  CountSheetItem,
  InventoryStaffOption,
  SubmittedStockCount,
} from '@coffee-shop/shared';
import {
  CountMethod as SharedCountMethod,
  StockLevel as SharedStockLevel,
} from '@coffee-shop/shared';
import {
  CountMethod,
  Prisma,
  StockCountPhase as PrismaStockCountPhase,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  OpenTradingDay,
  TradingDayService,
} from '../trading-day/trading-day.service';
import { SubmitStockCountDto } from './inventory.dto';

const submittedCountInclude = {
  lines: {
    include: {
      inventoryItem: {
        select: { name: true },
      },
    },
  },
} satisfies Prisma.StockCountInclude;

type SubmittedStockCountRecord = Prisma.StockCountGetPayload<{
  include: typeof submittedCountInclude;
}>;

@Injectable()
export class StockCountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tradingDayService: TradingDayService,
  ) {}

  openingSheet(): Promise<CountSheet> {
    return this.sheet('open');
  }

  closingSheet(): Promise<CountSheet> {
    return this.sheet('close');
  }

  async listActiveStaff(): Promise<InventoryStaffOption[]> {
    const staff = await this.prisma.staffMember.findMany({
      where: { isActive: true },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true },
    });

    return staff;
  }

  async submit(input: SubmitStockCountDto): Promise<SubmittedStockCount> {
    const openDay = await this.requireOpenDay();
    this.validateLineValues(input);

    return this.prisma.$transaction(async (transaction) => {
      const [submitter, shiftLead, items] = await Promise.all([
        transaction.staffMember.findFirst({
          where: {
            id: input.submittedByStaffMemberId,
            isActive: true,
          },
          select: { id: true, displayName: true },
        }),
        input.shiftLeadStaffMemberId
          ? transaction.staffMember.findFirst({
              where: {
                id: input.shiftLeadStaffMemberId,
                isActive: true,
              },
              select: { id: true, displayName: true },
            })
          : Promise.resolve(null),
        transaction.inventoryItem.findMany({
          where: {
            id: { in: input.lines.map((line) => line.inventoryItemId) },
          },
          select: {
            id: true,
            active: true,
            critical: true,
            countMethod: true,
          },
        }),
      ]);

      if (submitter === null) {
        throw new BadRequestException(
          'submittedByStaffMemberId must reference an active staff member',
        );
      }
      if (input.shiftLeadStaffMemberId && shiftLead === null) {
        throw new BadRequestException(
          'shiftLeadStaffMemberId must reference an active staff member',
        );
      }

      const itemById = new Map(items.map((item) => [item.id, item]));
      for (const line of input.lines) {
        const item = itemById.get(line.inventoryItemId);
        if (
          item === undefined ||
          !item.active ||
          (input.phase === 'open' && !item.critical)
        ) {
          throw new BadRequestException(
            `Inventory item ${line.inventoryItemId} is not on the ${input.phase} count sheet`,
          );
        }
        if (
          (item.countMethod === CountMethod.QUANTITY &&
            line.quantity === undefined) ||
          (item.countMethod === CountMethod.LEVEL &&
            line.level === undefined)
        ) {
          throw new BadRequestException(
            `Count value does not match the count method for inventory item ${line.inventoryItemId}`,
          );
        }
      }

      const count = await transaction.stockCount.create({
        data: {
          locationId: openDay.locationId,
          businessDate: openDay.businessDate,
          phase: this.toPrismaPhase(input.phase),
          submittedByStaffMemberId: submitter.id,
          submittedByNameSnapshot: submitter.displayName,
          shiftLeadStaffMemberId: shiftLead?.id ?? null,
          shiftLeadNameSnapshot: shiftLead?.displayName ?? null,
          lines: {
            create: input.lines.map((line) => ({
              inventoryItemId: line.inventoryItemId,
              quantity: line.quantity ?? null,
              level: line.level ?? null,
            })),
          },
        },
        include: submittedCountInclude,
      });

      return this.toSubmittedCount(count);
    });
  }

  private async sheet(phase: 'open' | 'close'): Promise<CountSheet> {
    const openDay = await this.tradingDayService.findCurrentOpenDay();
    if (openDay === null) {
      return {
        businessDay: this.tradingDayService.toResponse(null),
        phase,
        items: [],
        submittedCount: null,
      };
    }

    const [items, submittedCount] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: {
          active: true,
          ...(phase === 'open' ? { critical: true } : {}),
        },
        orderBy:
          phase === 'open'
            ? [{ name: 'asc' }]
            : [{ critical: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          size: true,
          unit: true,
          countMethod: true,
          critical: true,
        },
      }),
      this.prisma.stockCount.findFirst({
        where: {
          locationId: openDay.locationId,
          businessDate: openDay.businessDate,
          phase: this.toPrismaPhase(phase),
        },
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
        include: submittedCountInclude,
      }),
    ]);

    return {
      businessDay: this.tradingDayService.toResponse(openDay),
      phase,
      items: items.map((item) => this.toSheetItem(item)),
      submittedCount:
        submittedCount === null
          ? null
          : this.toSubmittedCount(submittedCount),
    };
  }

  private validateLineValues(input: SubmitStockCountDto): void {
    if (input.lines.length === 0) {
      throw new BadRequestException('At least one count line is required');
    }

    const itemIds = new Set<string>();
    for (const line of input.lines) {
      if (itemIds.has(line.inventoryItemId)) {
        throw new BadRequestException(
          `Inventory item ${line.inventoryItemId} appears more than once`,
        );
      }
      itemIds.add(line.inventoryItemId);

      const hasQuantity = line.quantity !== undefined;
      const hasLevel = line.level !== undefined;
      if (hasQuantity === hasLevel) {
        throw new BadRequestException(
          `Exactly one count value is required for inventory item ${line.inventoryItemId}`,
        );
      }
      if (
        hasQuantity &&
        (!Number.isInteger(line.quantity) || line.quantity! < 0)
      ) {
        throw new BadRequestException(
          'Count quantities must be whole numbers zero or greater',
        );
      }
      if (
        hasLevel &&
        !Object.values(SharedStockLevel).includes(line.level!)
      ) {
        throw new BadRequestException('Count level is invalid');
      }
    }
  }

  private async requireOpenDay(): Promise<OpenTradingDay> {
    const day = await this.tradingDayService.findCurrentOpenDay();
    if (day === null) {
      throw new ConflictException('No business day is open');
    }
    return day;
  }

  private toPrismaPhase(
    phase: 'open' | 'close',
  ): PrismaStockCountPhase {
    return phase === 'open'
      ? PrismaStockCountPhase.OPEN
      : PrismaStockCountPhase.CLOSE;
  }

  private toSheetItem(item: {
    id: string;
    name: string;
    size: string | null;
    unit: string;
    countMethod: CountMethod;
    critical: boolean;
  }): CountSheetItem {
    return {
      ...item,
      countMethod: item.countMethod as SharedCountMethod,
    };
  }

  private toSubmittedCount(
    count: SubmittedStockCountRecord,
  ): SubmittedStockCount {
    return {
      id: count.id,
      locationId: count.locationId,
      businessDate: count.businessDate.toISOString().slice(0, 10),
      phase:
        count.phase === PrismaStockCountPhase.OPEN ? 'open' : 'close',
      submittedByStaffMemberId: count.submittedByStaffMemberId,
      submittedByNameSnapshot: count.submittedByNameSnapshot,
      shiftLeadStaffMemberId: count.shiftLeadStaffMemberId,
      shiftLeadNameSnapshot: count.shiftLeadNameSnapshot,
      recordedAt: count.recordedAt.toISOString(),
      lines: count.lines.map((line) => ({
        inventoryItemId: line.inventoryItemId,
        itemName: line.inventoryItem.name,
        quantity: line.quantity,
        level: line.level as SharedStockLevel | null,
      })),
    };
  }
}
