import {
  Body,
  Controller,
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
import type { CatalogCategorySummary } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateCategoryDto,
  ReorderDto,
  UpdateCategoryDto,
} from './catalog.dto';
import { CatalogService } from './catalog.service';

@Controller('catalog/categories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class CategoriesController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  list(): Promise<CatalogCategorySummary[]> {
    return this.catalogService.listCategories();
  }

  @Post()
  create(
    @Body() input: CreateCategoryDto,
  ): Promise<CatalogCategorySummary> {
    return this.catalogService.createCategory(input);
  }

  @Put('reorder')
  @HttpCode(204)
  async reorder(@Body() input: ReorderDto): Promise<void> {
    await this.catalogService.reorderCategories(input.items);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateCategoryDto,
  ): Promise<CatalogCategorySummary> {
    return this.catalogService.updateCategory(id, input);
  }
}
