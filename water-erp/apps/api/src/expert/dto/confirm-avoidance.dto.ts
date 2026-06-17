import { IsArray, IsString, IsOptional } from 'class-validator';

export class ConfirmAvoidanceDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  conflictedSupplierIds?: string[];
}
