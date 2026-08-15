import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type PayslipSummary,
  Role,
  type StaffCompensationEntry,
} from '@coffee-shop/shared';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CompensationEntryListQueryDto,
  CreateCompensationEntryDto,
  PayslipQueryDto,
  UpdateCompensationEntryDto,
} from './compensation.dto';
import { CompensationService } from './compensation.service';

@Controller('compensation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class CompensationController {
  constructor(private readonly compensationService: CompensationService) {}

  @Get('payslip')
  payslip(@Query() query: PayslipQueryDto): Promise<PayslipSummary> {
    return this.compensationService.getPayslip(query);
  }

  @Get('entries')
  list(
    @Query() query: CompensationEntryListQueryDto,
  ): Promise<StaffCompensationEntry[]> {
    return this.compensationService.list(query);
  }

  @Post('entries')
  create(
    @Body() input: CreateCompensationEntryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<StaffCompensationEntry> {
    return this.compensationService.create(input, request.user!.id);
  }

  @Patch('entries/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateCompensationEntryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<StaffCompensationEntry> {
    return this.compensationService.update(id, input, request.user!.id);
  }

  @Delete('entries/:id')
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.compensationService.remove(id);
  }
}
