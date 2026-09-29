import { IsString, IsOptional } from 'class-validator';

/** 三级审核·通过（2026-09-29）：staff/leader 级同意缘由必填（service 校验），admin 终审缘由可选 */
export class ApproveSupplierDto {
  @IsString() @IsOptional()
  reason?: string;
}
