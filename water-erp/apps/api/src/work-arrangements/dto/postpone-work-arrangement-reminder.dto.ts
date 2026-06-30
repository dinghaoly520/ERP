import { IsEnum, IsISO8601, IsOptional } from 'class-validator';

const WORK_ARRANGEMENT_POSTPONE_PRESET = [
  'PLUS_30_MINUTES',
  'THIS_AFTERNOON',
  'TOMORROW_MORNING',
  'CUSTOM',
] as const;

export class PostponeWorkArrangementReminderDto {
  @IsEnum(WORK_ARRANGEMENT_POSTPONE_PRESET)
  preset!: (typeof WORK_ARRANGEMENT_POSTPONE_PRESET)[number];

  @IsOptional()
  @IsISO8601()
  targetAt?: string;
}
