import { Transform } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CountMethod } from '@coffee-shop/shared';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const optionalTrimmedString = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const queryBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export class CreateStockCategoryDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank' })
  name!: string;

  @IsInt()
  sortWeight!: number;

  @IsBoolean()
  active!: boolean;
}

export class UpdateStockCategoryDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank' })
  name?: string;

  @IsOptional()
  @IsInt()
  sortWeight?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class ReorderStockCategoryItemDto {
  @IsUUID()
  id!: string;

  @IsInt()
  sortWeight!: number;
}

export class ReorderStockCategoriesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReorderStockCategoryItemDto)
  items!: ReorderStockCategoryItemDto[];
}

export class CreateInventoryItemDto {
  @IsUUID()
  categoryId!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank' })
  name!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'unit must not be blank' })
  unit = 'pcs';

  @IsOptional()
  @Transform(optionalTrimmedString)
  @IsString()
  size?: string | null;

  @IsEnum(CountMethod)
  countMethod: CountMethod = CountMethod.QUANTITY;

  @IsBoolean()
  critical = false;

  @IsBoolean()
  reconciled = false;

  @IsBoolean()
  active = true;
}

export class UpdateInventoryItemDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank' })
  name?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'unit must not be blank' })
  unit?: string;

  @IsOptional()
  @Transform(optionalTrimmedString)
  @IsString()
  size?: string | null;

  @IsOptional()
  @IsEnum(CountMethod)
  countMethod?: CountMethod;

  @IsOptional()
  @IsBoolean()
  critical?: boolean;

  @IsOptional()
  @IsBoolean()
  reconciled?: boolean;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class InventoryItemListQueryDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsEnum(CountMethod)
  countMethod?: CountMethod;

  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  reconciled?: boolean;

  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  critical?: boolean;

  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  active?: boolean;
}

export class UpsertParLevelDto {
  @IsInt()
  @Min(0, { message: 'parQty must be zero or greater' })
  parQty!: number;

  @IsOptional()
  @IsInt()
  @Min(0, { message: 'lowThreshold must be zero or greater' })
  lowThreshold?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0, { message: 'urgentThreshold must be zero or greater' })
  urgentThreshold?: number | null;
}
