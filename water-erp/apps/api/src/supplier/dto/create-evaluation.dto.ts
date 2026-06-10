import { IsString, IsNotEmpty, IsOptional, IsNumber, Min, Max } from 'class-validator';

export class CreateEvaluationDto {
  @IsString() @IsOptional()
  projectId?: string;

  @IsNumber() @Min(0) @Max(20)
  completenessScore: number;  // 资料完整性（20%）

  @IsNumber() @Min(0) @Max(30)
  responsivenessScore: number;  // 文件响应（30%）

  @IsNumber() @Min(0) @Max(20)
  cooperationScore: number;  // 配合情况（20%）

  @IsNumber() @Min(0) @Max(20)
  complianceScore: number;  // 合规情况（20%）

  @IsNumber() @Min(0) @Max(10)
  overallScore: number;  // 综合评价（10%）

  @IsString() @IsOptional()
  comment?: string;
}