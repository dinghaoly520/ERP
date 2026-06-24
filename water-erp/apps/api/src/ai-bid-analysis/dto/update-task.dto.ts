// apps/api/src/ai-bid-analysis/dto/update-task.dto.ts
import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateTaskDto {
  @ApiProperty({ description: '任务名称', required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ description: '项目名称', required: false })
  @IsString()
  @IsOptional()
  projectName?: string;
}
