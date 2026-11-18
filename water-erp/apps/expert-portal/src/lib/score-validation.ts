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
 * 构建评分项的完整得分点映射，已存 points 优先。
 * 缺失点：通过制按 passed 回填；只有一个数值得分点且已有提交分时，按该分值回填；其余为未勾选、0 分。
 * 调用方先使用 buildFullPoints 的完整结果，再覆盖当前编辑点，避免遗漏其他得分点。
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
 * 判断内存评分是否与已提交记录等价，用于筛选尚未提交的草稿。
 * 比较 score、passed、reason，并按 buildFullPoints 的同一规则归一得分点映射。
 * note 变化会产生草稿；编辑后还原为提交值则不保留草稿。item 缺失时仅比较三字段。
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
 * bug#140a 资格短路（2026-11-18 复裁补实施）：本专家对该供应商已判任一通过性项
 * 「不通过」→ 该供应商的非通过性类目免评。与后端 recomputeExpertProgress 豁免分母
 * 同口径（豁免仅本专家；废标仍按多专家过半投票，两轨并行不互斥）。
 * 消费面：validateSupplierScores（校验跳过）/ 提交 payload 过滤（防 0 分污染聚合）/
 * 双端评分 UI「资格未过·免评」只读态。
 */
export function isQualificationShortCircuited(
  scoreItems: { id: string; category: string }[],
  scores: Record<string, ScoreEntryLike>,
  supplierId: string,
  scoreKey: (supplierId: string, scoreItemId: string) => string = (s, i) => `${s}:${i}`,
): boolean {
  return scoreItems.some(
    (si) => isPassFailCategory(si.category) && scores[scoreKey(supplierId, si.id)]?.passed === false,
  );
}

/**
 * 校验某供应商的评分完整性（桌面端与平板端共用）：
 * - 通过性项（QUALIFICATION/RESPONSIVE）：必须有通过/不通过结论；不通过须填写理由（含触发豁免的那一项）。
 * - 数值项：低于满分须填写理由。
 * - bug#140a 资格短路：已判任一通过性项不通过 → 跳过非通过性项校验（免评）。
 * 返回缺漏项列表（空数组 = 完整可提交）。
 */
export function validateSupplierScores(
  scoreItems: { id: string; category: string; maxScore: number | string }[],
  scores: Record<string, ScoreEntryLike>,
  supplierId: string,
  scoreKey: (supplierId: string, scoreItemId: string) => string = (s, i) => `${s}:${i}`,
): MissingScore[] {
  const missing: MissingScore[] = [];
  const shortCircuited = isQualificationShortCircuited(scoreItems, scores, supplierId, scoreKey);
  for (const si of scoreItems) {
    const entry = scores[scoreKey(supplierId, si.id)];
    if (isPassFailCategory(si.category)) {
      if (typeof entry?.passed !== 'boolean') {
        missing.push({ itemId: si.id, message: '请选择通过/不通过' });
      } else if (entry.passed === false && !(entry.reason || '').trim()) {
        missing.push({ itemId: si.id, message: '不通过须填写理由' });
      }
    } else {
      if (shortCircuited) continue; // bug#140a：资格未过·免评——非通过性项不校验
      const score = entry?.score ?? 0;
      if (score < Number(si.maxScore) && !(entry?.reason || '').trim()) {
        missing.push({ itemId: si.id, message: '低于满分须填写理由' });
      }
    }
  }
  return missing;
}

/**
 * EXP-P0-01：价格分公式激活（priceFormulaConfig 非空）的项目，PRICE 项由系统公式
 * 自动计算——不进专家校验、不进提交 payload、不进进度/汇总分母。
 * 后端 PRICE_FORMULA_ACTIVE 拒收闸（expert.service.ts submitScores）保留作纵深。
 */
export function filterScorableItems<T extends { category: string }>(
  scoreItems: T[],
  priceFormulaActive: boolean,
): T[] {
  if (!priceFormulaActive) return scoreItems;
  return scoreItems.filter((si) => si.category !== 'PRICE');
}

/**
 * TAB-SYNC-02 ⑤：pending-only 草稿构建——原桌面 buildPendingDraft / 平板 buildPendingTabletDraft
 * 逐字重复副本收敛。与已提交记录等价（isCommittedEquivalent 三字段+得分点）的条目不入草稿；
 * 无已提交记录或评分项缺失（item 缺失仅比较三字段的既有口径）→ 保留。
 */
export function buildPendingScoreDraft(
  scores: Record<string, ScoreEntry>,
  myScores?: CommittedScoreRecord[] | null,
  scoreItems?: Array<{ id: string; category: string; points?: BidScorePoint[] }> | null,
): Record<string, ScoreEntry> {
  const pending: Record<string, ScoreEntry> = {};
  for (const [k, v] of Object.entries(scores)) {
    const [sid, itemId] = k.split(':');
    const rec = committedRecordFor(myScores, sid, itemId);
    const si = (scoreItems ?? []).find((s) => s.id === itemId);
    if (!rec || !si || !isCommittedEquivalent(v, rec, si)) pending[k] = v;
  }
  return pending;
}

/**
 * TAB-SYNC-02 ①（T2/T3 审查 Important#1 回修）：pointDecisions 提及键的基线条目——
 * **纯服务端构造**。原实现 `serverMentioned[k] = next[k]`（next 从 prev 起步）会把本地
 * 未推送 score/reason/passed 与非提及点决策混入基线——对端同键并发编辑被判 local==base
 * 静默接受（缺陷①在提及键上的残留形态）。本函数与本地 scores 状态完全无关：
 * 三字段取 committedRecordFor 记录（无记录→零值兜底）、points 仅含该键的服务端点决策
 * （无服务端决策的点不出现——不回退本地、不造默认值）。
 */
export function buildServerMentionedEntries(
  myScores: CommittedScoreRecord[] | undefined | null,
  scoreItems: Array<{ id: string; points?: Array<{ id: string }> }> | undefined | null,
  pointDecisions: Array<{ pointId: string; supplierId: string; checked: boolean; awardedScore: number | string; note?: string }> | undefined | null,
): Record<string, ScoreEntry> {
  const pointToItem = new Map<string, string>();
  for (const si of scoreItems ?? []) {
    for (const pt of si.points ?? []) pointToItem.set(pt.id, si.id);
  }
  const mentioned: Record<string, ScoreEntry> = {};
  for (const pd of pointDecisions ?? []) {
    const scoreItemId = pointToItem.get(pd.pointId);
    if (!scoreItemId) continue; // 悬空点决策（评分项已删改）不造键
    const k = `${pd.supplierId}:${scoreItemId}`;
    const rec = committedRecordFor(myScores, pd.supplierId, scoreItemId);
    let entry = mentioned[k];
    if (!entry) {
      entry = {
        score: Number(rec?.score ?? 0),
        reason: rec?.reason ?? '',
        ...(rec?.passed != null ? { passed: rec.passed } : {}),
        points: {},
      };
      mentioned[k] = entry;
    }
    entry.points![pd.pointId] = { checked: pd.checked, awardedScore: Number(pd.awardedScore), note: pd.note || undefined };
  }
  return mentioned;
}
