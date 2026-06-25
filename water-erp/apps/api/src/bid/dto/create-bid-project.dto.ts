import { IsString, IsNotEmpty, IsDateString, IsOptional, IsNumber, IsBoolean } from 'class-validator';

export class CreateBidProjectDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() procurementMethod: string;
  @IsDateString() openTime: string;
  @IsDateString() deadline: string;
  @IsString() @IsOptional() riskNote?: string;
  @IsNumber() @IsOptional() budget?: number;
  @IsString() @IsOptional() scope?: string;
  @IsString() @IsOptional() qualification?: string;
  @IsString() @IsOptional() contact?: string;
  @IsString() @IsOptional() qualityRequirement?: string;
  @IsBoolean() @IsOptional() bondRequired?: boolean;
  @IsNumber() @IsOptional() bondAmount?: number;
  /** 关联公告 ID：通过公告创建项目时填入，自动写入公告的 relatedProjectCode */
  @IsString() @IsOptional() announcementId?: string;
}
