import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

const WORK_ARRANGEMENT_TYPE = [
  'APPROVAL',
  'FOLLOW_UP',
  'WRITING',
  'COMMUNICATION',
  'REVIEW',
  'ARCHIVE',
  'RESEARCH',
  'MEETING',
  'OTHER',
] as const;

const WORK_ARRANGEMENT_URGENCY = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const WORK_ARRANGEMENT_RECURRENCE = [
  'NONE',
  'DAILY',
  'WEEKDAYS',
  'WEEKLY',
  'MONTHLY',
] as const;

export class CreateWorkArrangementTemplateDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @IsEnum(WORK_ARRANGEMENT_TYPE)
  type!: (typeof WORK_ARRANGEMENT_TYPE)[number];

  @IsEnum(WORK_ARRANGEMENT_URGENCY)
  urgency!: (typeof WORK_ARRANGEMENT_URGENCY)[number];

  @EmptyAsUndefined()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  estimatedMinutes?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isAllDay?: boolean;

  @EmptyAsUndefined()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  customTags?: string[];

  @EmptyAsUndefined()
  @IsOptional()
  @IsEnum(WORK_ARRANGEMENT_RECURRENCE)
  recurrence?: (typeof WORK_ARRANGEMENT_RECURRENCE)[number];
}
