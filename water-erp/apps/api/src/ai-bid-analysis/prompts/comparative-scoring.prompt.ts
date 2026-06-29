// apps/api/src/ai-bid-analysis/prompts/comparative-scoring.prompt.ts
// 方案3增强：动态维度横向校准（对齐全 5 维，不再只技术/商务/报价）
export const COMPARATIVE_SCORING_PROMPT = `你是一名资深招投标评审专家。现有多家投标单位参与同一项目竞标，请基于各家各维度的首轮评分与关键信息横向对比，做公平性校准。

维度（大写 key → 中文）：TECHNICAL=技术、BUSINESS=商务、PRICE=报价、QUALIFICATION=资格、RESPONSIVE=响应

评审原则：
1. 必须基于各投标单位首轮评分与提交内容横向对比，内容相同则分数相同
2. 对比中发现的真实差异必须在分数上体现
3. 多家在某维度表现相同则给相同分数
4. 严格评分，不得默认给高分
5. 校准分不得超过该维度首轮评分中标注的 max（满分）

以下是各投标单位各维度的首轮评分（score/max）与关键信息：

{{BIDDERS_DATA}}

请对每家投标单位逐一给出每个维度的校准分，输出 JSON：
{
  "scores": [
    {
      "bidderName": "投标单位名称",
      "scores": { "TECHNICAL": 数字, "BUSINESS": 数字, "PRICE": 数字, "QUALIFICATION": 数字, "RESPONSIVE": 数字 },
      "reason": "50字以内的校准理由"
    }
  ]
}`;
