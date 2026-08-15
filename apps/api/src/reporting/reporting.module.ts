import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { TradingDayModule } from '../trading-day/trading-day.module';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';
import { StaffOrderLedgerController } from './staff-order-ledger.controller';

@Module({
  imports: [AuthModule, InventoryModule, TradingDayModule],
  controllers: [ReportingController, StaffOrderLedgerController],
  providers: [ReportingService],
})
export class ReportingModule {}
