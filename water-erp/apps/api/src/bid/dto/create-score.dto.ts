import { IsString, IsNumber, IsBoolean, IsOptional, IsNotEmpty, Min, Max } from 'class-validator';

export class CreateScoreDto {
  @IsString()
  @IsNotEmpty()
  expertId: string;

  @IsString()
  @IsNotEmpty()
  scoreItemId: string;

  @IsString()
  @IsNotEmpty()
  supplierId: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  score: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsBoolean()
  @IsOptional()
  passed?: boolean;
}
