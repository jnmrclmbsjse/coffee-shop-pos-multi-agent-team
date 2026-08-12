import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import type {
  CreateStaffAccountResponse,
  StaffMember,
} from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateStaffAccountDto,
  CreateStaffMemberDto,
  StaffMemberListQueryDto,
  UpdateStaffMemberDto,
} from './staff.dto';
import { StaffService } from './staff.service';

@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  list(
    @Query() query: StaffMemberListQueryDto,
  ): Promise<StaffMember[]> {
    return this.staffService.list(query);
  }

  @Post()
  create(
    @Body() input: CreateStaffMemberDto,
  ): Promise<StaffMember> {
    return this.staffService.create(input);
  }

  @Post(':id/account')
  createAccount(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CreateStaffAccountDto,
  ): Promise<CreateStaffAccountResponse> {
    return this.staffService.createAccount(id, input);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateStaffMemberDto,
  ): Promise<StaffMember> {
    return this.staffService.update(id, input);
  }
}
