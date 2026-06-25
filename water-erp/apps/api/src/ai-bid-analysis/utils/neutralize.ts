/**
 * neutralizeRecommendationText — AI 评语中性化（方案 6.6）
 *
 * ERP 是"AI 辅助参考"，不是"AI 决策结果"。
 * 移除"推荐中标""第一候选人"等终判性话术，替换为中性表述。
 */
export function neutralizeRecommendationText(text?: string | null): string | null | undefined {
  if (!text) return text;

  return text
    .replace(
      /建议推荐为第?一?中标候选人[，。]?/g,
      '当前结果仅作为评分分析参考，候选排序需以人工评审结果为准。',
    )
    .replace(
      /建议推荐为中标候选人[，。]?/g,
      '当前结果仅作为评分分析参考，是否进入候选排序需以人工评审结果为准。',
    )
    .replace(/推荐为第?一?中标候选人[，。]?/g, '候选排序需以人工评审结果为准。')
    .replace(/推荐为中标候选人[，。]?/g, '是否进入候选排序需以人工评审结果为准。')
    .replace(/第一中标候选人/g, '当前综合评分排序第 1')
    .replace(/中标候选人/g, '候选排序对象')
    .replace(/履约能力强/g, '履约能力相关材料需结合投标文件复核')
    .replace(/履约风险低/g, '当前未识别到结构化高风险因素');
}
