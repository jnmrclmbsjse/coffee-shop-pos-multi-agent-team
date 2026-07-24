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
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import type { Product } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateProductDto,
  ProductListQueryDto,
  ReorderDto,
  UpdateAvailabilityDto,
  UpdateProductDto,
} from './catalog.dto';
import { CatalogService } from './catalog.service';

@Controller('catalog/products')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ProductsController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  list(@Query() query: ProductListQueryDto): Promise<Product[]> {
    return this.catalogService.listProducts(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<Product> {
    return this.catalogService.getProduct(id);
  }

  @Post()
  create(@Body() input: CreateProductDto): Promise<Product> {
    return this.catalogService.createProduct(input);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateProductDto,
  ): Promise<Product> {
    return this.catalogService.updateProduct(id, input);
  }

  @Patch(':id/availability')
  @Roles(Role.ADMIN, Role.STAFF)
  updateAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateAvailabilityDto,
  ): Promise<Product> {
    return this.catalogService.updateAvailability(id, input.available);
  }

  @Put(':id/sizes/reorder')
  @HttpCode(204)
  async reorderSizes(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReorderDto,
  ): Promise<void> {
    await this.catalogService.reorderSizes(id, input.items);
  }

  @Delete(':productId/sizes/:sizeId')
  @HttpCode(204)
  async removeSize(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('sizeId', ParseUUIDPipe) sizeId: string,
  ): Promise<void> {
    await this.catalogService.removeSize(productId, sizeId);
  }
}
