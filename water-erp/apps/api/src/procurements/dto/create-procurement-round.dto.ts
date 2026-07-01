import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  IsArray,
  IsEnum,
  Min,
} from 'class-validator';
import { ResultStatus } from '@prisma/client';

export class CreateProcurementRoundDto {
  @IsString()
  projectName: string;

  @IsOptional()
  @IsString()
  projectCode?: string;

  @IsOptional()
  @IsDateString()
  procurementDate?: string;

  @IsString()
  procurementMethod: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  departmentName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  controlAmount?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supplierIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supplierNames?: string[];

  @IsOptional()
  @IsString()
  awardedSupplierId?: string;

  @IsOptional()
  @IsString()
  awardedSupplierName?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  awardAmount?: number;

  @IsOptional()
  @IsEnum(ResultStatus)
  resultStatus?: ResultStatus;

  @IsOptional()
  @IsString()
  resultText?: string;
}
