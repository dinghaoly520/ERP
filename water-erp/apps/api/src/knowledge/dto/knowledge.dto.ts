import { IsString, IsOptional, IsBoolean } from 'class-validator';
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
