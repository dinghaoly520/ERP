import { Transform } from 'class-transformer';
import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';

const WORK_ARRANGEMENT_STATUS = [
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'COMPLETED',
  'CANCELLED',
] as const;

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
const WORK_ARRANGEMENT_SCOPE = ['ALL', 'TODAY', 'WEEK'] as const;
const WORK_ARRANGEMENT_REMINDER_STATE = [
  'UPCOMING',
  'DUE_NOW',
  'OVERDUE',
] as const;

export class QueryWorkArrangementsDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsEnum(WORK_ARRANGEMENT_STATUS)
  status?: (typeof WORK_ARRANGEMENT_STATUS)[number];

  @IsOptional()
  @IsEnum(WORK_ARRANGEMENT_TYPE)
  type?: (typeof WORK_ARRANGEMENT_TYPE)[number];

  @IsOptional()
  @IsEnum(WORK_ARRANGEMENT_URGENCY)
  urgency?: (typeof WORK_ARRANGEMENT_URGENCY)[number];

  @IsOptional()
  @IsString()
  projectManagementItemId?: string;

  @IsOptional()
  @IsEnum(WORK_ARRANGEMENT_SCOPE)
  scope?: (typeof WORK_ARRANGEMENT_SCOPE)[number];

  @IsOptional()
  @IsISO8601()
  date?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' || value === true
      ? true
      : value === 'false'
        ? false
        : undefined,
  )
  includeCompleted?: boolean;

  @IsOptional()
  @IsEnum(WORK_ARRANGEMENT_REMINDER_STATE)
  reminderState?: (typeof WORK_ARRANGEMENT_REMINDER_STATE)[number];
}
