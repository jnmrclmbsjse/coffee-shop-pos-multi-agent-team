import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TradingDayModule } from '../trading-day/trading-day.module';
import { InventoryItemsController } from './inventory-items.controller';
import { InventoryItemsService } from './inventory-items.service';
import { PackagingReconciliationService } from './packaging-reconciliation.service';
import { RestockController } from './restock.controller';
import { RestockService } from './restock.service';
import { StockCountsController } from './stock-counts.controller';
import { StockCountsService } from './stock-counts.service';
import { StockCategoriesController } from './stock-categories.controller';
import { StockCategoriesService } from './stock-categories.service';
import { StockMovementsController } from './stock-movements.controller';
import { StockMovementsService } from './stock-movements.service';

/** Manual open/close stock counts. This is not a live inventory ledger. */
@Module({
  imports: [AuthModule, TradingDayModule],
  controllers: [
    InventoryItemsController,
    RestockController,
    StockCategoriesController,
    StockCountsController,
    StockMovementsController,
  ],
  providers: [
    InventoryItemsService,
    PackagingReconciliationService,
    RestockService,
    StockCategoriesService,
    StockCountsService,
    StockMovementsService,
  ],
  exports: [PackagingReconciliationService],
})
export class InventoryModule {}
