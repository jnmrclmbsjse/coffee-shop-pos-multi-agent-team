import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportingModule } from '../reporting/reporting.module';
import { CompensationController } from './compensation.controller';
import { CompensationService } from './compensation.service';

@Module({
  imports: [AuthModule, ReportingModule],
  controllers: [CompensationController],
  providers: [CompensationService],
})
export class CompensationModule {}
