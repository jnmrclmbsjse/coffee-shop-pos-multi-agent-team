import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Role, type StaffEmploymentDetails, type StaffGovernmentIds, type StaffCustomFieldDefinition } from '@coffee-shop/shared';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { StaffEmploymentService } from './staff-employment.service';
import { CreateCustomFieldDefinitionDto, CustomFieldDefinitionQueryDto, CustomFieldOrderDto, UpdateCustomFieldDefinitionDto, UpdateCustomFieldValuesDto, UpdateStaffEmploymentDto } from './staff-employment.dto';
import type {
  CreateStaffAccountResponse,
  StaffMember,
  UpdateStaffCredentialsResponse,
} from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  CreateStaffAccountDto,
  CreateStaffMemberDto,
  StaffMemberListQueryDto,
  UpdateStaffCredentialsDto,
  UpdateStaffMemberDto,
} from './staff.dto';
import { StaffService } from './staff.service';

@Controller('staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class StaffController {
  constructor(
    private readonly staffService: StaffService,
    private readonly employmentService: StaffEmploymentService,
  ) {}

  @Get('custom-fields')
  listCustomFields(@Query() query: CustomFieldDefinitionQueryDto): Promise<StaffCustomFieldDefinition[]> { return this.employmentService.listDefinitions(query.includeArchived); }
  @Post('custom-fields')
  createCustomField(@Body() input: CreateCustomFieldDefinitionDto): Promise<StaffCustomFieldDefinition> { return this.employmentService.createDefinition(input); }
  @Put('custom-fields/order')
  reorderCustomFields(@Body() input: CustomFieldOrderDto): Promise<void> { return this.employmentService.reorder(input.ids); }
  @Patch('custom-fields/:id')
  updateCustomField(@Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateCustomFieldDefinitionDto): Promise<StaffCustomFieldDefinition> { return this.employmentService.updateDefinition(id, input); }

  @Get(':id/employment')
  getEmployment(@Param('id', ParseUUIDPipe) id: string): Promise<StaffEmploymentDetails> { return this.employmentService.get(id); }
  @Put(':id/employment')
  updateEmployment(@Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateStaffEmploymentDto, @Req() request: AuthenticatedRequest): Promise<StaffEmploymentDetails> { return this.employmentService.update(id, input, request.user!.id); }
  @Get(':id/employment/government-ids')
  revealGovernmentIds(@Param('id', ParseUUIDPipe) id: string): Promise<StaffGovernmentIds> { return this.employmentService.reveal(id); }
  @Put(':id/custom-fields')
  updateCustomFieldValues(@Param('id', ParseUUIDPipe) id: string, @Body() input: UpdateCustomFieldValuesDto, @Req() request: AuthenticatedRequest): Promise<void> { return this.employmentService.saveValues(id, input, request.user!.id); }

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

  @Patch(':id/account/credentials')
  updateCredentials(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateStaffCredentialsDto,
  ): Promise<UpdateStaffCredentialsResponse> {
    return this.staffService.updateCredentials(id, input);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateStaffMemberDto,
  ): Promise<StaffMember> {
    return this.staffService.update(id, input);
  }
}
