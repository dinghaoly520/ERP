/**
 * v3 投递/补传暂存资产闸（N12/N13-A，2026-11-20b 复核轮提取为可单测纯函数）。
 *
 * 两消费点（supplier-portal.service.ts 首投暂存循环 / reupload 补传暂存循环）统一口径：
 * - 暂存 FileAsset 行缺失 → 400 STAGED_ASSET_MISSING：原 `if (!stagedAsset) continue`
 *   会静默短路备份（M-2 硬中止被绕过，v3 无补账路径=永久缺口）；
 * - 实算 sha256 ≠ 信封声明 outerSha256 → 400 OUTER_HASH_MISMATCH：补传六闸之六原有、
 *   首投原缺（声明不符的投递要到开标 pass1 哈希闸才炸，供应商失去现场前补救窗口）。
 */
import { BadRequestException } from '@nestjs/common';

export interface StagedAssetLike {
  id: string;
  sha256: string | null;
}

export function assertStagedAssetIntact(
  role: string,
  entry: { assetId: string; outerSha256?: string | null },
  staged: StagedAssetLike | null,
): asserts staged is StagedAssetLike {
  if (!staged) {
    throw new BadRequestException({
      error: `${role} 暂存资产不存在（可能已过期清理），请重新暂存后投递`,
      code: 'STAGED_ASSET_MISSING',
    });
  }
  // F8（递延收口）：严格比对——声明缺省（undefined/null）同样视为不符（与补传六闸之六同强度，
  // dual-v3 信封 files[].outerSha256 为必填字段，缺省即信封畸形）
  if (staged.sha256 !== entry.outerSha256) {
    throw new BadRequestException({
      error: `${role} 外层密文哈希与暂存资产实算值不符（疑似调包或截断）`,
      code: 'OUTER_HASH_MISMATCH',
    });
  }
}
