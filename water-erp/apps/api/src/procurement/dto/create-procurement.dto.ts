import { IsString, IsNotEmpty, IsOptional, IsDateString, IsNumber } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

export class CreateProcurementDto {
  @IsString() @IsNotEmpty()
  title: string;

  @IsString() @IsNotEmpty()
  procurementType: string; // 货物/工程/服务

  @IsString() @IsNotEmpty()
  procurementMethod: string; // 公开招标/邀请招标/谈判采购/单一来源

  @EmptyAsUndefined()
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

  @EmptyAsUndefined()
  @IsNumber() @IsOptional()
  budget?: number;

  @IsString() @IsOptional()
  description?: string;
}

export class RejectProcurementDto {
  @IsString() @IsNotEmpty()
  reason: string;
}
