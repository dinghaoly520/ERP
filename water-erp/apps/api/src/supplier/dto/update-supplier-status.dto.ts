import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateSupplierStatusDto {
  @IsString() @IsNotEmpty()
  reason: string;
}