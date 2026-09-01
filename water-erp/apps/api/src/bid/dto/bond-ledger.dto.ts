import { IsIn, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

/** A-102：保证金到账台账登记（一家一条，projectId+supplierName 幂等 upsert） */
export class UpsertBondLedgerDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  supplierName!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  amount!: number;

  @IsISO8601()
  arrivedAt!: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  account!: string;

  @IsIn(['转账', '保函', '支票', '其他'])
  payMethod!: string;

  @IsOptional() @IsString() @MaxLength(200)
  note?: string;
}
