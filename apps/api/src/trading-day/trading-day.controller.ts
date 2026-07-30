import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import type { CurrentOpenBusinessDay } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TradingDayService } from './trading-day.service';

@Controller('trading-day')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
export class TradingDayController {
  constructor(private readonly tradingDayService: TradingDayService) {}

  @Get('current')
  current(): Promise<CurrentOpenBusinessDay> {
    return this.tradingDayService.getCurrentOpenDay();
  }
}
