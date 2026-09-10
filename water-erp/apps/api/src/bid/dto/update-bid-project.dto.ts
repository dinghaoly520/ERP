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
  /** P1-4：依法必招标示——仅 DOWNLOAD/SUBMIT 可改（service 层阶段闸 LEGAL_FLAG_LOCKED） */
  @IsBoolean() @IsOptional() legalMandatory?: boolean;
  // CTS A-39/40 标段（包）标识
  @IsString() @IsOptional() sectionNo?: string;
  @IsString() @IsOptional() sectionName?: string;
}
