import { IsString, IsBoolean, IsOptional, IsEnum } from 'class-validator';

export class CreateTenderFieldSampleDto {
  @IsString()
  fieldKey: string;

  @IsString()
  content: string;

  @IsBoolean()
  @IsOptional()
  isFavorite?: boolean;

  @IsEnum(['manual', 'ai_generated'])
  @IsOptional()
  sourceType?: 'manual' | 'ai_generated';

  @IsOptional()
  context?: Record<string, unknown>;
}

export class UpdateTenderFieldSampleDto {
  @IsString()
  @IsOptional()
  content?: string;

  @IsBoolean()
  @IsOptional()
  isFavorite?: boolean;
}

export class QueryTenderFieldSampleDto {
  @IsString()
  fieldKey: string;

  @IsBoolean()
  @IsOptional()
  isFavorite?: boolean;
}
