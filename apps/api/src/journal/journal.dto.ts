import type {
  CreateJournalDepositInput,
  CreateJournalLedgerInput,
  CreateJournalWithdrawalInput,
  UpdateJournalDepositInput,
  UpdateJournalWithdrawalInput,
} from '@coffee-shop/shared';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DATABASE_INTEGER = 2_147_483_647;
const MIN_DATABASE_INTEGER = -2_147_483_648;
const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

function DateField(field: string): PropertyDecorator {
  const decorators = [
    IsDefined({ message: `${field} is required` }),
    Matches(ISO_DATE_PATTERN, {
      message: `${field} must be a date in YYYY-MM-DD format`,
    }),
    IsDateString(
      { strict: true },
      { message: `${field} must be a valid date` },
    ),
  ];

  return (target, propertyKey) => {
    for (const decorator of decorators) {
      decorator(target, propertyKey);
    }
  };
}

abstract class JournalNoteDto {
  @Transform(trimString)
  @IsOptional()
  @IsString({ message: 'note must be text or null' })
  note?: string | null;
}

export class CreateJournalLedgerDto implements CreateJournalLedgerInput {
  @Transform(trimString)
  @IsDefined({ message: 'name is required' })
  @IsString({ message: 'name must be text' })
  @IsNotEmpty({ message: 'name must not be empty' })
  name!: string;

  @DateField('startDate')
  startDate!: string;

  @IsOptional()
  @IsInt({
    message: 'startingBalanceCents must be an integer number of cents',
  })
  @Min(MIN_DATABASE_INTEGER, {
    message: `startingBalanceCents must not be less than ${MIN_DATABASE_INTEGER}`,
  })
  @Max(MAX_DATABASE_INTEGER, {
    message: `startingBalanceCents must not exceed ${MAX_DATABASE_INTEGER}`,
  })
  startingBalanceCents?: CreateJournalLedgerInput['startingBalanceCents'];
}

export class CreateJournalDepositDto
  extends JournalNoteDto
  implements CreateJournalDepositInput
{
  @DateField('businessDate')
  businessDate!: string;

  @IsDefined({ message: 'amountCents is required' })
  @IsInt({ message: 'amountCents must be an integer number of cents' })
  @Min(0, { message: 'amountCents must not be negative' })
  @Max(MAX_DATABASE_INTEGER, {
    message: `amountCents must not exceed ${MAX_DATABASE_INTEGER}`,
  })
  amountCents!: CreateJournalDepositInput['amountCents'];
}

export class UpdateJournalDepositDto
  extends JournalNoteDto
  implements UpdateJournalDepositInput
{
  @DateField('businessDate')
  businessDate!: string;

  @IsDefined({ message: 'amountCents is required' })
  @IsInt({ message: 'amountCents must be an integer number of cents' })
  @Min(0, { message: 'amountCents must not be negative' })
  @Max(MAX_DATABASE_INTEGER, {
    message: `amountCents must not exceed ${MAX_DATABASE_INTEGER}`,
  })
  amountCents!: UpdateJournalDepositInput['amountCents'];
}

export class CreateJournalWithdrawalDto
  extends JournalNoteDto
  implements CreateJournalWithdrawalInput
{
  @DateField('withdrawnOn')
  withdrawnOn!: string;

  @IsDefined({ message: 'amountCents is required' })
  @IsInt({ message: 'amountCents must be an integer number of cents' })
  @Min(1, { message: 'amountCents must be at least 1' })
  @Max(MAX_DATABASE_INTEGER, {
    message: `amountCents must not exceed ${MAX_DATABASE_INTEGER}`,
  })
  amountCents!: CreateJournalWithdrawalInput['amountCents'];
}

export class UpdateJournalWithdrawalDto
  extends JournalNoteDto
  implements UpdateJournalWithdrawalInput
{
  @DateField('withdrawnOn')
  withdrawnOn!: string;

  @IsDefined({ message: 'amountCents is required' })
  @IsInt({ message: 'amountCents must be an integer number of cents' })
  @Min(1, { message: 'amountCents must be at least 1' })
  @Max(MAX_DATABASE_INTEGER, {
    message: `amountCents must not exceed ${MAX_DATABASE_INTEGER}`,
  })
  amountCents!: UpdateJournalWithdrawalInput['amountCents'];
}
