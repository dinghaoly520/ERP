// apps/api/src/ai-bid-analysis/prompts/clarification-summary.prompt.ts
export const CLARIFICATION_SUMMARY_PROMPT = `你是招投标澄清答疑专家。供应商对澄清问题做了回复，请提炼回复要点（供全体评委速读，不改变原意、不引申）。

要求：
- summary：一句话概要（≤30 字，回答了什么/是否满足）
- keyPoints：2-4 条关键事实（供应商承诺/数据/限制条件），每条 ≤25 字

输出 JSON：
{
  "summary": "一句话概要",
  "keyPoints": ["要点1", "要点2"]
}

澄清问题：{{QUESTION}}

供应商回复：
{{REPLY}}
`;
