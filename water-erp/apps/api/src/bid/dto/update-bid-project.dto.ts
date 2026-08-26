import { IsString, IsOptional, IsNumber, IsDateString, IsBoolean } from 'class-validator';

export class UpdateBidProjectDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() procurementMethod?: string;
  @IsDateString() @IsOptional() openTime?: string;
  @IsDateString() @IsOptional() deadline?: string;
  @IsString() @IsOptional() riskNote?: string;
  @IsNumber() @IsOptional() budget?: number;
  @IsString() @IsOptional() scope?: string;
  @IsString() @IsOptional() qualification?: string;
  @IsString() @IsOptional() contact?: string;
  @IsString() @IsOptional() qualityRequirement?: string;
  @IsBoolean() @IsOptional() bondRequired?: boolean;
  @IsNumber() @IsOptional() bondAmount?: number;
  // CTS A-39/40 标段（包）标识
  @IsString() @IsOptional() sectionNo?: string;
  @IsString() @IsOptional() sectionName?: string;
}
