// apps/api/src/ai-bid-analysis/dto/update-task.dto.ts
// ★ per-item 适配：去 name/projectName（task 无），改为 task 可更新字段
import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateTaskDto {
  @ApiProperty({ description: '招标要求（LLM 提取，含 scoringRules）', required: false })
  @IsOptional()
  requirements?: any;

  @ApiProperty({ description: '评分标准快照（AI 推断，不回填 BidScoreItem）', required: false })
  @IsOptional()
  scoringCriteriaSnapshot?: any;

  @ApiProperty({ description: '招标文件 OCR 文本', required: false })
  @IsString()
  @IsOptional()
  tenderText?: string;
}
