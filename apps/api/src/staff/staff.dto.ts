import type {
  CreateStaffAccountInput,
  CreateStaffMemberInput,
  StaffMemberListQuery,
  StaffMemberListSort,
  SortDirection,
  UpdateStaffMemberInput,
  UpdateStaffCredentialsInput,
} from '@coffee-shop/shared';
import type { MoneyCents } from '@coffee-shop/shared';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  Matches,
  IsString,
  IsUUID,
  Max,
  Min,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

const MAX_DATABASE_INTEGER = 2_147_483_647;

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

  @IsOptional()
  @IsInt({ message: 'baseSalaryCents must be an integer number of cents' })
  @Min(0, { message: 'baseSalaryCents must not be negative' })
  @Max(MAX_DATABASE_INTEGER, {
    message: `baseSalaryCents must not exceed ${MAX_DATABASE_INTEGER}`,
  })
  baseSalaryCents?: MoneyCents | null;
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

  @IsOptional()
  @IsInt({ message: 'baseSalaryCents must be an integer number of cents' })
  @Min(0, { message: 'baseSalaryCents must not be negative' })
  @Max(MAX_DATABASE_INTEGER, {
    message: `baseSalaryCents must not exceed ${MAX_DATABASE_INTEGER}`,
  })
  baseSalaryCents?: MoneyCents | null;
}

export class CreateStaffAccountDto implements CreateStaffAccountInput {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'username must not be blank' })
  username!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'displayName must not be blank' })
  displayName?: string;

  @IsString()
  @IsNotEmpty({ message: 'password must not be empty' })
  password!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^\d{4}$/, { message: 'pin must be exactly 4 digits' })
  pin?: string;
}

@ValidatorConstraint({ name: 'hasReplacementCredential', async: false })
class HasReplacementCredential implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const input = args.object as UpdateStaffCredentialsInput;
    return input.password !== undefined || input.pin !== undefined;
  }
}

export class UpdateStaffCredentialsDto
  implements UpdateStaffCredentialsInput
{
  @Validate(HasReplacementCredential, {
    message: 'Provide a new password or PIN',
  })
  private readonly credentialSelection?: never;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @IsNotEmpty({ message: 'password must not be empty' })
  password?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Matches(/^\d{4}$/, { message: 'pin must be exactly 4 digits' })
  pin?: string;
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
