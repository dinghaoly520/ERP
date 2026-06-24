// apps/api/src/ai-bid-analysis/dto/create-task.dto.ts
import { IsString, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTaskDto {
  @ApiProperty({ description: '关联 BidProject ID（ERP 适配：procurement 原为 name/projectName 软关联）' })
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty({ description: '任务名称' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: '项目名称', required: false })
  @IsString()
  @IsOptional()
  projectName?: string;
}
