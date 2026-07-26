import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { InventoryModule } from './inventory/inventory.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportingModule } from './reporting/reporting.module';
import { SalesModule } from './sales/sales.module';
import { StaffModule } from './staff/staff.module';
import { TradingDayModule } from './trading-day/trading-day.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    PrismaModule,
    AuthModule,
    CatalogModule,
    InventoryModule,
    ReportingModule,
    SalesModule,
    StaffModule,
    TradingDayModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
