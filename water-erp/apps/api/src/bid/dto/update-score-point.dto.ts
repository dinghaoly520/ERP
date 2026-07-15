import { IsString, IsNumber, IsInt, Min, Max, IsBoolean, IsOptional } from 'class-validator';

export class UpdateScorePointDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @Min(0)
  @Max(9999.9)
  @IsOptional()
  fullScore?: number;

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
