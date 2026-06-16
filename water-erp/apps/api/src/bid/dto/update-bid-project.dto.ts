import { IsString, IsOptional, IsNumber } from 'class-validator';

export class UpdateBidProjectDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() procurementMethod?: string;
  @IsString() @IsOptional() openTime?: string;
  @IsString() @IsOptional() deadline?: string;
  @IsString() @IsOptional() stage?: string;
  @IsString() @IsOptional() riskNote?: string;
  @IsNumber() @IsOptional() budget?: number;
  @IsString() @IsOptional() scope?: string;
  @IsString() @IsOptional() qualification?: string;
  @IsString() @IsOptional() contact?: string;
}
