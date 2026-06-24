// apps/api/src/ai-bid-analysis/prompts/score-criteria.prompt.ts
// 评分标准推断 prompt（ScoreCriteriaInfererService 用，方案 6.2 层②）
// 为管理员未填写细则的评分项，从招标文件推断评分标准

export const SCORE_CRITERIA_INFER_PROMPT = `你是资深评标专家。请为以下评分项推断评分细则（当管理员未填写时）。

## 待推断的评分项
{{SCORE_ITEMS}}

## 招标文件摘要
{{TENDER_TEXT}}

## 招标要求（LLM 已提取）
{{REQUIREMENTS}}

## 要求
- scoringCriteria：明确的评分标准（如何给分、扣分点）
- evidenceHint：投标文件中应定位的证据/响应点
- 依据招标文件的具体条款，不要臆造

## 输出格式（严格 JSON）
{
  "items": [
    {
      "scoreItemId": "评分项ID",
      "scoringCriteria": "评分细则",
      "evidenceHint": "评审要点（在标书何处找证据）"
    }
  ]
}`;
