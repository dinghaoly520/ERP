import { IsString, IsNotEmpty } from 'class-validator';

export class DecryptSupplierDto {
  @IsString() @IsNotEmpty()
  amount: string;

  @IsString() @IsNotEmpty()
  period: string;

  @IsString() @IsNotEmpty()
  qualityTarget: string;

  @IsString() @IsNotEmpty()
  bondStatus: string;
}
