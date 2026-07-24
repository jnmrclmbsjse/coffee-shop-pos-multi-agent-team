import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import type { InventoryItemOption } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { InventoryItemsService } from './inventory-items.service';

@Controller('inventory/items')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class InventoryItemsController {
  constructor(
    private readonly inventoryItemsService: InventoryItemsService,
  ) {}

  @Get()
  listActive(): Promise<InventoryItemOption[]> {
    return this.inventoryItemsService.listActive();
  }
}
