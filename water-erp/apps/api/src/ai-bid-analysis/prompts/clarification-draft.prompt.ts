// apps/api/src/ai-bid-analysis/prompts/clarification-draft.prompt.ts
export const CLARIFICATION_DRAFT_PROMPT = `你是招投标澄清答疑专家。基于以下该供应商的 AI 分析结果，起草 3 条**针对该供应商**的澄清问题候选（中文，专家会改完再发，不是最终版）。

要求：
- 每条问题指向具体的弱点或未响应★实质性条款（不要泛泛而问）
- 简洁、可直接发给供应商理解
- 问题之间不重复，覆盖不同维度

输出 JSON：
{
  "drafts": ["问题1", "问题2", "问题3"],
  "basis": ["drafts[0] 依据的弱点/条款", "drafts[1] 依据", "drafts[2] 依据"]
}

AI 分析结果：
供应商：{{SUPPLIER_NAME}}
弱点（weaknesses）：
{{WEAKNESSES}}

未响应/部分响应的★实质性条款：
{{UNMET}}
`;
