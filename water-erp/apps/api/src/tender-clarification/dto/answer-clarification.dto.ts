import { IsString, MaxLength, MinLength } from 'class-validator';

export class AnswerClarificationDto {
  @IsString() @MinLength(1) @MaxLength(4000)
  answer!: string;
}
