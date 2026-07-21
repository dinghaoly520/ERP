import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class BudgetReferenceLineDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  specification?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  qty?: number;
}

export class AnalyzeBudgetReferenceDto {
  @IsString()
  @MaxLength(300)
  procurementTitle!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  procurementCategory?: string;

  /** 货物/工程/服务 —— 用于历史类比检索 */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  procurementType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  projectReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  supplierRequirements?: string;

  /** 显式行项目（名称/规格/单位/数量）；优先级最高 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => BudgetReferenceLineDto)
  lines?: BudgetReferenceLineDto[];

  /** 已有预算清单 id；当未传 lines 时据此读取行项目 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  budgetListId?: string;
}
