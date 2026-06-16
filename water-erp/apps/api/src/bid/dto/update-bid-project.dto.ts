import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';

export class UpdateBidProjectDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() procurementMethod?: string;
  @IsDateString() @IsOptional() openTime?: string;
  @IsDateString() @IsOptional() deadline?: string;
  @IsString() @IsOptional() stage?: string;
  @IsString() @IsOptional() riskNote?: string;
  @IsNumber() @IsOptional() budget?: number;
  @IsString() @IsOptional() scope?: string;
  @IsString() @IsOptional() qualification?: string;
  @IsString() @IsOptional() contact?: string;
}
