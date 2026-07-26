import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { ExpertLevel } from '@prisma/client';

export class CreateExpertEvaluationDto {
  @IsString() @IsNotEmpty()
  expertUserId!: string;

  @IsString() @IsNotEmpty({ message: '评价必须关联一个评审项目' })
  projectId!: string;

  @IsEnum(ExpertLevel)
  attendanceGrade!: ExpertLevel;

  @IsEnum(ExpertLevel)
  qualityGrade!: ExpertLevel;

  @IsEnum(ExpertLevel)
  disciplineGrade!: ExpertLevel;

  @IsOptional() @IsString()
  comment?: string;
}
