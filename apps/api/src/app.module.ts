import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { NoStoreInterceptor } from './auth/no-store.interceptor';
import { CatalogModule } from './catalog/catalog.module';
import { CompensationModule } from './compensation/compensation.module';
import { InventoryModule } from './inventory/inventory.module';
import { OrdersModule } from './orders/orders.module';
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
    CompensationModule,
    InventoryModule,
    OrdersModule,
    ReportingModule,
    SalesModule,
    StaffModule,
    TradingDayModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: NoStoreInterceptor,
    },
  ],
})
export class AppModule {}
