import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportingModule } from '../reporting/reporting.module';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';

@Module({
  imports: [AuthModule, PrismaModule, ReportingModule],
  controllers: [JournalController],
  providers: [JournalService],
})
export class JournalModule {}
