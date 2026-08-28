import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateClarificationDto {
  @IsString() @IsOptional() type?: string;
  /** BidSupplier.id（行 id，须属于本项目）——后端校验归属并转换为 Supplier.id 落库（F3） */
  @IsString() @IsOptional() supplierId?: string;
  @IsString() @IsNotEmpty() question: string;
  @IsString() @IsNotEmpty() issuer: string;
  @IsString() @IsNotEmpty() supplierName: string;
}

/** AI 起草澄清候选端点入参。内联对象类型不经 ValidationPipe 校验（F3，2026-08-28） */
export class DraftClarificationDto {
  /** BidSupplier.id（行 id）——AI 分析结果按 bidSupplierId 关联 */
  @IsString() @IsNotEmpty() supplierId: string;
}
