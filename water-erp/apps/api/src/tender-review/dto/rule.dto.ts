import {
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

export class CreateRuleDto {
  @ApiProperty()
  @IsString()
  knowledgeBaseId: string;

  @ApiProperty()
  @IsString()
  source: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsIn(['numeric_compare', 'existence_check', 'semantic'])
  ruleType: 'numeric_compare' | 'existence_check' | 'semantic';

  @ApiProperty()
  @IsString()
  checkTarget: string;

  @ApiProperty()
  @IsObject()
  logicExpression: Record<string, unknown>;

  @ApiProperty()
  @IsIn(['critical', 'warning', 'info'])
  severity: 'critical' | 'warning' | 'info';
}

export class UpdateRuleDto extends PartialType(CreateRuleDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
