/**
 * N12/N13-A（2026-11-20b 复核轮）：v3 投递/补传暂存资产闸单测。
 * 语义：首投与补传统一——暂存行缺失 400 STAGED_ASSET_MISSING（对齐 M-2 硬中止，
 * 不再静默 continue 短路备份）；实算 sha 与信封声明不符 400 OUTER_HASH_MISMATCH
 * （首投对齐补传六闸之六——原首投无此交叉闸，声明不符要到开标 pass1 才炸）。
 */
import { BadRequestException } from '@nestjs/common';
import { assertStagedAssetIntact } from './staged-asset-gate.util';

describe('assertStagedAssetIntact（N12/N13-A v3 暂存闸）', () => {
  const entry = { assetId: 'fa-1', outerSha256: 'aa'.repeat(32) } as any;

  test('缺失暂存行 → 400 STAGED_ASSET_MISSING（不再静默跳过）', () => {
    try {
      assertStagedAssetIntact('technical', entry, null);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.getResponse?.()).toMatchObject({ code: 'STAGED_ASSET_MISSING' });
      expect(e.getResponse?.().error).toContain('technical');
    }
  });

  test('实算 sha ≠ 信封声明 → 400 OUTER_HASH_MISMATCH（首投补交叉闸）', () => {
    const staged = { id: 'fa-1', sha256: 'bb'.repeat(32) } as any;
    try {
      assertStagedAssetIntact('business', entry, staged);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e.getResponse?.()).toMatchObject({ code: 'OUTER_HASH_MISMATCH' });
      expect(e.getResponse?.().error).toContain('business');
    }
  });

  test('行在且哈希一致 → 放行（无异常）', () => {
    const staged = { id: 'fa-1', sha256: 'aa'.repeat(32) } as any;
    expect(() => assertStagedAssetIntact('technical', entry, staged)).not.toThrow();
  });
});
