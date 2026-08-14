import { isPassFailCategory } from '@water-erp/shared';

/** 评分条目（桌面端与平板端共用的规范定义，D3 收口） */
export type ScoreEntry = {
  score: number;
  reason: string;
  passed?: boolean;
  points?: Record<string, { checked: boolean; awardedScore: number; note?: string }>;
};

/** ScoreEntry 的校验视图——三字段均可缺省，半成品草稿也送校验 */
export type ScoreEntryLike = Partial<Pick<ScoreEntry, 'passed' | 'score' | 'reason'>>;

export interface MissingScore {
  itemId: string;
  message: string;
}

/**
 * 校验某供应商的评分完整性（桌面端与平板端共用，P1-15）：
 * - 通过性项（QUALIFICATION/RESPONSIVE）：必须有通过/不通过结论；不通过须填写理由。
 * - 数值项：低于满分须填写理由。
 * 返回缺漏项列表（空数组 = 完整可提交）。
 */
export function validateSupplierScores(
  scoreItems: { id: string; category: string; maxScore: number | string }[],
  scores: Record<string, ScoreEntryLike>,
  supplierId: string,
  scoreKey: (supplierId: string, scoreItemId: string) => string = (s, i) => `${s}:${i}`,
): MissingScore[] {
  const missing: MissingScore[] = [];
  for (const si of scoreItems) {
    const entry = scores[scoreKey(supplierId, si.id)];
    if (isPassFailCategory(si.category)) {
      if (typeof entry?.passed !== 'boolean') {
        missing.push({ itemId: si.id, message: '请选择通过/不通过' });
      } else if (entry.passed === false && !(entry.reason || '').trim()) {
        missing.push({ itemId: si.id, message: '不通过须填写理由' });
      }
    } else {
      const score = entry?.score ?? 0;
      if (score < Number(si.maxScore) && !(entry?.reason || '').trim()) {
        missing.push({ itemId: si.id, message: '低于满分须填写理由' });
      }
    }
  }
  return missing;
}
