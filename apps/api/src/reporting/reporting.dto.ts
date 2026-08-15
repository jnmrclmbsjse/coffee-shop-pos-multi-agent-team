import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import type {
  OrderHistoryListSort,
  OrderHistoryPaymentMethod,
  OrderHistoryStatus,
  SortDirection,
} from '@coffee-shop/shared';

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

export class DailyInventoryQueryDto {
  @IsNotEmpty({ message: 'date is required' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be a date in YYYY-MM-DD format',
  })
  @IsDateString({ strict: true }, { message: 'date must be a valid date' })
  date!: string;
}

export class OrderHistoryListQueryDto {
  @IsOptional()
  @IsIn(['Parked', 'Completed', 'Void'])
  status?: OrderHistoryStatus;

  @IsOptional()
  @IsIn(['Cash', 'Online', 'Split'])
  paymentMethod?: OrderHistoryPaymentMethod;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn([
    'businessDay',
    'orderNumber',
    'status',
    'total',
    'completedAt',
  ])
  sort: OrderHistoryListSort = 'businessDay';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction: SortDirection = 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsIn([5, 10, 25, 50])
  pageSize: 5 | 10 | 25 | 50 = 10;
}

export class StaffOrderLedgerQueryDto {
  @IsOptional()
  @IsIn(['Parked', 'Completed', 'Void'])
  status?: OrderHistoryStatus;

  @IsOptional()
  @IsIn(['Cash', 'Online', 'Split'])
  paymentMethod?: OrderHistoryPaymentMethod;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  @IsString()
  search?: string;
}
