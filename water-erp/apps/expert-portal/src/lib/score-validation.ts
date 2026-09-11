import { isPassFailCategory } from '@water-erp/shared';
import type { BidScorePoint } from '@water-erp/shared';

/** 评分条目（桌面端与平板端共用的规范定义，D3 收口） */
export type ScoreEntry = {
  score: number;
  reason: string;
  passed?: boolean;
  points?: Record<string, { checked: boolean; awardedScore: number; note?: string }>;
};

/** 得分点决策值（与 point-checklist-scoring 的 PointDecisionValue 结构性兼容，不 import 组件） */
export type PointDecisionValue = { checked: boolean; awardedScore: number; note?: string };

/** myScores 元素的公共结构（兼容桌面/平板 hydration 的 project.myScores 记录） */
export type CommittedScoreRecord = {
  supplierId: string;
  scoreItemId: string;
  score: number;
  passed?: boolean | null;
  reason?: string | null;
};

/**
 * 构建某评分项的「完整」得分点映射（QA-2026-09-11 P1-3/P2-3 共享回退规则）：
 * - 已存 points 优先（stored 赢）；
 * - 缺失点：通过制 → passed===true 全点勾选满分，否则未勾选 0；
 * - 缺失点：数值项且仅 1 个得分点且有提交分 → 勾选 + 提交分（无 pointDecisions 的口径回显）；
 * - 其余 → 未勾选 0。
 * 调用方以 `{ ...buildFullPoints(item, cur, committedScore), [pointId]: value }` 起种子，
 * 保证映射永远完整，杜绝「部分映射卡死不通过」（P1-3）。
 */
export function buildFullPoints(
  item: { category: string; points?: BidScorePoint[] },
  entry: ScoreEntry | undefined,
  committedScore?: number | null,
): Record<string, PointDecisionValue> {
  const map: Record<string, PointDecisionValue> = {};
  const isPF = isPassFailCategory(item.category);
  for (const pt of item.points ?? []) {
    const stored = entry?.points?.[pt.id];
    if (stored) {
      map[pt.id] = {
        checked: stored.checked,
        awardedScore: stored.awardedScore,
        ...(stored.note ? { note: stored.note } : {}),
      };
      continue;
    }
    if (isPF) {
      map[pt.id] = entry?.passed === true
        ? { checked: true, awardedScore: Number(pt.fullScore) }
        : { checked: false, awardedScore: 0 };
    } else if ((item.points?.length ?? 0) === 1 && committedScore != null) {
      map[pt.id] = { checked: true, awardedScore: Number(committedScore) };
    } else {
      map[pt.id] = { checked: false, awardedScore: 0 };
    }
  }
  return map;
}

/** 从 myScores 列表查找某供应商某评分项的已提交记录 */
export function committedRecordFor(
  myScores: CommittedScoreRecord[] | undefined | null,
  supplierId: string,
  scoreItemId: string,
): CommittedScoreRecord | undefined {
  return (myScores ?? []).find((r) => r.supplierId === supplierId && r.scoreItemId === scoreItemId);
}

/**
 * 判定内存条目是否与已提交记录「等价」——草稿 pending 过滤的核心（QA-2026-09-11 P1-1）：
 * score/passed/reason 全等，且得分点**有效映射**逐点等价（checked/awardedScore/note 归一 '' → 缺失）。
 * 有效映射用 buildFullPoints 两侧同规则回退——PRICE 无 pointDecisions 的已提交项（两侧同缺）判等价、
 * 不产生幽灵草稿；note 编辑 / 抵消式编辑（改后再还原）分别如实进草稿 / 判等价（相邻洞 A6）。
 * item 缺失时退化为三字段比较。
 */
export function isCommittedEquivalent(
  entry: ScoreEntry,
  rec: CommittedScoreRecord,
  item?: { category: string; points?: BidScorePoint[] },
): boolean {
  if (!rec) return false;
  if (Number(entry.score) !== Number(rec.score)) return false;
  if ((entry.passed ?? null) !== (rec.passed ?? null)) return false;
  if ((entry.reason ?? '') !== (rec.reason ?? '')) return false;
  if (!item) return true;
  const effActual = buildFullPoints(item, entry, Number(rec.score));
  const effCommitted = buildFullPoints(
    item,
    { score: Number(rec.score), reason: rec.reason ?? '', passed: rec.passed ?? undefined },
    Number(rec.score),
  );
  const ids = new Set([...Object.keys(effActual), ...Object.keys(effCommitted)]);
  for (const id of ids) {
    const a = effActual[id];
    const e = effCommitted[id];
    if (!a || !e) return false;
    if (a.checked !== e.checked) return false;
    if (Number(a.awardedScore) !== Number(e.awardedScore)) return false;
    if ((a.note ?? '') !== (e.note ?? '')) return false;
  }
  return true;
}

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
