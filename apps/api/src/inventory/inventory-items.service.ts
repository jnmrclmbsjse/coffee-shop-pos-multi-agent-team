import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CountMethod as SharedCountMethod,
  DayType as SharedDayType,
} from '@coffee-shop/shared';
import type {
  InventoryItem,
  InventoryItemOption,
  ParLevel,
} from '@coffee-shop/shared';
import { CountMethod, DayType, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateInventoryItemDto,
  InventoryItemListQueryDto,
  UpdateInventoryItemDto,
  UpsertParLevelDto,
} from './inventory.dto';

const inventoryItemInclude = {
  category: true,
  parLevels: { orderBy: { dayType: 'asc' } },
} satisfies Prisma.InventoryItemInclude;

type InventoryItemRecord = Prisma.InventoryItemGetPayload<{
  include: typeof inventoryItemInclude;
}>;

@Injectable()
export class InventoryItemsService {
  constructor(private readonly prisma: PrismaService) {}

  listActive(): Promise<InventoryItemOption[]> {
    return this.prisma.inventoryItem.findMany({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async list(query: InventoryItemListQueryDto): Promise<InventoryItem[]> {
    const records = await this.prisma.inventoryItem.findMany({
      where: {
        ...(query.search
          ? { name: { contains: query.search, mode: 'insensitive' } }
          : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.countMethod
          ? { countMethod: query.countMethod as CountMethod }
          : {}),
        ...(query.reconciled === undefined
          ? {}
          : { reconciled: query.reconciled }),
        ...(query.critical === undefined
          ? {}
          : { critical: query.critical }),
        ...(query.active === undefined ? {} : { active: query.active }),
      },
      include: inventoryItemInclude,
      orderBy: [
        { category: { sortWeight: 'asc' } },
        { category: { name: 'asc' } },
        { name: 'asc' },
      ],
    });
    return records.map((record) => this.toInventoryItem(record));
  }

  async get(id: string): Promise<InventoryItem> {
    const item = await this.findItem(id);
    if (!item) {
      throw new NotFoundException('Stock item not found');
    }
    return this.toInventoryItem(item);
  }

  async create(input: CreateInventoryItemDto): Promise<InventoryItem> {
    await this.requireCategory(input.categoryId);
    this.validateReconciled(input.reconciled, input.countMethod);
    const id = randomUUID();
    try {
      const item = await this.prisma.inventoryItem.create({
        data: {
          id,
          sku: `INVENTORY-${id}`,
          categoryId: input.categoryId,
          name: input.name,
          unit: input.unit,
          size: input.size ?? null,
          countMethod: input.countMethod as CountMethod,
          critical: input.critical,
          reconciled: input.reconciled,
          active: input.active,
        },
        include: inventoryItemInclude,
      });
      return this.toInventoryItem(item);
    } catch (error: unknown) {
      this.rethrowConstraint(error);
    }
  }

  async update(
    id: string,
    input: UpdateInventoryItemDto,
  ): Promise<InventoryItem> {
    const existing = await this.findItem(id);
    if (!existing) {
      throw new NotFoundException('Stock item not found');
    }
    if (input.categoryId !== undefined) {
      await this.requireCategory(input.categoryId);
    }
    this.validateReconciled(
      input.reconciled ?? existing.reconciled,
      (input.countMethod as CountMethod | undefined) ??
        existing.countMethod,
    );

    try {
      const item = await this.prisma.inventoryItem.update({
        where: { id },
        data: {
          ...input,
          countMethod: input.countMethod as CountMethod | undefined,
          size: input.size === undefined ? undefined : input.size,
        },
        include: inventoryItemInclude,
      });
      return this.toInventoryItem(item);
    } catch (error: unknown) {
      this.rethrowConstraint(error);
    }
  }

  async remove(id: string): Promise<void> {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
      select: {
        id: true,
        _count: {
          select: {
            cupProductVariants: true,
            lidProductVariants: true,
            stockCountLines: true,
          },
        },
      },
    });
    if (!item) {
      throw new NotFoundException('Stock item not found');
    }

    const references = [
      ...(item._count.cupProductVariants > 0 ? ['CATALOG_CUP_MAPPING'] : []),
      ...(item._count.lidProductVariants > 0 ? ['CATALOG_LID_MAPPING'] : []),
      ...(item._count.stockCountLines > 0 ? ['STOCK_COUNT_LINE'] : []),
    ];
    if (references.length > 0) {
      throw this.referencedItemError(references);
    }

    try {
      await this.prisma.inventoryItem.delete({ where: { id } });
    } catch (error: unknown) {
      this.rethrowConstraint(error);
    }
  }

  async listParLevels(id: string): Promise<ParLevel[]> {
    await this.requireItem(id);
    const records = await this.prisma.parLevel.findMany({
      where: { inventoryItemId: id },
      orderBy: { dayType: 'asc' },
    });
    return records.map((record) => this.toParLevel(record));
  }

  async upsertParLevel(
    inventoryItemId: string,
    dayType: DayType,
    input: UpsertParLevelDto,
  ): Promise<ParLevel> {
    await this.requireItem(inventoryItemId);
    const lowThreshold = input.lowThreshold ?? null;
    const urgentThreshold = input.urgentThreshold ?? null;
    this.validateParLevel(input.parQty, lowThreshold, urgentThreshold);

    const record = await this.prisma.parLevel.upsert({
      where: {
        inventoryItemId_dayType: { inventoryItemId, dayType },
      },
      update: {
        parQty: input.parQty,
        lowThreshold,
        urgentThreshold,
      },
      create: {
        inventoryItemId,
        dayType,
        parQty: input.parQty,
        lowThreshold,
        urgentThreshold,
      },
    });
    return this.toParLevel(record);
  }

  private async requireCategory(id: string): Promise<void> {
    const category = await this.prisma.stockCategory.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!category) {
      throw new BadRequestException({
        message: 'Selected stock category does not exist',
        field: 'categoryId',
        reason: 'STOCK_CATEGORY_NOT_FOUND',
      });
    }
  }

