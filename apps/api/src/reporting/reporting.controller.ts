import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import type {
  ReportingDashboard,
  SalesRangeReport,
} from '@coffee-shop/shared';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ReportingRangeQueryDto } from './reporting.dto';
import { ReportingService } from './reporting.service';

@Controller('reporting')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('dashboard')
  dashboard(): Promise<ReportingDashboard> {
    return this.reportingService.getDashboard();
  }

  @Get('report')
  report(
    @Query() query: ReportingRangeQueryDto,
  ): Promise<SalesRangeReport> {
    return this.reportingService.getReport(query.from, query.to);
  }

  @Get('report.csv')
  async reportCsv(
    @Query() query: ReportingRangeQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const report = await this.reportingService.getReport(
      query.from,
      query.to,
    );
    response.type('text/csv');
    response.attachment(
      `ucm-report-${query.from}_to_${query.to}.csv`,
    );
    return this.reportingService.toCsv(report);
  }
}
