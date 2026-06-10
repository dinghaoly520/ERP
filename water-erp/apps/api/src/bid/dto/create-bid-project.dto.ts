import { IsString, IsNotEmpty, IsDateString, IsOptional } from 'class-validator';

export class CreateBidProjectDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() procurementMethod: string;
  @IsDateString() openTime: string;
  @IsDateString() deadline: string;
  @IsString() @IsOptional() riskNote?: string;
}
