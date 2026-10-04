import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReportingModule } from '../reporting/reporting.module';

@Module({
  imports: [PrismaModule, ReportingModule],
})
export class JournalModule {}
