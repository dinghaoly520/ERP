import { IsString, IsNumber, IsPositive, Max } from 'class-validator';

/** SUP-P2-04（2026-09-29 审查修复）：多轮报价此前裸 Body（无 DTO 无 class-validator），
 *  0/负数报价可入库参与排名（orderBy quotePrice asc），非数字字符串致 Prisma 500 裸错。 */
export class SubmitQuoteDto {
  @IsString()
  bidSupplierId!: string;

  /** 报价金额（元侧——BidQuote 单位口径），须为正数且 ≤1e12（两位小数由 controller 规整） */
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1e12)
  quotePrice!: number;
}
