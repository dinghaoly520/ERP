// apps/api/src/ai-bid-analysis/utils/qualification.ts
// 资格/风险判定的纯函数：把「资质一致性冲突」+「★实质性条款未响应」+「concordance 计数」
// 三个输入合并成统一的资格结论。从 bidder.processor 抽出以便单测覆盖各组合。
export interface QualificationInput {
  /** 资质字段是否存在一致性冲突（concordance.checks 中 qualification=conflict） */
  qualConflict: boolean;
  /** 评分阶段产出的 ★实质性条款响应汇总；缺失视为无未响应 */
  starredResponse?: { allMet?: boolean; unmet?: string[] } | null;
  concordanceConflictCount: number;
  concordanceWarningCount: number;
}

export interface QualificationDecision {
  qualificationStatus: '通过' | '不通过' | '待审查';
  riskLevel: 'high' | 'medium' | 'low';
  /** 写入 overallComment 的自动附注；无未响应★条款时为 null */
  autoNote: string | null;
}

export function resolveQualification(input: QualificationInput): QualificationDecision {
  const unmet = input.starredResponse?.unmet ?? [];
  const hasUnmetStar = unmet.length > 0;
  const fail = input.qualConflict || hasUnmetStar;
  const qualificationStatus: QualificationDecision['qualificationStatus'] =
    fail ? '不通过' : '通过';
  const riskLevel: QualificationDecision['riskLevel'] =
    hasUnmetStar || input.concordanceConflictCount > 0
      ? 'high'
      : input.concordanceWarningCount > 0
        ? 'medium'
        : 'low';
  const autoNote = hasUnmetStar
    ? `[自动] 存在未响应的 ★实质性条款：${unmet.join('、')}`
    : null;
  return { qualificationStatus, riskLevel, autoNote };
}
