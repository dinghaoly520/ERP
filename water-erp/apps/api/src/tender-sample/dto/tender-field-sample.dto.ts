import { IsString, IsBoolean, IsOptional, IsEnum } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

export class CreateTenderFieldSampleDto {
  @IsString()
  fieldKey: string;

  @IsString()
  content: string;

  @EmptyAsUndefined()
  @IsBoolean()
  @IsOptional()
  isFavorite?: boolean;

  @EmptyAsUndefined()
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

  @EmptyAsUndefined()
  @IsBoolean()
  @IsOptional()
  isFavorite?: boolean;
}

export class QueryTenderFieldSampleDto {
  @IsString()
  fieldKey: string;

  @EmptyAsUndefined()
  @IsBoolean()
  @IsOptional()
  isFavorite?: boolean;
}
