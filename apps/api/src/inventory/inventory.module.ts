import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryItemsController } from './inventory-items.controller';
import { InventoryItemsService } from './inventory-items.service';

/** Manual open/close stock counts. This is not a live inventory ledger. */
@Module({
  imports: [AuthModule],
  controllers: [InventoryItemsController],
  providers: [InventoryItemsService],
})
export class InventoryModule {}
