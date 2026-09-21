import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateClarificationDto {
  @IsString() @IsOptional() type?: string;
  /** BidSupplier.id（行 id，须属于本项目）——后端校验归属并转换为 Supplier.id 落库（F3） */
  @IsString() @IsOptional() supplierId?: string;
  @IsString() @IsNotEmpty() question: string;
  @IsString() @IsNotEmpty() issuer: string;
  @IsString() @IsNotEmpty() supplierName: string;
}
