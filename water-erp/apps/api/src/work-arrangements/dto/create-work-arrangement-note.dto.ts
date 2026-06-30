import { IsEnum, IsString, MaxLength } from 'class-validator';

const WORK_ARRANGEMENT_NOTE_TYPE = ['PROGRESS', 'INSIGHT'] as const;

export class CreateWorkArrangementNoteDto {
  @IsEnum(WORK_ARRANGEMENT_NOTE_TYPE)
  type!: (typeof WORK_ARRANGEMENT_NOTE_TYPE)[number];

  @IsString()
  @MaxLength(4000)
  content!: string;
}
