import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  LineDiscountKind,
  LinePreference,
  PaymentMethod,
  ServiceType,
} from '@prisma/client';

const nullableTrimmedString = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

export class OrderLineInputDto {
  @IsUUID()
  productVariantId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity = 1;

  @IsOptional()
  @IsEnum(LineDiscountKind)
  discountKind: LineDiscountKind = LineDiscountKind.NONE;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(LinePreference, { each: true })
  preferences: LinePreference[] = [];

  @IsOptional()
  @Transform(nullableTrimmedString)
  @IsString()
  @MaxLength(255)
  preferenceNote?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  freeUpsizeCount = 0;
}

export class CreateOrderDto extends OrderLineInputDto {
  @IsUUID()
  clientGeneratedId!: string;

  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @IsOptional()
  @Transform(nullableTrimmedString)
  @IsString()
  @MaxLength(255)
  customerName?: string | null;

  @IsOptional()
  @IsEnum(ServiceType)
  serviceType: ServiceType = ServiceType.DINE_IN;
}

export class AddOrderLineDto extends OrderLineInputDto {}

export class UpdateOrderDto {
  @IsOptional()
  @Transform(nullableTrimmedString)
  @IsString()
  @MaxLength(255)
  customerName?: string | null;

  @IsOptional()
  @IsEnum(ServiceType)
  serviceType?: ServiceType;
}

export class UpdateOrderLineDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsEnum(LineDiscountKind)
  discountKind?: LineDiscountKind;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(LinePreference, { each: true })
  preferences?: LinePreference[];

  @IsOptional()
  @Transform(nullableTrimmedString)
  @IsString()
  @MaxLength(255)
  preferenceNote?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  freeUpsizeCount?: number;
}

export class PaymentDto {
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsInt()
  @Min(0)
  amountCents!: number;
}

export class CompleteOrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentDto)
  payments!: PaymentDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  cashReceivedCents?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  cashTipCents = 0;

  @IsOptional()
  @IsInt()
  @Min(0)
  changeOwedCents = 0;
}

export class VoidOrderDto {
  @IsUUID()
  clientGeneratedId!: string;

  @IsString()
  @IsNotEmpty()
  deviceId!: string;

  @Transform(nullableTrimmedString)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  voidReason!: string;
}
