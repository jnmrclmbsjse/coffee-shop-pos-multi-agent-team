import {
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from './catalog.service';

describe('CatalogService', () => {
  const categoryId = '56fe72cc-5c03-466c-bd87-7c5d2d732bbe';
  const productId = '9e55c455-879c-4ea8-8365-433e0e2cf4a3';
  const sizeId = '3daf8107-e86f-43a7-83bd-1252648fb243';
  const cupId = '99f023e9-7b99-4551-be0a-a26005ec0bc5';
  const now = new Date('2026-07-24T00:00:00Z');

  function productRecord(available = true) {
    return {
      id: productId,
      sku: `PRODUCT-${productId}`,
      name: 'Latte',
      categoryId,
      active: true,
      available,
      createdAt: now,
      updatedAt: now,
      category: {
        id: categoryId,
        name: 'Coffee',
        sortWeight: 0,
        active: true,
        createdAt: now,
        updatedAt: now,
      },
      variants: [
        {
          id: sizeId,
          productId,
          name: 'Regular',
          priceCents: 15000,
          sortWeight: 0,
          active: true,
          cupInventoryItemId: cupId,
          lidInventoryItemId: null,
        },
      ],
    };
  }

  function createPrisma() {
    const prisma = {
      category: {
        count: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ id: categoryId }),
        update: jest.fn(),
      },
      product: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      productVariant: {
        count: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      inventoryItem: {
        count: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(
      async (operation: unknown[] | ((client: typeof prisma) => unknown)) =>
        typeof operation === 'function'
          ? operation(prisma)
          : Promise.all(operation),
    );
    return prisma;
  }

  it('lists categories in persisted order with product counts', async () => {
    const prisma = createPrisma();
    prisma.category.findMany.mockResolvedValue([
      {
        id: categoryId,
        name: 'Coffee',
        sortWeight: 0,
        active: true,
        createdAt: now,
        updatedAt: now,
        _count: { products: 3 },
      },
    ]);
    const service = new CatalogService(
      prisma as unknown as PrismaService,
    );

    await expect(service.listCategories()).resolves.toEqual([
      expect.objectContaining({ name: 'Coffee', productCount: 3 }),
    ]);
    expect(prisma.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ sortWeight: 'asc' }, { name: 'asc' }],
      }),
    );
  });

  it('rejects a category name duplicate without regard to case', async () => {
    const prisma = createPrisma();
    prisma.category.findFirst.mockResolvedValue({ id: categoryId });
    const service = new CatalogService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.createCategory({
        name: 'coffee',
        sortWeight: 0,
        active: true,
      }),
    ).rejects.toEqual(
      new ConflictException('A category with this name already exists'),
    );
    expect(prisma.category.create).not.toHaveBeenCalled();
  });

  it('creates a product with integer-cent sizes and active mappings', async () => {
    const prisma = createPrisma();
    prisma.inventoryItem.count.mockResolvedValue(1);
    prisma.product.create.mockResolvedValue(productRecord());
    const service = new CatalogService(
      prisma as unknown as PrismaService,
    );

    const product = await service.createProduct({
      categoryId,
      name: 'Latte',
      active: true,
      available: true,
      sizes: [
        {
          name: 'Regular',
          priceCents: 15000,
          sortWeight: 0,
          active: true,
          cupInventoryItemId: cupId,
          lidInventoryItemId: null,
        },
      ],
    });

    expect(prisma.inventoryItem.count).toHaveBeenCalledWith({
      where: { id: { in: [cupId] }, active: true },
    });
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          categoryId,
          name: 'Latte',
          available: true,
          variants: {
            create: [
              expect.objectContaining({
                priceCents: 15000,
                cupInventoryItemId: cupId,
              }),
            ],
          },
        }),
      }),
    );
    expect(product.variants[0]!.priceCents).toBe(15000);
  });

  it('rejects inactive or unknown Cup/Lid mappings', async () => {
    const prisma = createPrisma();
    prisma.inventoryItem.count.mockResolvedValue(0);
    const service = new CatalogService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.createProduct({
        categoryId,
        name: 'Latte',
        active: true,
        available: true,
        sizes: [
          {
            name: 'Regular',
            priceCents: 15000,
            sortWeight: 0,
            active: true,
            cupInventoryItemId: cupId,
            lidInventoryItemId: null,
          },
        ],
      }),
    ).rejects.toEqual(
      new BadRequestException(
        'One or more Cup or Lid mappings are not selectable inventory items',
      ),
    );
    expect(prisma.product.create).not.toHaveBeenCalled();
  });

  it('searches product names case-insensitively and applies filters', async () => {
    const prisma = createPrisma();
    prisma.product.findMany.mockResolvedValue([]);
    const service = new CatalogService(
      prisma as unknown as PrismaService,
    );

    await service.listProducts({
      search: 'lat',
      categoryId,
      active: false,
      sort: 'name',
    });

    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          name: { contains: 'lat', mode: 'insensitive' },
          categoryId,
          active: false,
        },
        orderBy: [{ name: 'asc' }],
      }),
    );
  });

  it('persists availability as the shared product state', async () => {
    const prisma = createPrisma();
    prisma.product.findUnique.mockResolvedValue({ id: productId });
    prisma.product.update.mockResolvedValue(productRecord(false));
    const service = new CatalogService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.updateAvailability(productId, false),
    ).resolves.toEqual(expect.objectContaining({ available: false }));
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: productId },
        data: { available: false },
      }),
    );
  });

  it('blocks removal of the last remaining size', async () => {
    const prisma = createPrisma();
    prisma.productVariant.findMany.mockResolvedValue([
      { id: sizeId, _count: { saleLines: 0 } },
    ]);
    const service = new CatalogService(
      prisma as unknown as PrismaService,
    );

    await expect(service.removeSize(productId, sizeId)).rejects.toEqual(
      new BadRequestException('A product must retain at least one size'),
    );
    expect(prisma.productVariant.delete).not.toHaveBeenCalled();
  });

  it('blocks removal of a size referenced by an existing sale', async () => {
    const prisma = createPrisma();
    prisma.productVariant.findMany.mockResolvedValue([
      { id: sizeId, _count: { saleLines: 1 } },
      { id: 'other-size', _count: { saleLines: 0 } },
    ]);
    const service = new CatalogService(
      prisma as unknown as PrismaService,
    );

    await expect(service.removeSize(productId, sizeId)).rejects.toEqual(
      new ConflictException(
        'This size cannot be removed because it is used by an existing sale',
      ),
    );
    expect(prisma.productVariant.delete).not.toHaveBeenCalled();
  });

  it('hard-deletes an unreferenced size when another size remains', async () => {
    const prisma = createPrisma();
    prisma.productVariant.findMany.mockResolvedValue([
      { id: sizeId, _count: { saleLines: 0 } },
      { id: 'other-size', _count: { saleLines: 0 } },
    ]);
    const service = new CatalogService(
      prisma as unknown as PrismaService,
    );

    await service.removeSize(productId, sizeId);

    expect(prisma.productVariant.delete).toHaveBeenCalledWith({
      where: { id: sizeId },
    });
  });
});
