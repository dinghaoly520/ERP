import { IsString, IsNotEmpty, IsIn, IsOptional } from 'class-validator';

/** 采购端裁决专家异议工单：status=resolved 采纳，rejected 驳回。 */
export class ResolveExpertDisputeDto {
  @IsString()
  @IsNotEmpty()
  response: string;

  @IsIn(['resolved', 'rejected'])
  status: string;

  /**
   * 采纳时可选联动废标的供应商（BidSupplier.id，须属于本项目）。
   * 注意：必须在此 DTO 显式声明——全局 ValidationPipe whitelist:true
   * 会剥掉未声明字段，缺此声明时前端传来的值到不了 service（2026-08-28 修复）。
   */
  @IsOptional()
  @IsString()
  invalidateBidSupplierId?: string;
}
