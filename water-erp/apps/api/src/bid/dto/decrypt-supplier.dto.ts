import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class DecryptSupplierDto {
  @IsString() @IsOptional()
  amount?: string;

  @IsString() @IsOptional()
  period?: string;

  @IsString() @IsOptional()
  qualityTarget?: string;

  @IsString() @IsOptional()
  bondStatus?: string;

  @IsBoolean() @IsOptional()
  simulateDanger?: boolean;
}
