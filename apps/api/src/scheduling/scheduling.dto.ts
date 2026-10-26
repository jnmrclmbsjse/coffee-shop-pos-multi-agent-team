import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
class ScheduleShiftDto {
  @IsUUID('4') staffMemberId!: string;
  @IsInt() @Min(0) @Max(1439) startMinute!: number;
  @IsInt() @Min(1) @Max(1440) endMinute!: number;
}
class ScheduleDayDto {
  @IsString() date!: string;
  @IsOptional() @IsString() @MaxLength(200) eventNote!: string | null;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleShiftDto)
  shifts!: ScheduleShiftDto[];
}
export class SaveScheduleWeekDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScheduleDayDto)
  days!: ScheduleDayDto[];
}
