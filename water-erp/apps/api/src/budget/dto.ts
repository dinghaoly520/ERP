import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class CreateBudgetListDto {
  @IsString()
  name: string;
}

export class UpdateBudgetListDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() remark?: string;
  @IsOptional() @IsString() status?: string;
}

export class CloneBudgetListDto {
  @IsOptional() @IsString() name?: string;
}

export class BudgetItemInput {
  @IsOptional() @IsString() catalogItemId?: string | null;
  @IsString() code: string;
  @IsString() name: string;
  @IsOptional() @IsString() specification?: string | null;
  @IsString() unit: string;
  @IsNumber() @Min(0) referencePrice: number;
  @IsNumber() @Min(0) qty: number;
}

export class SyncBudgetItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BudgetItemInput)
  items: BudgetItemInput[];
}
