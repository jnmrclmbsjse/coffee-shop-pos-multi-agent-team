import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const queryBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

export class CreateCategoryDto {
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank' })
  name!: string;

  @IsInt()
  sortWeight!: number;

  @IsBoolean()
  active!: boolean;
}

export class UpdateCategoryDto {
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

export class ReorderItemDto {
  @IsUUID()
  id!: string;

  @IsInt()
  sortWeight!: number;
}

export class ReorderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items!: ReorderItemDto[];
}

export class ProductSizeDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'size name must not be blank' })
  name!: string;

  @IsInt()
  @Min(0, { message: 'priceCents must be zero or greater' })
  priceCents!: number;

  @IsInt()
  sortWeight!: number;

  @IsBoolean()
  active!: boolean;

  @IsOptional()
  @IsUUID()
  cupInventoryItemId?: string | null;

  @IsOptional()
  @IsUUID()
  lidInventoryItemId?: string | null;
}

export class CreateProductDto {
  @IsUUID()
  categoryId!: string;

  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank' })
  name!: string;

  @IsBoolean()
  active!: boolean;

  @IsBoolean()
  available!: boolean;

  @IsArray()
  @ArrayMinSize(1, { message: 'a product must have at least one size' })
  @ValidateNested({ each: true })
  @Type(() => ProductSizeDto)
  sizes!: ProductSizeDto[];
}

export class UpdateProductDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @Transform(trimString)
  @IsString()
  @IsNotEmpty({ message: 'name must not be blank' })
  name?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  available?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'a product must have at least one size' })
  @ValidateNested({ each: true })
  @Type(() => ProductSizeDto)
  sizes?: ProductSizeDto[];
}

export class ProductListQueryDto {
  @IsOptional()
  @Transform(trimString)
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsIn(['category', 'name', 'active'])
  sort?: 'category' | 'name' | 'active';
}

export class UpdateAvailabilityDto {
  @IsBoolean()
  available!: boolean;
}
