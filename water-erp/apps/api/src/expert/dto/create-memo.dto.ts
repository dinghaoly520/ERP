import { IsOptional, IsString } from 'class-validator';

export class CreateMemoDto {
  @IsOptional()
  @IsString()
  contentText?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  scoreItemId?: string;

  @IsOptional()
  @IsString()
  sourceDevice?: string;
}
