import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
} from 'class-validator';
import {
  DayType,
  type CloseBusinessDayInput,
  type OpenBusinessDayInput,
} from '@coffee-shop/shared';

const optionalTrimmedString = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

export class OpenBusinessDayDto implements OpenBusinessDayInput {
  @IsNotEmpty({ message: 'businessDate is required' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'businessDate must be a date in YYYY-MM-DD format',
  })
  @IsDateString(
    { strict: true },
    { message: 'businessDate must be a valid date' },
  )
  businessDate!: string;

  @IsEnum(DayType, {
    message: 'dayType must be NORMAL or PEAK',
  })
  dayType!: DayType;

  @IsInt({ message: 'openingFloatCents must be an integer' })
  @Min(0, {
    message: 'openingFloatCents must be zero or greater',
  })
  openingFloatCents!: OpenBusinessDayInput['openingFloatCents'];

  @IsUUID(undefined, {
    message: 'openedByStaffMemberId must be a valid UUID',
  })
  openedByStaffMemberId!: string;
}

export class CloseBusinessDayDto implements CloseBusinessDayInput {
  @IsUUID(undefined, {
    message: 'clientGeneratedId must be a valid UUID',
  })
  clientGeneratedId!: string;

  @IsInt({ message: 'actualCashCents must be an integer' })
  @Min(0, { message: 'actualCashCents must be zero or greater' })
  actualCashCents!: CloseBusinessDayInput['actualCashCents'];

  @IsOptional()
  @Transform(optionalTrimmedString)
  @IsString()
  varianceReason?: string | null;

  @IsUUID(undefined, {
    message: 'closedByStaffMemberId must be a valid UUID',
  })
  closedByStaffMemberId!: string;
}
