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
}

export class BatchCreateScorePointsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScorePointInputDto)
  points: ScorePointInputDto[];
}
