import { EmploymentType, SeparationReason, StaffCustomFieldType } from '@coffee-shop/shared';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export class UpdateStaffEmploymentDto {
  @IsOptional() @Matches(DATE) @IsDateString({ strict: true }) startDate?: string | null;
  @IsOptional() @Matches(DATE) @IsDateString({ strict: true }) trainingEndDate?: string | null;
  @IsOptional() @Matches(DATE) @IsDateString({ strict: true }) probationEndDate?: string | null;
  @IsOptional() @Matches(DATE) @IsDateString({ strict: true }) thirdMonthReviewDate?: string | null;
  @IsOptional() @Matches(DATE) @IsDateString({ strict: true }) regularizationDate?: string | null;
  @IsOptional() @IsEnum(EmploymentType) employmentType?: EmploymentType | null;
  @IsOptional() @Matches(DATE) @IsDateString({ strict: true }) employmentTypeEffectiveDate?: string;
  @IsOptional() @Matches(DATE) @IsDateString({ strict: true }) endDate?: string | null;
  @IsOptional() @IsEnum(SeparationReason) separationReason?: SeparationReason | null;
  @IsOptional() @Matches(DATE) @IsDateString({ strict: true }) birthDate?: string | null;
  @IsOptional() @IsString() @MaxLength(80) contactNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(80) emergencyContactName?: string | null;
  @IsOptional() @IsString() @MaxLength(80) emergencyContactNumber?: string | null;
  @IsOptional() @IsString() sssNumber?: string | null;
  @IsOptional() @IsString() philhealthNumber?: string | null;
  @IsOptional() @IsString() pagibigNumber?: string | null;
  @IsOptional() @IsString() tinNumber?: string | null;
}

export class CustomFieldDefinitionQueryDto { @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() includeArchived?: boolean; }
export class CreateCustomFieldDefinitionDto {
  @IsString() @MaxLength(60) label!: string;
  @IsEnum(StaffCustomFieldType) fieldType!: StaffCustomFieldType;
  @IsOptional() @IsArray() @IsString({ each: true }) choices?: string[];
}
export class UpdateCustomFieldDefinitionDto {
  @IsOptional() @IsString() @MaxLength(60) label?: string;
  @IsOptional() @IsEnum(StaffCustomFieldType) fieldType?: StaffCustomFieldType;
  @IsOptional() @IsArray() @IsString({ each: true }) choices?: string[];
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isArchived?: boolean;
}
export class CustomFieldOrderDto { @IsArray() @IsUUID('4', { each: true }) ids!: string[]; }
export class CustomFieldValueDto { @IsUUID('4') definitionId!: string; @IsString() value!: string; }
export class UpdateCustomFieldValuesDto { @IsArray() @ValidateNested({ each: true }) @Type(() => CustomFieldValueDto) values!: CustomFieldValueDto[]; }
