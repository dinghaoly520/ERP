import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** CTS A-218/222 专家库状态机：入库审核/暂停/退库（审核留痕 verifiedBy/At） */
export class UpdateExpertStatusDto {
  @IsIn(['PENDING', 'ACTIVE', 'SUSPENDED', 'RETIRED'])
  status!: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'RETIRED';

  /** 暂停/退库/恢复事由（退库必填） */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
