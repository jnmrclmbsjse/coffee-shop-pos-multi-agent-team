import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CashierSelectionModule } from './cashier-selection.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

/** Append-only, idempotently recorded sales and orders. */
@Module({
  imports: [AuthModule, CashierSelectionModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
