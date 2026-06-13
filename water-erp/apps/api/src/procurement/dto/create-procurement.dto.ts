import { IsString, IsNotEmpty, IsOptional, IsDateString, IsNumber } from 'class-validator';

export class CreateProcurementDto {
  @IsString() @IsNotEmpty()
  title: string;

  @IsString() @IsNotEmpty()
  procurementType: string; // 货物/工程/服务

  @IsString() @IsNotEmpty()
  procurementMethod: string; // 公开招标/邀请招标/竞争性谈判/单一来源

  @IsNumber() @IsOptional()
  budget?: number;

  @IsString() @IsOptional()
  description?: string;

  @IsString() @IsOptional()
  departmentId?: string;
}

export class UpdateProcurementDto {
  @IsString() @IsOptional()
  title?: string;

  @IsString() @IsOptional()
  procurementType?: string;

  @IsString() @IsOptional()
  procurementMethod?: string;

  @IsNumber() @IsOptional()
  budget?: number;

  @IsString() @IsOptional()
  description?: string;
}

export class RejectProcurementDto {
  @IsString() @IsNotEmpty()
  reason: string;
}
