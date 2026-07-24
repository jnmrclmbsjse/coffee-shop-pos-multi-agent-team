import type { PrismaService } from '../prisma/prisma.service';
import { InventoryItemsService } from './inventory-items.service';

describe('InventoryItemsService', () => {
  it('returns only active stock items for Cup/Lid selectors', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new InventoryItemsService({
      inventoryItem: { findMany },
    } as unknown as PrismaService);

    await service.listActive();

    expect(findMany).toHaveBeenCalledWith({
      where: { active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  });
});
