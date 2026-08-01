import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role, type SelectableStaffMember } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { StaffService } from './staff.service';

@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.STAFF)
export class SelectableStaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get('selectable')
  list(): Promise<SelectableStaffMember[]> {
    return this.staffService.listSelectable();
  }
}
