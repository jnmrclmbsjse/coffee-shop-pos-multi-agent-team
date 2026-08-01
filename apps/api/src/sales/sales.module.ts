import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

/** Append-only, idempotently recorded sales and orders. */
@Module({
  imports: [AuthModule],
  controllers: [SalesController],
  providers: [SalesService],
})
export class SalesModule {}
