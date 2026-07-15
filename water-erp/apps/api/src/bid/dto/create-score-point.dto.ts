import { IsString, IsNotEmpty, IsNumber, IsInt, Min, Max, IsBoolean, IsOptional } from 'class-validator';

export class CreateScorePointDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  @Max(9999.9)
  fullScore: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  seq?: number;

  @IsString()
  @IsOptional()
  evidenceHint?: string;

  @IsBoolean()
  @IsOptional()
  objective?: boolean;
}
