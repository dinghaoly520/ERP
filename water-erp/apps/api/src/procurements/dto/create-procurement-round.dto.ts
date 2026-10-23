import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  IsArray,
  IsEnum,
  Min,
} from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';
import { ResultStatus } from '@prisma/client';

export class CreateProcurementRoundDto {
  @IsString()
  projectName: string;

  @IsOptional()
  @IsString()
  projectCode?: string;

  @EmptyAsUndefined()
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

  @EmptyAsUndefined()
  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetAmount?: number;

  @EmptyAsUndefined()
  @IsOptional()
  @IsNumber()
  @Min(0)
  controlAmount?: number;

  @EmptyAsUndefined()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supplierIds?: string[];

  @EmptyAsUndefined()
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

  @EmptyAsUndefined()
  @IsOptional()
  @IsNumber()
  @Min(0)
  awardAmount?: number;

  @EmptyAsUndefined()
  @IsOptional()
  @IsEnum(ResultStatus)
  resultStatus?: ResultStatus;

  @IsOptional()
  @IsString()
  resultText?: string;
}
