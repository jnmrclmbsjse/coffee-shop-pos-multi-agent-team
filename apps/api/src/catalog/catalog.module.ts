import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CategoriesController } from './categories.controller';
import { CatalogService } from './catalog.service';
import { ProductsController } from './products.controller';

/** Product and menu definitions. Feature providers belong here. */
@Module({
  imports: [AuthModule],
  controllers: [CategoriesController, ProductsController],
  providers: [CatalogService],
})
export class CatalogModule {}
