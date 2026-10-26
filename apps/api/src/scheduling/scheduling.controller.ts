import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role, type ScheduleWeekView } from '@coffee-shop/shared';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SaveScheduleWeekDto } from './scheduling.dto';
import { SchedulingService } from './scheduling.service';
@Controller('scheduling')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class SchedulingController {
  constructor(private readonly service: SchedulingService) {}
  @Get('weeks/:weekStart') get(
    @Param('weekStart') weekStart: string,
  ): Promise<ScheduleWeekView> {
    return this.service.getWeek(weekStart);
  }
  @Put('weeks/:weekStart') save(
    @Param('weekStart') weekStart: string,
    @Body() input: SaveScheduleWeekDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<ScheduleWeekView> {
    return this.service.saveWeek(weekStart, input, request.user!.id);
  }
}
