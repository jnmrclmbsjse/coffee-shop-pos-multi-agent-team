import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import type { StockCategorySummary } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateStockCategoryDto,
  ReorderStockCategoriesDto,
  UpdateStockCategoryDto,
} from './inventory.dto';
import { StockCategoriesService } from './stock-categories.service';

@Controller('inventory/categories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class StockCategoriesController {
  constructor(
    private readonly stockCategoriesService: StockCategoriesService,
  ) {}

  @Get()
  list(): Promise<StockCategorySummary[]> {
    return this.stockCategoriesService.list();
  }

  @Post()
  create(
    @Body() input: CreateStockCategoryDto,
  ): Promise<StockCategorySummary> {
    return this.stockCategoriesService.create(input);
  }

  @Put('reorder')
  @HttpCode(204)
  async reorder(@Body() input: ReorderStockCategoriesDto): Promise<void> {
    await this.stockCategoriesService.reorder(input.items);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateStockCategoryDto,
  ): Promise<StockCategorySummary> {
    return this.stockCategoriesService.update(id, input);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.stockCategoriesService.remove(id);
  }
}
