import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** CTS A-218/222 专家库状态机：入库审核/退库（审核留痕 verifiedBy/At）。
 *  2026-11-16 两态裁定：SUSPENDED（暂停）目标下线——处置链=在库→停用（账号）→退库。 */
export class UpdateExpertStatusDto {
  @IsIn(['PENDING', 'ACTIVE', 'RETIRED'])
  status!: 'PENDING' | 'ACTIVE' | 'RETIRED';

  /** 退库/恢复事由（退库、退库恢复必填；入库审核可选） */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
