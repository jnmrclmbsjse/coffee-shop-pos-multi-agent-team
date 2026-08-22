import type {
  CreateStaffCompensationAdjustmentInput,
  CreateStaffCompensationEntryInput,
  PayslipQuery,
  StaffCompensationAdjustmentListQuery,
  StaffCompensationEntryListQuery,
  UpdateStaffCompensationAdjustmentInput,
  UpdateStaffCompensationEntryInput,
} from '@coffee-shop/shared';
import { CompensationAdjustmentKind } from '@coffee-shop/shared';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DATABASE_INTEGER = 2_147_483_647;
const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class PayslipQueryDto implements PayslipQuery {
  @IsNotEmpty({ message: 'staffMemberId is required' })
  @IsUUID('4', { message: 'staffMemberId must be a valid identifier' })
  staffMemberId!: string;

  @IsNotEmpty({ message: 'from is required' })
  @Matches(ISO_DATE_PATTERN, {
    message: 'from must be a date in YYYY-MM-DD format',
  })
  @IsDateString({ strict: true }, { message: 'from must be a valid date' })
  from!: string;

  @IsNotEmpty({ message: 'to is required' })
  @Matches(ISO_DATE_PATTERN, {
    message: 'to must be a date in YYYY-MM-DD format',
  })
  @IsDateString({ strict: true }, { message: 'to must be a valid date' })
  to!: string;
}

