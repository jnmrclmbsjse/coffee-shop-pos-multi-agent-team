import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import type { StaffOrderLedger } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { StaffOrderLedgerQueryDto } from './reporting.dto';
import { ReportingService } from './reporting.service';

@Controller('reporting/staff-order-ledger')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.STAFF)
export class StaffOrderLedgerController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get(':businessDayId')
  list(
    @Param('businessDayId', ParseUUIDPipe) businessDayId: string,
    @Query() query: StaffOrderLedgerQueryDto,
  ): Promise<StaffOrderLedger> {
    return this.reportingService.getStaffOrderLedger(
      businessDayId,
      query,
    );
  }
}
