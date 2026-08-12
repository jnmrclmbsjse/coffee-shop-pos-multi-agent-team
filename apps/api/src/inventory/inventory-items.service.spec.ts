import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  CountMethod as SharedCountMethod,
  StockLevel as SharedStockLevel,
} from '@coffee-shop/shared';
import { CountMethod, DayType, StockLevel } from '@prisma/client';
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
    prisma.inventoryItem.findUnique.mockResolvedValue({
      id: itemId,
      countMethod: CountMethod.QUANTITY,
    });
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
    prisma.inventoryItem.findUnique.mockResolvedValue({
      id: itemId,
      countMethod: CountMethod.QUANTITY,
    });
    prisma.parLevel.upsert.mockResolvedValue({
      id: '3daf8107-e86f-43a7-83bd-1252648fb243',
      inventoryItemId: itemId,
      dayType: DayType.PEAK,
      parQty: 0,
      parLevel: null,
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
        parLevel: null,
        lowThreshold: 0,
        urgentThreshold: 0,
      },
      create: {
        inventoryItemId: itemId,
        dayType: DayType.PEAK,
        parQty: 0,
        parLevel: null,
        lowThreshold: 0,
        urgentThreshold: 0,
      },
    });
  });

  it('persists and returns a level target for only the selected day type', async () => {
    const prisma = createPrisma();
    prisma.inventoryItem.findUnique.mockResolvedValue({
      id: itemId,
      countMethod: CountMethod.LEVEL,
    });
    prisma.parLevel.upsert.mockResolvedValue({
      id: '3daf8107-e86f-43a7-83bd-1252648fb243',
      inventoryItemId: itemId,
      dayType: DayType.NORMAL,
      parQty: null,
      parLevel: StockLevel.HALF,
      lowThreshold: null,
      urgentThreshold: null,
    });
    const service = new InventoryItemsService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.upsertParLevel(itemId, DayType.NORMAL, {
        parLevel: SharedStockLevel.HALF,
      }),
    ).resolves.toMatchObject({
      dayType: DayType.NORMAL,
      parQty: null,
      parLevel: SharedStockLevel.HALF,
    });

    expect(prisma.parLevel.upsert).toHaveBeenCalledWith({
      where: {
        inventoryItemId_dayType: {
          inventoryItemId: itemId,
          dayType: DayType.NORMAL,
        },
      },
      update: {
        parQty: null,
        parLevel: StockLevel.HALF,
        lowThreshold: null,
        urgentThreshold: null,
      },
      create: {
        inventoryItemId: itemId,
        dayType: DayType.NORMAL,
        parQty: null,
        parLevel: StockLevel.HALF,
        lowThreshold: null,
        urgentThreshold: null,
      },
    });
  });

  it('returns saved level targets when par settings are listed', async () => {
    const prisma = createPrisma();
    prisma.inventoryItem.findUnique.mockResolvedValue({
      id: itemId,
      countMethod: CountMethod.LEVEL,
    });
    prisma.parLevel.findMany.mockResolvedValue([
      {
        id: '3daf8107-e86f-43a7-83bd-1252648fb243',
        inventoryItemId: itemId,
        dayType: DayType.PEAK,
        parQty: null,
        parLevel: StockLevel.THREE_QUARTERS,
        lowThreshold: null,
        urgentThreshold: null,
      },
    ]);
    const service = new InventoryItemsService(
      prisma as unknown as PrismaService,
    );

    await expect(service.listParLevels(itemId)).resolves.toEqual([
      expect.objectContaining({
        dayType: DayType.PEAK,
        parQty: null,
        parLevel: SharedStockLevel.THREE_QUARTERS,
      }),
    ]);
  });

  it.each([
    {
      countMethod: CountMethod.LEVEL,
      input: { parQty: 10 },
      field: 'parQty',
      reason: 'PAR_COUNT_METHOD_MISMATCH',
    },
    {
      countMethod: CountMethod.QUANTITY,
      input: { parLevel: SharedStockLevel.HALF },
      field: 'parLevel',
      reason: 'PAR_COUNT_METHOD_MISMATCH',
    },
    {
      countMethod: CountMethod.LEVEL,
      input: { parQty: 10, parLevel: SharedStockLevel.HALF },
      field: 'parQty',
      reason: 'PAR_COUNT_METHOD_MISMATCH',
    },
    {
      countMethod: CountMethod.QUANTITY,
      input: { parQty: 10, parLevel: SharedStockLevel.HALF },
      field: 'parLevel',
      reason: 'PAR_COUNT_METHOD_MISMATCH',
    },
    {
      countMethod: CountMethod.LEVEL,
      input: {},
      field: 'parLevel',
      reason: 'PAR_VALUE_REQUIRED',
    },
    {
      countMethod: CountMethod.QUANTITY,
      input: {},
      field: 'parQty',
      reason: 'PAR_VALUE_REQUIRED',
    },
    {
      countMethod: CountMethod.LEVEL,
      input: { parLevel: SharedStockLevel.HALF, lowThreshold: 2 },
      field: 'lowThreshold',
      reason: 'LEVEL_PAR_REJECTS_THRESHOLDS',
    },
    {
      countMethod: CountMethod.LEVEL,
      input: { parLevel: SharedStockLevel.HALF, urgentThreshold: 1 },
      field: 'urgentThreshold',
      reason: 'LEVEL_PAR_REJECTS_THRESHOLDS',
    },
  ])(
    'rejects a par shape that does not match $countMethod ($field)',
    async ({ countMethod, input, field, reason }) => {
      const prisma = createPrisma();
      prisma.inventoryItem.findUnique.mockResolvedValue({
        id: itemId,
        countMethod,
      });
      const service = new InventoryItemsService(
        prisma as unknown as PrismaService,
      );

      await expect(
        service.upsertParLevel(itemId, DayType.NORMAL, input),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ field, reason }),
      });
      expect(prisma.parLevel.upsert).not.toHaveBeenCalled();
    },
  );
});
