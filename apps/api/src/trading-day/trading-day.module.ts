import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { TradingDayController } from './trading-day.controller';
import { TradingDayService } from './trading-day.service';

/**
 * Cash & Trading Day bounded context.
 *
 * Issue #84 establishes its schema and shared arithmetic only. Capture and
 * reporting providers are deliberately deferred to their owning stories.
 */
@Module({
  imports: [AuthModule, forwardRef(() => InventoryModule)],
  controllers: [TradingDayController],
  providers: [TradingDayService],
  exports: [TradingDayService],
})
export class TradingDayModule {}
