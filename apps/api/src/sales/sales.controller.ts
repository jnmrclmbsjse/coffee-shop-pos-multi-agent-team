import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role, type ActiveCashier } from '@coffee-shop/shared';
import { DEVICE_ID_REQUIRED_MESSAGE } from '../auth/auth.constants';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type {
  ClearActiveCashierDto,
  SelectActiveCashierDto,
} from './sales.dto';
import { SalesService } from './sales.service';

const STAFF_MEMBER_ID_REQUIRED_MESSAGE = 'Staff member identifier is required';

@Controller('sales/active-cashier')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.STAFF)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get()
  getActiveCashier(
    @Query('deviceId') deviceId: unknown,
  ): Promise<ActiveCashier | null> {
    return this.salesService.activeCashier(this.requireDeviceId(deviceId));
  }

  @Post()
  selectCashier(
    @Body() body: SelectActiveCashierDto | null | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<ActiveCashier> {
    const deviceId = this.requireDeviceId(body?.deviceId);
    const staffMemberId = this.requireStaffMemberId(body?.staffMemberId);
    return this.salesService.selectCashier(
      deviceId,
      staffMemberId,
      body?.pin,
      request.user!.id,
    );
  }

  @Delete()
  clearCashier(
    @Body() body: ClearActiveCashierDto | null | undefined,
    @Req() request: AuthenticatedRequest,
  ): Promise<null> {
    return this.salesService.clearCashier(
      this.requireDeviceId(body?.deviceId),
      request.user!.id,
    );
  }

  private requireDeviceId(deviceId: unknown): string {
    if (typeof deviceId !== 'string' || deviceId.trim().length === 0) {
      throw new BadRequestException(DEVICE_ID_REQUIRED_MESSAGE);
    }

    return deviceId;
  }

  private requireStaffMemberId(staffMemberId: unknown): string {
    if (
      typeof staffMemberId !== 'string' ||
      staffMemberId.trim().length === 0
    ) {
      throw new BadRequestException(STAFF_MEMBER_ID_REQUIRED_MESSAGE);
    }

    return staffMemberId;
  }
}
