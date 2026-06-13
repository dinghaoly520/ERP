import { IsString, IsNumber, IsOptional, IsNotEmpty } from 'class-validator';

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
  score: number;

  @IsString()
  @IsOptional()
  reason?: string;
}
