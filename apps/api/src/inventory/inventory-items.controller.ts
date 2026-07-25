import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import type {
  InventoryItem,
  InventoryItemOption,
  ParLevel,
} from '@coffee-shop/shared';
import { DayType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateInventoryItemDto,
  InventoryItemListQueryDto,
  UpdateInventoryItemDto,
  UpsertParLevelDto,
} from './inventory.dto';
import { InventoryItemsService } from './inventory-items.service';

@Controller('inventory/items')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class InventoryItemsController {
  constructor(
    private readonly inventoryItemsService: InventoryItemsService,
  ) {}

  @Get('options')
  listActive(): Promise<InventoryItemOption[]> {
    return this.inventoryItemsService.listActive();
  }

  @Get()
  list(@Query() query: InventoryItemListQueryDto): Promise<InventoryItem[]> {
    return this.inventoryItemsService.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<InventoryItem> {
    return this.inventoryItemsService.get(id);
  }

  @Post()
  create(@Body() input: CreateInventoryItemDto): Promise<InventoryItem> {
    return this.inventoryItemsService.create(input);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateInventoryItemDto,
  ): Promise<InventoryItem> {
    return this.inventoryItemsService.update(id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.inventoryItemsService.remove(id);
  }

  @Get(':id/par-levels')
  listParLevels(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ParLevel[]> {
    return this.inventoryItemsService.listParLevels(id);
  }

  @Put(':id/par-levels/:dayType')
  upsertParLevel(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayType', new ParseEnumPipe(DayType)) dayType: DayType,
    @Body() input: UpsertParLevelDto,
  ): Promise<ParLevel> {
    return this.inventoryItemsService.upsertParLevel(id, dayType, input);
  }
}
