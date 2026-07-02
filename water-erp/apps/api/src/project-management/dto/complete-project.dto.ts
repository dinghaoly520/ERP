import { IsBoolean } from 'class-validator';

export class CompleteProjectDto {
  @IsBoolean()
  confirmedCompleted!: boolean;
}
