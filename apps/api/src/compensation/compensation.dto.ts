import type {
  CreateStaffCompensationEntryInput,
  StaffCompensationEntryListQuery,
  UpdateStaffCompensationEntryInput,
} from '@coffee-shop/shared';
import {
  IsDateString,
  IsDefined,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DATABASE_INTEGER = 2_147_483_647;

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
