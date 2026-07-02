import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

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
const WORK_ARRANGEMENT_STATUS = [
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
] as const;
const WORK_ARRANGEMENT_RECURRENCE = [
  'NONE',
  'DAILY',
  'WEEKDAYS',
  'WEEKLY',
  'MONTHLY',
] as const;

export class CreateWorkArrangementDto {
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

  @IsOptional()
  @IsEnum(WORK_ARRANGEMENT_STATUS)
  status?: (typeof WORK_ARRANGEMENT_STATUS)[number];

  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @IsOptional()
  @IsISO8601()
  reminderAt?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  estimatedMinutes?: number;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isAllDay?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  customTags?: string[];

  @IsOptional()
  @IsEnum(WORK_ARRANGEMENT_RECURRENCE)
  recurrence?: (typeof WORK_ARRANGEMENT_RECURRENCE)[number];

  @IsOptional()
  @IsString()
  projectManagementItemId?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dependencyIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  completionSummary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  reflectionSummary?: string;
}
