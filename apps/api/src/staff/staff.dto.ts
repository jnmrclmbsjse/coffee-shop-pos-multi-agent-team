import type {
  CreateStaffMemberInput,
  StaffMemberListQuery,
  StaffMemberListSort,
  SortDirection,
  UpdateStaffMemberInput,
} from '@coffee-shop/shared';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const queryBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export class CreateStaffMemberDto implements CreateStaffMemberInput {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'displayName must not be blank' })
  displayName!: string;

  @IsOptional()
  @IsBoolean()
  isActive = true;

  @IsOptional()
  @IsUUID()
  locationId?: string | null;
}

export class UpdateStaffMemberDto implements UpdateStaffMemberInput {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'displayName must not be blank' })
  displayName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class StaffMemberListQueryDto implements StaffMemberListQuery {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsIn(['name', 'active'])
  sort: StaffMemberListSort = 'name';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction: SortDirection = 'asc';
}
