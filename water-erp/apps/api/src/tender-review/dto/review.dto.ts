import { IsString, IsOptional, IsIn, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ExecuteReviewDto {
  @ApiProperty()
  @IsString()
  knowledgeBaseId: string;

  @ApiProperty()
  @IsIn(['strict', 'general'])
  reviewMode: 'strict' | 'general';

  @ApiProperty()
  @IsString()
  documentContent: string;

  @ApiProperty()
  @IsString()
  documentName: string;

  @ApiProperty()
  @IsString()
  objectKey: string;

  @ApiPropertyOptional({ description: '项目 ID（项目管理场景发起时必带）' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ description: '草稿指纹（project-status 响应回传）' })
  @IsOptional()
  @IsString()
  fingerprint?: string;
}

export class ProjectStatusDto {
  @ApiProperty()
  @IsString()
  projectId: string;

  @ApiProperty()
  @IsString()
  documentType: string;

  @ApiProperty({ type: Object })
  @IsObject()
  answers: Record<string, unknown>;
}

export class ExtractRulesDto {
  @ApiProperty()
  @IsString()
  knowledgeBaseId: string;
}
