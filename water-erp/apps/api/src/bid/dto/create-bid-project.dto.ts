import { IsString, IsNotEmpty, IsDateString, IsOptional, IsNumber, IsBoolean } from 'class-validator';

export class CreateBidProjectDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() procurementMethod: string;
  @IsDateString() openTime: string;
  @IsDateString() deadline: string;
  @IsString() @IsOptional() riskNote?: string;
  @IsString() @IsOptional() projectManagementItemId?: string; // A1：宿主台账项（国标编码复用其 18 位基码）
  @IsNumber() @IsOptional() budget?: number;
  @IsString() @IsOptional() scope?: string;
  @IsString() @IsOptional() qualification?: string;
  @IsString() @IsOptional() contact?: string;
  @IsString() @IsOptional() qualityRequirement?: string;
  @IsBoolean() @IsOptional() bondRequired?: boolean;
  @IsNumber() @IsOptional() bondAmount?: number;
  /** P1-4（2026-09-09 补录入口）：依法必招标示——true 时 B-004（售标→开标≥20日）/B-009（发售期≥5日）发布闸门强制；缺省 false（集团内部采购惯例不强制，偏离留痕） */
  @IsBoolean() @IsOptional() legalMandatory?: boolean;
  /** 关联公告 ID：通过公告创建项目时填入，自动写入公告的 relatedProjectCode */
  @IsString() @IsOptional() announcementId?: string;
}
