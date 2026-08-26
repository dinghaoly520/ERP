import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { ExpertLevel } from '@prisma/client';

export class CreateEvaluationDto {
  @IsString() @IsOptional()
  projectId?: string;

  @IsEnum(ExpertLevel)
  completenessGrade: ExpertLevel;  // 资料完整性（20%）

  @IsEnum(ExpertLevel)
  responsivenessGrade: ExpertLevel;  // 文件响应（30%）

  @IsEnum(ExpertLevel)
  cooperationGrade: ExpertLevel;  // 配合情况（20%）

  @IsEnum(ExpertLevel)
  complianceGrade: ExpertLevel;  // 合规情况（20%）

  @IsEnum(ExpertLevel)
  comprehensiveGrade: ExpertLevel;  // 综合评价（10%）

  @IsString() @IsOptional()
  comment?: string;

  /** A4（4.1.1.8）：评价来源——procurement 采购过程（默认）| contract 合同履约验收后（C3） */
  @IsString() @IsOptional()
  evaluationSource?: 'procurement' | 'contract';

  @IsOptional()
  evidence?: Record<string, string>;
}
