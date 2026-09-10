import { IsString, IsNotEmpty, IsOptional, IsEnum, IsObject } from 'class-validator';
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

  /** 三维评价依据（出勤/质量/廉洁），键为 attendanceGrade/qualityGrade/disciplineGrade，值为依据文本 */
  @IsOptional() @IsObject()
  evidence?: Record<string, string>;
}
