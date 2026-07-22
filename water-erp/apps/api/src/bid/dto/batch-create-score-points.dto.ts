import { IsArray, ValidateNested, IsString, IsNotEmpty, IsNumber, Min, Max, IsBoolean, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ScorePointInputDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  @Max(9999.9)
  fullScore: number;

  @IsString()
  @IsOptional()
  evidenceHint?: string;

  @IsBoolean()
  @IsOptional()
  objective?: boolean;

  @IsString()
  @IsOptional()
  evidenceSection?: string;

  @IsNumber()
  @Min(0)
  @Max(1)
  @IsOptional()
  confidence?: number;
}

export class BatchCreateScorePointsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScorePointInputDto)
  points: ScorePointInputDto[];
}
