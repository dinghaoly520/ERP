import { IsString, IsOptional } from 'class-validator';

export class UpdateBidProjectDto {
  @IsString() @IsOptional() stage?: string;
  @IsString() @IsOptional() riskNote?: string;
}
