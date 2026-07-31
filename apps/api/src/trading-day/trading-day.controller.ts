import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import type {
  CurrentOpenBusinessDay,
  DayClosing,
  TradingDayClosingSummary,
} from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CloseBusinessDayDto,
  OpenBusinessDayDto,
} from './trading-day.dto';
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

  @Get('current/closing-summary')
  closingSummary(): Promise<TradingDayClosingSummary> {
    return this.tradingDayService.getClosingSummary();
  }

  @Post('open')
  open(
    @Body() input: OpenBusinessDayDto,
  ): Promise<CurrentOpenBusinessDay> {
    return this.tradingDayService.open(input);
  }

  @Post('close')
  close(@Body() input: CloseBusinessDayDto): Promise<DayClosing> {
    return this.tradingDayService.close(input);
  }
}
