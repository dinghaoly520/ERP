import { IsString, IsOptional, IsIn, IsObject, MaxLength } from 'class-validator';
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

  // 审计第 3 处：不再接收对象键——文件只经上传记录 id 引用，键由服务端反查
  @ApiPropertyOptional({ description: '审查文档上传记录 id（POST /tender-review/review/upload 返回）；不带即纯文本审查' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  fileId?: string;

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
