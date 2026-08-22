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
  type StaffCompensationAdjustment,
  type StaffCompensationEntry,
} from '@coffee-shop/shared';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CompensationAdjustmentListQueryDto,
  CompensationEntryListQueryDto,
  CreateCompensationAdjustmentDto,
  CreateCompensationEntryDto,
  PayslipQueryDto,
  UpdateCompensationAdjustmentDto,
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

  @Get('adjustments')
  listAdjustments(
    @Query() query: CompensationAdjustmentListQueryDto,
  ): Promise<StaffCompensationAdjustment[]> {
    return this.compensationService.listAdjustments(query);
  }

  @Post('adjustments')
  createAdjustment(
    @Body() input: CreateCompensationAdjustmentDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<StaffCompensationAdjustment> {
    return this.compensationService.createAdjustment(input, request.user!.id);
  }

  @Patch('adjustments/:id')
  updateAdjustment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateCompensationAdjustmentDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<StaffCompensationAdjustment> {
    return this.compensationService.updateAdjustment(
      id,
      input,
      request.user!.id,
    );
  }

  @Delete('adjustments/:id')
  removeAdjustment(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.compensationService.removeAdjustment(id);
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
