import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CountMethod as SharedCountMethod } from '@coffee-shop/shared';
import { CountMethod, DayType } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { InventoryItemsService } from './inventory-items.service';

describe('InventoryItemsService', () => {
  const categoryId = '56fe72cc-5c03-466c-bd87-7c5d2d732bbe';
  const itemId = '9e55c455-879c-4ea8-8365-433e0e2cf4a3';
  const now = new Date('2026-07-25T00:00:00Z');

  function itemRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: itemId,
      sku: `INVENTORY-${itemId}`,
      name: '16oz Cup',
      categoryId,
      unit: 'pcs',
      size: '16oz',
      countMethod: CountMethod.QUANTITY,
      critical: true,
      reconciled: true,
      active: true,
      createdAt: now,
      updatedAt: now,
      category: {
        id: categoryId,
        name: 'Cups',
        sortWeight: 1,
        active: true,
        createdAt: now,
        updatedAt: now,
      },
      parLevels: [],
      ...overrides,
    };
  }

  function createPrisma() {
    return {
      inventoryItem: {
        create: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      stockCategory: {
        findUnique: jest.fn().mockResolvedValue({ id: categoryId }),
      },
      parLevel: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
    };
  }

  it('returns only active stock items for Cup/Lid selectors', async () => {
    const prisma = createPrisma();
    prisma.inventoryItem.findMany.mockResolvedValue([]);
    const service = new InventoryItemsService(
      prisma as unknown as PrismaService,
    );

    await service.listActive();

    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  });

  it('combines search and all selected stock-item filters with AND semantics', async () => {
    const prisma = createPrisma();
    prisma.inventoryItem.findMany.mockResolvedValue([]);
    const service = new InventoryItemsService(
      prisma as unknown as PrismaService,
    );

    await service.list({
      search: 'cup',
      categoryId,
      countMethod: SharedCountMethod.QUANTITY,
      reconciled: true,
      critical: false,
      active: true,
    });

    expect(prisma.inventoryItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          name: { contains: 'cup', mode: 'insensitive' },
          categoryId,
          countMethod: CountMethod.QUANTITY,
          reconciled: true,
          critical: false,
          active: true,
        },
      }),
    );
  });

  it('rejects a Reconciled and Level create before persisting anything', async () => {
    const prisma = createPrisma();
    const service = new InventoryItemsService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.create({
        categoryId,
        name: 'Cup',
        unit: 'pcs',
        countMethod: SharedCountMethod.LEVEL,
        critical: false,
        reconciled: true,
        active: true,
      }),
    ).rejects.toEqual(
      new BadRequestException({
        message:
          'Reconciled stock items must use the Quantity count method',
        field: 'countMethod',
        reason: 'RECONCILED_REQUIRES_QUANTITY',
      }),
    );
    expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
  });

  it('rejects changing a Reconciled item to Level and leaves it unchanged', async () => {
    const prisma = createPrisma();
    prisma.inventoryItem.findUnique.mockResolvedValue(itemRecord());
    const service = new InventoryItemsService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.update(itemId, { countMethod: SharedCountMethod.LEVEL }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
  });

  it('returns a typed delete reason for catalog and stock-count references', async () => {
    const prisma = createPrisma();
    prisma.inventoryItem.findUnique.mockResolvedValue({
      id: itemId,
      _count: {
        cupProductVariants: 1,
        lidProductVariants: 0,
        stockCountLines: 2,
      },
    });
    const service = new InventoryItemsService(
      prisma as unknown as PrismaService,
    );

    await expect(service.remove(itemId)).rejects.toEqual(
      new ConflictException({
        message:
          'This stock item cannot be deleted because it is referenced by existing records',
        reason: 'STOCK_ITEM_REFERENCED',
        references: ['CATALOG_CUP_MAPPING', 'STOCK_COUNT_LINE'],
      }),
    );
    expect(prisma.inventoryItem.delete).not.toHaveBeenCalled();
  });

  it('deletes an unreferenced stock item', async () => {
    const prisma = createPrisma();
    prisma.inventoryItem.findUnique.mockResolvedValue({
      id: itemId,
      _count: {
        cupProductVariants: 0,
        lidProductVariants: 0,
        stockCountLines: 0,
      },
    });
    const service = new InventoryItemsService(
      prisma as unknown as PrismaService,
    );

    await service.remove(itemId);

    expect(prisma.inventoryItem.delete).toHaveBeenCalledWith({
      where: { id: itemId },
    });
  });

  it.each([
    {
      input: { parQty: 10, lowThreshold: null, urgentThreshold: 2 },
      reason: 'URGENT_REQUIRES_LOW',
    },
    {
      input: { parQty: 10, lowThreshold: 11, urgentThreshold: null },
      reason: 'LOW_EXCEEDS_PAR',
    },
    {
      input: { parQty: 10, lowThreshold: 5, urgentThreshold: 6 },
      reason: 'URGENT_EXCEEDS_LOW',
    },
  ])('rejects invalid par ordering: $reason', async ({ input, reason }) => {
    const prisma = createPrisma();
    prisma.inventoryItem.findUnique.mockResolvedValue({ id: itemId });
    const service = new InventoryItemsService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.upsertParLevel(itemId, DayType.NORMAL, input),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ reason }),
    });
    expect(prisma.parLevel.upsert).not.toHaveBeenCalled();
  });

  it('accepts all-zero thresholds and updates only the selected day type', async () => {
    const prisma = createPrisma();
    prisma.inventoryItem.findUnique.mockResolvedValue({ id: itemId });
    prisma.parLevel.upsert.mockResolvedValue({
      id: '3daf8107-e86f-43a7-83bd-1252648fb243',
      inventoryItemId: itemId,
      dayType: DayType.PEAK,
      parQty: 0,
      lowThreshold: 0,
      urgentThreshold: 0,
    });
    const service = new InventoryItemsService(
      prisma as unknown as PrismaService,
    );

    await service.upsertParLevel(itemId, DayType.PEAK, {
      parQty: 0,
      lowThreshold: 0,
      urgentThreshold: 0,
    });

    expect(prisma.parLevel.upsert).toHaveBeenCalledWith({
      where: {
        inventoryItemId_dayType: {
          inventoryItemId: itemId,
          dayType: DayType.PEAK,
        },
      },
      update: {
        parQty: 0,
        lowThreshold: 0,
        urgentThreshold: 0,
      },
      create: {
        inventoryItemId: itemId,
        dayType: DayType.PEAK,
        parQty: 0,
        lowThreshold: 0,
        urgentThreshold: 0,
      },
    });
  });
});
