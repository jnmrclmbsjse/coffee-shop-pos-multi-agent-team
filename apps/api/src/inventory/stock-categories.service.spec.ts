import { BadRequestException, ConflictException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { StockCategoriesService } from './stock-categories.service';

describe('StockCategoriesService', () => {
  const categoryId = '56fe72cc-5c03-466c-bd87-7c5d2d732bbe';
  const now = new Date('2026-07-25T00:00:00Z');

  function createPrisma() {
    const prisma = {
      stockCategory: {
        count: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((operations: unknown[]) =>
      Promise.all(operations),
    );
    return prisma;
  }

  it('lists categories by persisted weight and stable name with item counts', async () => {
    const prisma = createPrisma();
    prisma.stockCategory.findMany.mockResolvedValue([
      {
        id: categoryId,
        name: 'Cups',
        sortWeight: 1,
        active: true,
        createdAt: now,
        updatedAt: now,
        _count: { items: 3 },
      },
    ]);
    const service = new StockCategoriesService(
      prisma as unknown as PrismaService,
    );

    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ name: 'Cups', itemCount: 3 }),
    ]);
    expect(prisma.stockCategory.findMany).toHaveBeenCalledWith({
      include: { _count: { select: { items: true } } },
      orderBy: [{ sortWeight: 'asc' }, { name: 'asc' }],
    });
  });

  it('blocks deletion of a non-empty category with a typed reason', async () => {
    const prisma = createPrisma();
    prisma.stockCategory.findUnique.mockResolvedValue({
      id: categoryId,
      _count: { items: 1 },
    });
    const service = new StockCategoriesService(
      prisma as unknown as PrismaService,
    );

    await expect(service.remove(categoryId)).rejects.toEqual(
      new ConflictException({
        message:
          'This stock category cannot be deleted because it contains stock items',
        reason: 'STOCK_CATEGORY_NOT_EMPTY',
      }),
    );
    expect(prisma.stockCategory.delete).not.toHaveBeenCalled();
  });

  it('rejects duplicate IDs during category reorder', async () => {
    const prisma = createPrisma();
    const service = new StockCategoriesService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.reorder([
        { id: categoryId, sortWeight: 0 },
        { id: categoryId, sortWeight: 1 },
      ]),
    ).rejects.toEqual(
      new BadRequestException('A stock category can appear only once'),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
