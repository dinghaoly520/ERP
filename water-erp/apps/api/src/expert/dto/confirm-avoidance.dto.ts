import { IsArray, IsString, IsOptional } from 'class-validator';
import { EmptyAsUndefined } from '../../common/decorators/empty-as-undefined.decorator';

export class ConfirmAvoidanceDto {
  @EmptyAsUndefined()
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  conflictedSupplierIds?: string[];
}
