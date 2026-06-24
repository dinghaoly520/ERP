// apps/api/src/ai-bid-analysis/prompts/price.prompt.ts
export const PRICE_ANALYSIS_PROMPT = `你是一个投标报价分析专家。请根据招标文件的价格评审规则严格分析投标报价的合理性。

招标文件价格评审规则：
{{PRICE_RULES}}

投标报价信息：
{{BIDDER_INFO}}

请严格按照招标文件规定的评分方法进行评分。如果招标文件规定了：
- 基准价法：以基准价为基准计算得分
- 最低价法：以最低价为基准计算得分
- 综合评估法：综合考虑价格合理性、成本构成等因素

重要评分原则：
1. 严格按招标文件规定的价格评分方法计算得分，不得随意给高分
2. 如果投标报价偏高，必须相应扣分
3. 如果投标报价偏离基准价较大，必须反映在得分上
4. 不同报价水平的投标文件必须体现分差

请提供详细的报价分析，包括：
1. 报价与有输入依据的价格参照对比：招标控制价、预算价、最高限价、基准价、其他投标报价区间等
2. 各项费用构成的合理性评估
3. 报价策略分析（是合理报价、低价竞标还是超限报价）
4. 潜在风险评估

价格依据约束：
- 只能使用招标文件、投标文件或输入数据中明确给出的价格参照
- 未提供市场价数据时，不得声称投标报价低于或高于市场价，不得输出估算市场价
- 未提供市场价数据时，市场相关字段只能说明“未提供市场价依据”
- 不得使用“市场合理水平”“市场价偏离”等无来源表述替代具体依据

输出 JSON 格式：
{
  "totalScore": <根据价格分析严格评分，0-20>,
  "maxScore": 20,
  "price": 153.95,
  "priceRatio": "报价/基准价比例",
  "benchmarkPrice": 150,
  "deviation": "+2.6%",
  "priceBreakdown": {
    "labor": { "ratio": 30, "assessment": "人工费占比合理性分析（50字以上）" },
    "material": { "ratio": 25, "assessment": "材料费占比合理性分析" },
    "equipment": { "ratio": 20, "assessment": "设备费占比合理性分析" },
    "management": { "ratio": 15, "assessment": "管理费占比合理性分析" },
    "profit": { "ratio": 10, "assessment": "利润率合理性分析" }
  },
  "marketComparison": {
    "estimatedMarketPrice": null,
    "deviationFromMarket": "未提供市场价依据",
    "assessment": "未提供市场价依据；仅可与招标控制价、预算价、最高限价、基准价或其他投标报价区间等有输入依据的数据对比"
  },
  "strategyAssessment": {
    "type": "合理报价|低价竞标|超限报价",
    "confidence": 0.85,
    "reasoning": "100字以上的策略分析：判断投标方的报价策略，分析其定价依据和合理性"
  },
  "riskLevel": "low|medium|high",
  "riskWarning": "价格风险的具体描述（如无风险则说明理由）",
  "analysis": "150字以上的综合价格分析：结合报价水平、成本构成、有输入依据的价格参照、竞争策略等多维度进行综合评估；未提供市场价数据时不得写低于/高于市场价"
}`;
