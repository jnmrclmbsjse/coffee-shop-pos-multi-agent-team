import { Injectable } from '@nestjs/common';
import type { InventoryItemOption } from '@coffee-shop/shared';
import { PrismaService } from '../prisma/prisma.service';

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
}
