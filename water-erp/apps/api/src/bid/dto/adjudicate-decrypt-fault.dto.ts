import { IsIn, IsNotEmpty, IsString } from 'class-validator';

/**
 * 解密失败归因裁决（§5.5 主持人处置）：
 * - BIDDER / PLATFORM：UNKNOWN 家落终局（通知按归因分流并告知权利）；
 * - RESET_PENDING：重置解密机会（窗口须开），供应商站内信提示重新解密（T13 硬前置）。
 * reason 必填（写监督日志 + 审计）。
 */
export class AdjudicateDecryptFaultDto {
  @IsString()
  @IsNotEmpty()
  supplierId: string;

  @IsIn(['BIDDER', 'PLATFORM', 'RESET_PENDING'])
  attribution: 'BIDDER' | 'PLATFORM' | 'RESET_PENDING';

  @IsString()
  @IsNotEmpty()
  reason: string;
}