  private async requireItem(id: string): Promise<void> {
    const item = await this.prisma.inventoryItem.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!item) {
      throw new NotFoundException('Stock item not found');
    }
  }

  private findItem(id: string): Promise<InventoryItemRecord | null> {
    return this.prisma.inventoryItem.findUnique({
      where: { id },
      include: inventoryItemInclude,
    });
  }

  private validateReconciled(
    reconciled: boolean,
    countMethod: CountMethod | SharedCountMethod,
  ): void {
    if (reconciled && countMethod === CountMethod.LEVEL) {
      throw new BadRequestException({
        message:
          'Reconciled stock items must use the Quantity count method',
        field: 'countMethod',
        reason: 'RECONCILED_REQUIRES_QUANTITY',
      });
    }
  }

  private validateParLevel(
    parQty: number,
    lowThreshold: number | null,
    urgentThreshold: number | null,
  ): void {
    if (urgentThreshold !== null && lowThreshold === null) {
      throw new BadRequestException({
        message: 'Urgent threshold requires a Low threshold',
        field: 'urgentThreshold',
        reason: 'URGENT_REQUIRES_LOW',
      });
    }
    if (lowThreshold !== null && lowThreshold > parQty) {
      throw new BadRequestException({
        message: 'Low threshold must be less than or equal to Par',
        field: 'lowThreshold',
        reason: 'LOW_EXCEEDS_PAR',
      });
    }
    if (
      urgentThreshold !== null &&
      lowThreshold !== null &&
      urgentThreshold > lowThreshold
    ) {
      throw new BadRequestException({
        message: 'Urgent threshold must be less than or equal to Low',
        field: 'urgentThreshold',
        reason: 'URGENT_EXCEEDS_LOW',
      });
    }
  }

  private referencedItemError(references: string[]): ConflictException {
    return new ConflictException({
      message:
        'This stock item cannot be deleted because it is referenced by existing records',
      reason: 'STOCK_ITEM_REFERENCED',
      references,
    });
  }

  private rethrowConstraint(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2003'
    ) {
      throw this.referencedItemError(['DATABASE_REFERENCE']);
    }
    throw error;
  }

  private toInventoryItem(record: InventoryItemRecord): InventoryItem {
    return {
      id: record.id,
      sku: record.sku,
      name: record.name,
      categoryId: record.categoryId,
      category: record.category,
      unit: record.unit,
      size: record.size,
      countMethod: record.countMethod as SharedCountMethod,
      critical: record.critical,
      reconciled: record.reconciled,
      active: record.active,
      parLevels: record.parLevels.map((parLevel) =>
        this.toParLevel(parLevel),
      ),
    };
  }

  private toParLevel(record: {
    id: string;
    inventoryItemId: string;
    dayType: DayType;
    parQty: number;
    lowThreshold: number | null;
    urgentThreshold: number | null;
  }): ParLevel {
    return {
      ...record,
      dayType: record.dayType as SharedDayType,
    };
  }
}
