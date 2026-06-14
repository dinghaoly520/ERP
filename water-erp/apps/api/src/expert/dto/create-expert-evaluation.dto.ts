import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max } from 'class-validator';

export class CreateExpertEvaluationDto {
  @IsString() @IsNotEmpty()
  expertUserId!: string;

  @IsOptional() @IsString()
  projectId?: string;

  @IsInt() @Min(0) @Max(100)
  attendanceScore!: number;

  @IsInt() @Min(0) @Max(100)
  qualityScore!: number;

  @IsInt() @Min(0) @Max(100)
  disciplineScore!: number;

  @IsOptional() @IsString()
  comment?: string;
}
