import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateKnowledgeBaseDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '是否共享（共享后全员可用，维护仅创建者 + admin）' })
  @IsOptional()
  @IsBoolean()
  isShared?: boolean;
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: '切换共享（共享后全员可用，维护仅创建者 + admin）' })
  @IsOptional()
  @IsBoolean()
  isShared?: boolean;
}
