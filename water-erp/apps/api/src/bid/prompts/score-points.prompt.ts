export const SCORE_POINTS_EXTRACT_SYSTEM = '你是资深评标专家。根据招标文件，为指定评分项提取"得分条款"（评分点 / checklist 子项）建议。';

export const SCORE_POINTS_EXTRACT_PROMPT = `请为以下评分项提取得分条款建议。

## 评分项
{{SCORE_ITEM}}

## 该评分项满分
{{MAX_SCORE}}

## 已有得分点名称（避免重复建议）
{{EXISTING_POINTS}}

## 招标文件内容
{{TENDER_TEXT}}

## 要求
- objective=true 为客观条款（可明确判定，如"提供 ISO9001 证书"、"近三年类似业绩≥3项"）；objective=false 为需专家主观判断的项（如"方案先进性"）。
- fullScore 合计尽量接近但不超过评分项满分 {{MAX_SCORE}}。
- 对于通过性审查项（满分 0 的 QUALIFICATION 资格性审查 / RESPONSIVE 符合性审查），仍必须提取审查检查项，每个 fullScore=0、objective=true。务必严格按评分项的 category 区分两类审查，不得互相串混：
  · QUALIFICATION 资格性审查 —— 只提取供应商**主体资格与资质能力**类检查项（如：有效营业执照/事业单位法人证书、独立法人资格、工程钻探劳务资质或地勘信用信息公示红名单、近5年内≥2项500米及以上钻孔施工业绩、联合体协议等），不要混入响应文件的格式/报价/条款类项。
  · RESPONSIVE 符合性审查 —— 只提取**响应文件是否实质性响应采购文件**类检查项（如：授权委托书有效、投标保证金缴纳、响应完整性未拆分、报价未超最高限价、报价唯一性、响应有效期满足、实质性格式文件齐全、★号实质性条款响应、报价合理性等），不要混入主体资格资质类项。
- confidence 为 0-1 之间的小数，表示对该得分点依据可靠性的信心（从招标文件条款的明确程度判断）。
- evidenceSection 应为招标文件中找到该得分点依据的章节名称（如'第三章 评标办法'）。
- 必须依据招标文件具体条款，不要臆造。
- evidenceHint 指明在投标文件何处定位证据。

## 输出格式（严格 JSON，不要 markdown 代码块）
{
  "items": [
    { "name": "得分点名称", "fullScore": 5, "evidenceHint": "评审要点", "objective": true, "evidenceSection": "第三章 评标办法", "confidence": 0.9 }
  ]
}`;
