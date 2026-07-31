import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Matches,
  Min,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import {
  CashMovementKind,
  DayType,
  type CreateCashMovementInput,
  type CloseBusinessDayInput,
  type OpenBusinessDayInput,
} from '@coffee-shop/shared';

const optionalTrimmedString = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

function IsExpenseOnlyCategory(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isExpenseOnlyCategory',
      target: object.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (value === undefined || value === null) return true;
          const input = args.object as { kind?: CashMovementKind };
          return input.kind === CashMovementKind.EXPENSE;
        },
      },
    });
  };
}

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

export class CreateCashMovementDto
  implements CreateCashMovementInput
{
  @IsUUID(undefined, {
    message: 'clientGeneratedId must be a valid UUID',
  })
  clientGeneratedId!: string;

  @IsEnum(CashMovementKind, {
    message: 'kind must be CASH_IN, CASH_OUT or EXPENSE',
  })
  kind!: CashMovementKind;

  @IsInt({ message: 'amountCents must be an integer' })
  @Min(1, { message: 'amountCents must be a positive integer' })
  @Max(2_147_483_647, {
    message: 'amountCents must not exceed 2147483647',
  })
  amountCents!: CreateCashMovementInput['amountCents'];

  @Transform(optionalTrimmedString)
  @IsString({ message: 'description must be a string' })
  @IsNotEmpty({ message: 'description must not be blank' })
  description!: string;

  @IsOptional()
  @Transform(optionalTrimmedString)
  @IsString({ message: 'category must be a string' })
  @IsExpenseOnlyCategory({
    message: 'category is only allowed for EXPENSE',
  })
  category?: string | null;

  @IsOptional()
  @IsUUID(undefined, {
    message: 'recordedByStaffMemberId must be a valid UUID',
  })
  recordedByStaffMemberId?: string | null;
}
