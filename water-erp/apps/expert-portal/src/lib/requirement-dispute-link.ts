/**
 * 条款↔得分点争议精确关联（Phase 2，2026-09-27 方案落地）：
 * 管理端映射（BidScorePoint.linkedRequirementIds，条款映射线 Phase 1）×
 * 专家端条款核对争议（BidRequirementReview 的 dispute/doubt，my-scores 下发）的查表纯函数。
 *
 * ID 同源：两端都指 AiBidAnalysisTask.requirements JSON 内嵌的 r.id
 * （管理端 getTenderRequirements / 专家端 buildExpertReviews 同源，已核实）。
 * 映射缺失的争议不进本表——由调用方回退既有的「按类别路由」行为（renderReviewPanel）。
 */

export interface LinkedDispute {
  requirementId: string;
  /** 条款原文（来自争议记录 content） */
  content: string;
  /** 专家备注 */
  note: string;
  verdict: 'dispute' | 'doubt';
}

export interface PointLocator {
  itemId: string;
  pointId: string;
  pointName: string;
}

/** requirementId → 关联得分点定位列表（跨评分项；一条款映射多个得分点全命中） */
export function buildReqToPointIndex(
  scoreItems: Array<{
    id: string;
    points?: Array<{ id: string; name: string; linkedRequirementIds?: string[] | null }> | null;
  }>,
): Map<string, PointLocator[]> {
  const map = new Map<string, PointLocator[]>();
  for (const si of scoreItems) {
    for (const p of si.points ?? []) {
      for (const rid of p.linkedRequirementIds ?? []) {
        const list = map.get(rid);
        if (list) list.push({ itemId: si.id, pointId: p.id, pointName: p.name });
        else map.set(rid, [{ itemId: si.id, pointId: p.id, pointName: p.name }]);
      }
    }
  }
  return map;
}

/** 争议列表 → pointId 聚合（多争议落同一点收敛为列表；未命中映射的争议被丢弃）。
 *  去重（2026-09-27 验收实录）：★实质性条款同时落原组+RESPONSIVE 两个类别桶
 *  （getMyScores ⑦ 口径），同条争议在 flat() 后出现两次——按 requirementId+verdict
 *  去重，防徽章误双计（异议2 实为 1 条）。 */
export function disputesToPoint(
  disputes: LinkedDispute[],
  index: Map<string, PointLocator[]>,
): Map<string, LinkedDispute[]> {
  const seen = new Set<string>();
  const byPoint = new Map<string, LinkedDispute[]>();
  for (const d of disputes) {
    const key = `${d.requirementId}:${d.verdict}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const hit of index.get(d.requirementId) ?? []) {
      const list = byPoint.get(hit.pointId);
      if (list) list.push(d);
      else byPoint.set(hit.pointId, [d]);
    }
  }
  return byPoint;
}