export class CompensationEntryListQueryDto
  implements StaffCompensationEntryListQuery
{
  @IsOptional()
  @IsUUID('4', { message: 'staffMemberId must be a valid identifier' })
  staffMemberId?: string;

  @IsOptional()
  @Matches(ISO_DATE_PATTERN, {
    message: 'from must be a date in YYYY-MM-DD format',
  })
  @IsDateString({ strict: true }, { message: 'from must be a valid date' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE_PATTERN, {
    message: 'to must be a date in YYYY-MM-DD format',
  })
  @IsDateString({ strict: true }, { message: 'to must be a valid date' })
  to?: string;
}

export class CreateCompensationEntryDto
  implements CreateStaffCompensationEntryInput
{
  @IsDefined({ message: 'staffMemberId is required' })
  @IsUUID('4', { message: 'staffMemberId must be a valid identifier' })
  staffMemberId!: string;

  @IsDefined({ message: 'workDate is required' })
  @Matches(ISO_DATE_PATTERN, {
    message: 'workDate must be a date in YYYY-MM-DD format',
  })
  @IsDateString(
    { strict: true },
    { message: 'workDate must be a valid date' },
  )
  workDate!: string;

  @IsDefined({ message: 'salaryCents is required' })
  @IsInt({ message: 'salaryCents must be an integer number of cents' })
  @Min(0, { message: 'salaryCents must not be negative' })
  @Max(MAX_DATABASE_INTEGER, {
    message: `salaryCents must not exceed ${MAX_DATABASE_INTEGER}`,
  })
  salaryCents!: CreateStaffCompensationEntryInput['salaryCents'];

  @IsDefined({ message: 'commissionCents is required' })
  @IsInt({
    message: 'commissionCents must be an integer number of cents',
  })
  @Min(0, { message: 'commissionCents must not be negative' })
  @Max(MAX_DATABASE_INTEGER, {
    message: `commissionCents must not exceed ${MAX_DATABASE_INTEGER}`,
  })
  commissionCents!: CreateStaffCompensationEntryInput['commissionCents'];
}

export class UpdateCompensationEntryDto
  implements UpdateStaffCompensationEntryInput
{
  @IsDefined({ message: 'salaryCents is required' })
  @IsInt({ message: 'salaryCents must be an integer number of cents' })
  @Min(0, { message: 'salaryCents must not be negative' })
  @Max(MAX_DATABASE_INTEGER, {
    message: `salaryCents must not exceed ${MAX_DATABASE_INTEGER}`,
  })
  salaryCents!: UpdateStaffCompensationEntryInput['salaryCents'];

  @IsDefined({ message: 'commissionCents is required' })
  @IsInt({
    message: 'commissionCents must be an integer number of cents',
  })
  @Min(0, { message: 'commissionCents must not be negative' })
  @Max(MAX_DATABASE_INTEGER, {
    message: `commissionCents must not exceed ${MAX_DATABASE_INTEGER}`,
  })
  commissionCents!: UpdateStaffCompensationEntryInput['commissionCents'];
}

export class CompensationAdjustmentListQueryDto
  implements StaffCompensationAdjustmentListQuery
{
  @IsOptional()
  @IsUUID('4', { message: 'staffMemberId must be a valid identifier' })
  staffMemberId?: string;

  @IsOptional()
  @Matches(ISO_DATE_PATTERN, {
    message: 'from must be a date in YYYY-MM-DD format',
  })
  @IsDateString({ strict: true }, { message: 'from must be a valid date' })
  from?: string;

  @IsOptional()
  @Matches(ISO_DATE_PATTERN, {
    message: 'to must be a date in YYYY-MM-DD format',
  })
  @IsDateString({ strict: true }, { message: 'to must be a valid date' })
  to?: string;
}

export class CreateCompensationAdjustmentDto
  implements CreateStaffCompensationAdjustmentInput
{
  @IsDefined({ message: 'staffMemberId is required' })
  @IsUUID('4', { message: 'staffMemberId must be a valid identifier' })
  staffMemberId!: string;

  @IsDefined({ message: 'kind is required' })
  @IsEnum(CompensationAdjustmentKind, {
    message: 'kind must be ADVANCE, ALLOWANCE, or BONUS',
  })
  kind!: CompensationAdjustmentKind;

  @IsDefined({ message: 'effectiveDate is required' })
  @Matches(ISO_DATE_PATTERN, {
    message: 'effectiveDate must be a date in YYYY-MM-DD format',
  })
  @IsDateString(
    { strict: true },
    { message: 'effectiveDate must be a valid date' },
  )
  effectiveDate!: string;

  @IsDefined({ message: 'amountCents is required' })
  @IsInt({ message: 'amountCents must be an integer number of cents' })
  @Min(1, { message: 'amountCents must be at least 1' })
  @Max(MAX_DATABASE_INTEGER, {
    message: `amountCents must not exceed ${MAX_DATABASE_INTEGER}`,
  })
  amountCents!: CreateStaffCompensationAdjustmentInput['amountCents'];

  @Transform(trimString)
  @IsDefined({ message: 'description is required' })
  @IsString({ message: 'description must be text' })
  @IsNotEmpty({ message: 'description must not be empty' })
  @MaxLength(120, { message: 'description must not exceed 120 characters' })
  description!: string;
}

export class UpdateCompensationAdjustmentDto
  implements UpdateStaffCompensationAdjustmentInput
{
  @IsDefined({ message: 'effectiveDate is required' })
  @Matches(ISO_DATE_PATTERN, {
    message: 'effectiveDate must be a date in YYYY-MM-DD format',
  })
  @IsDateString(
    { strict: true },
    { message: 'effectiveDate must be a valid date' },
  )
  effectiveDate!: string;

  @IsDefined({ message: 'amountCents is required' })
  @IsInt({ message: 'amountCents must be an integer number of cents' })
  @Min(1, { message: 'amountCents must be at least 1' })
  @Max(MAX_DATABASE_INTEGER, {
    message: `amountCents must not exceed ${MAX_DATABASE_INTEGER}`,
  })
  amountCents!: UpdateStaffCompensationAdjustmentInput['amountCents'];

  @Transform(trimString)
  @IsDefined({ message: 'description is required' })
  @IsString({ message: 'description must be text' })
  @IsNotEmpty({ message: 'description must not be empty' })
  @MaxLength(120, { message: 'description must not exceed 120 characters' })
  description!: string;
}
