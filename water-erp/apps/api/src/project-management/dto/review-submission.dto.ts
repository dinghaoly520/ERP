import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewSubmissionDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
