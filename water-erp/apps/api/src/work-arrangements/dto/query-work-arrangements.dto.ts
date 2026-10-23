import { Transform } from 'class-transformer';
import { IsEnum, IsISO8601, IsOptional, IsString } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

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

  @EmptyAsUndefined()
  @IsOptional()
  @IsEnum(WORK_ARRANGEMENT_STATUS)
  status?: (typeof WORK_ARRANGEMENT_STATUS)[number];

  @EmptyAsUndefined()
  @IsOptional()
  @IsEnum(WORK_ARRANGEMENT_TYPE)
  type?: (typeof WORK_ARRANGEMENT_TYPE)[number];

  @EmptyAsUndefined()
  @IsOptional()
  @IsEnum(WORK_ARRANGEMENT_URGENCY)
  urgency?: (typeof WORK_ARRANGEMENT_URGENCY)[number];

  @IsOptional()
  @IsString()
  projectManagementItemId?: string;

  @EmptyAsUndefined()
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

  @EmptyAsUndefined()
  @IsOptional()
  @IsEnum(WORK_ARRANGEMENT_REMINDER_STATE)
  reminderState?: (typeof WORK_ARRANGEMENT_REMINDER_STATE)[number];
}
