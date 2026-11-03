import { IsString, IsOptional, IsBoolean, IsIn } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateKnowledgeBaseDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @EmptyAsUndefined()
  @ApiPropertyOptional({ description: '是否共享（共享后全员可用，维护仅创建者 + admin）' })
  @IsOptional()
  @IsBoolean()
  isShared?: boolean;

  @ApiPropertyOptional({ description: '所属域：tender_review=采购文件审查（默认） / assistant=水叮当知识库——两域互不可见（2026-11-03 用户裁定）' })
  @IsOptional()
  @IsIn(['tender_review', 'assistant'])
  domain?: 'tender_review' | 'assistant';
}

export class UpdateKnowledgeBaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @EmptyAsUndefined()
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @EmptyAsUndefined()
  @ApiPropertyOptional({ description: '切换共享（共享后全员可用，维护仅创建者 + admin）' })
  @IsOptional()
  @IsBoolean()
  isShared?: boolean;
}
