// apps/api/src/ai-bid-analysis/prompts/item-scoring.prompt.ts
// per-item 评分 prompt（GenericItemScorerService 用，方案 6.3）
// 替代 procurement 的固定 breakdown（technical/commercial/price）prompt

export const ITEM_SCORING_PROMPT = `你是资深评标专家。请按评分标准对以下每个评分项独立评分。

## 评分项（逐项评分，对齐 BidScoreItem）
{{SCORE_ITEMS}}

## 投标单位信息（标书 LLM 提取）
{{BIDDER_INFO}}

## 招标要求
{{REQUIREMENTS}}

## 评分规则
- 每项 score 不得超过对应的 maxScore
- 基于 evidenceHint 与投标单位信息定位证据，给出评分理由
- 符合性审查项（maxScore=0）输出 pass（true/false），score 填 0
- confidence 为本次评分的可信度（0-1）

## 输出格式（严格 JSON）
{
  "items": [
    {
      "scoreItemId": "评分项ID",
      "score": 数字,
      "pass": true或false（仅符合性项必填，其他可省）,
      "reason": "评分理由",
      "evidence": "标书中的证据定位",
      "confidence": 0-1
    }
  ],
  "overallComment": "整体评价（一句话）"
}`;
