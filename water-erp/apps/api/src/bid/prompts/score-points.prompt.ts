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
- fullScore 合计不要超过评分项满分 {{MAX_SCORE}}。
- 必须依据招标文件具体条款，不要臆造。
- evidenceHint 指明在投标文件何处定位证据。

## 输出格式（严格 JSON，不要 markdown 代码块）
{
  "items": [
    { "name": "得分点名称", "fullScore": 5, "evidenceHint": "评审要点", "objective": true }
  ]
}`;
