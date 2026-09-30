import { IsString, IsNotEmpty, IsArray, IsOptional } from 'class-validator';

export class UpdateSupplierStatusDto {
  @IsString() @IsNotEmpty()
  reason: string;

  /** 审核意见附件（2026-09-30）：FileAsset id 列表，随留痕入库 */
  @IsArray() @IsOptional()
  @IsString({ each: true })
  attachmentIds?: string[];
}