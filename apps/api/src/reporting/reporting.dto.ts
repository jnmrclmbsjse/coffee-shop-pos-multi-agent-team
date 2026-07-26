import { IsDateString, IsNotEmpty, Matches } from 'class-validator';

export class ReportingRangeQueryDto {
  @IsNotEmpty({ message: 'from is required' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'from must be a date in YYYY-MM-DD format',
  })
  @IsDateString({ strict: true }, { message: 'from must be a valid date' })
  from!: string;

  @IsNotEmpty({ message: 'to is required' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'to must be a date in YYYY-MM-DD format',
  })
  @IsDateString({ strict: true }, { message: 'to must be a valid date' })
  to!: string;
}
