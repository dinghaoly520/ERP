import { IsDateString, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

export class CreatePlanItemDto {
  @IsString()
  @MaxLength(200)
  content!: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @EmptyAsUndefined()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @EmptyAsUndefined()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @EmptyAsUndefined()
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
