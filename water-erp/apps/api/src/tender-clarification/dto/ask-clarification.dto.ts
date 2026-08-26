import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AskClarificationDto {
  @IsString() @MinLength(5) @MaxLength(2000)
  question!: string;

  @IsOptional() @IsString()
  attachmentId?: string;
}
