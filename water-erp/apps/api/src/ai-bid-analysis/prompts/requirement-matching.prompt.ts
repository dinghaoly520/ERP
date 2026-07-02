// requirement-matching.prompt.ts
export const REQUIREMENT_MATCHING_PROMPT = `你是招投标响应核查专家。下面给出【招标要求条目】（每条带 seq 序号）与【投标文件分页文本】。
对每条招标要求，在投标文件中定位其响应内容，判定响应状态并摘录证据。

## 招标要求条目（JSON，含 seq 序号）
{{REQUIREMENTS}}

## 投标文件分页文本（每页含 file 标识与 page 页码）
{{PAGES}}

## 任务
逐条输出 responses 数组，每项：
- seq：对应招标要求条目的 seq（原样回填小整数，勿臆造或改写）
- status：met（满足）/ partial（部分满足）/ unmet（不满足）/ not_found（投标文件未提及）
- excerpt：投标文件中支撑判定的原文摘录（≤120 字，not_found 时为空串）
- file：摘录所在文件标识（technical/business，not_found 时为 null）
- page：摘录所在页码（数字，not_found 时为 null）
- confidence：0-1

## 规则
1. 仅依据投标文件文本判定，不得臆造。
2. excerpt 必须是投标文件原文片段，不可改写。
3. ★号实质性条款若未明确响应，判 unmet 或 not_found，不得默认 met。
4. seq 必须原样回填输入条目的序号（小整数）。
5. 输出严格 JSON：{ "responses": [ { seq, status, excerpt, file, page, confidence } ] }`;
