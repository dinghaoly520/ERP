import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** A-105（GB/T 43711 7.5.4.4 / 实施条例第57条）：保证金逐家退还登记（按供应商行，替代项目级登记） */
export class SupplierBondReturnDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  supplierName!: string;

  /** true=已退还；false=不予退还（须附理由） */
  @IsBoolean()
  returned!: boolean;

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}
