import { IsString, IsNumber, IsOptional } from 'class-validator';

export class CreateScoreDto {
  @IsString() expertId: string;
  @IsString() scoreItemId: string;
  @IsNumber() score: number;
  @IsString() @IsOptional() reason?: string;
}
