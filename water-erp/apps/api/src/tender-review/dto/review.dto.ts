import { IsString, IsOptional, IsIn } from 'class-validator';
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
}

export class UploadReviewDocDto {
  // File is handled by multer interceptor, no DTO fields needed
}

export class ExtractRulesDto {
  @ApiProperty()
  @IsString()
  knowledgeBaseId: string;
}
