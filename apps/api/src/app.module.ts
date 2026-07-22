import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { CatalogModule } from './catalog/catalog.module';
import { InventoryModule } from './inventory/inventory.module';
import { SalesModule } from './sales/sales.module';

@Module({
  imports: [CatalogModule, InventoryModule, SalesModule],
  controllers: [AppController],
})
export class AppModule {}
