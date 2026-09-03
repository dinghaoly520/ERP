import { IsIn, IsISO8601, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength } from 'class-validator';

/** A-102：保证金到账台账登记（一家一条，projectId+supplierName 幂等 upsert） */
export class UpsertBondLedgerDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  supplierName!: string;

  /** 金额必须为正（法定收据台账 0/负数无意义）；≤999999999999.99——Decimal(14,2) 容量精确界（溢出会变 Prisma 500） */
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(999999999999.99)
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
