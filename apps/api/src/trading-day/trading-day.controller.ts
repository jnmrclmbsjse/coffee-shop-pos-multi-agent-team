import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import type {
  BusinessDayList,
  CashMovement,
  CashMovementList,
  CurrentOpenBusinessDay,
  DayClosing,
  TradingDayClosingSummary,
} from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AmendCashMovementDto,
  CloseBusinessDayDto,
  CreateCashMovementDto,
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

  @Get()
  list(): Promise<BusinessDayList> {
    return this.tradingDayService.listBusinessDays();
  }

  @Get('current/closing-summary')
  closingSummary(): Promise<TradingDayClosingSummary> {
    return this.tradingDayService.getClosingSummary();
  }

  @Get('current/cash-movements')
  cashMovements(): Promise<CashMovementList> {
    return this.tradingDayService.getCashMovements();
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

  @Post('cash-movements')
  recordCashMovement(
    @Body() input: CreateCashMovementDto,
  ): Promise<CashMovement> {
    return this.tradingDayService.recordCashMovement(input);
  }

  @Post('cash-movements/:id/amendments')
  amendCashMovement(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: AmendCashMovementDto,
  ): Promise<CashMovement> {
    return this.tradingDayService.amendCashMovement(id, input);
  }
}
