import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';
import { StaffOrderLedgerController } from './staff-order-ledger.controller';

@Module({
  imports: [AuthModule],
  controllers: [ReportingController, StaffOrderLedgerController],
  providers: [ReportingService],
})
export class ReportingModule {}
