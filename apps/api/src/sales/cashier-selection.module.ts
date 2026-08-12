import { Module } from '@nestjs/common';
import { CashierSelectionService } from './cashier-selection.service';

@Module({
  providers: [CashierSelectionService],
  exports: [CashierSelectionService],
})
export class CashierSelectionModule {}
