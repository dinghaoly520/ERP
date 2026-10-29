# 询比采购文件模板 v2（综合评分法 + 评分标准填写）设计

日期：2026-10-29 · 状态：已实施（模板修正+后端注入+前端六章制+编辑器+闸门+AI 生成全量落地，jest 62 用例与 dist 冒烟绿）

## 背景

用户提供新版《询比采购文件模板.docx》（`apps/api/模板文件/`，2026-10-29 替换，git 未提交），
结构与《竞价采购文件模板》同构（五章：采购邀请/供应商须知/评审程序和评定成交的标准/采购需求/
响应文件格式），占位符体系一致（响应保证金1-15、履约保证金1-9、合同分包1-3、联合体、监督×4、
{{报价表}} 等）。核心差异：**评审方法固定为综合评分法**（无 `{{评标方法1/2}}` 勾选占位符），
第三章「六、综合评分法评审标准」为 5 列空表待填。

现行询比编写（:3005 `/tender-write` INQUIRY_PURCHASE）面向旧版简单模板，仅 3 节、12 个字段，
无法驱动新模板。竞价（INTERNAL_BIDDING）已有完整 6 节 UI + 替换计划，可整体照搬。

## 用户裁定（2026-10-29）

1. 评分表填写控件 = **专用结构化编辑器**（非通用表格编辑器）
2. 范围 = **只做询比**；竞价评分表填写不做（后续单独）
3. 评分表为空时**导出前拦截提示**（前端闸门；后端宽容兜底）
4. **AI 生成评分标准一起做**（复用 `/api/ai/tender-field-generate`，Tab 分隔文本 + 前端解析）
5. 模板固定文案 4 处**全部修正为询比口径**（详见下）
6. 分值合计 ≠100 软提示不阻断；序号自动；v1 无单元格合并

## 模板固定文案修正（docx XML 手术，脚本一次完成）

| # | 位置 | 原文（关键段） | 改为 |
|---|------|--------------|------|
| 1 | 采购邀请首段 | 「采用**竞价方式**进行采购」 | 「采用**询比方式**进行采购」 |
| 2 | 前附表 16.1 确定成交人 | 「最低价中标；…业绩数量…二次报价…」（最低价法残留） | 「按评审得分由高到低顺序确定；得分相同的，按报价由低到高顺序确定；得分且报价相同的，由询比小组推荐成交候选人。」（与 8.2 对齐） |
| 3 | 18.1.1 | 「不再符合规定的**竞价采购方式**适用情形的」 | 「…**询比采购方式**…」 |
| 4 | 第五章 响应保证金保函格式 | 「（项目名称）**竞价采购**」「不按照**内部竞标（竞价）采购文件**要求…」×2 | 「询比采购」「询比采购文件」 |

修正后全文扫描「竞价/最低价/二次报价/业绩数量」零残留为验收线。占位符集合不变。

## 数据模型

```ts
// 前后端共用形态（web lib/types/tender-write.ts 与 api tender-write.types.ts 各自定义同构）
type ScoringItem = { id: string; factor: string; score: string; criteria: string; note: string };
// 评分因素 / 分值 / 评分标准 / 说明；序号导出时自动 1..N，不存草稿
```

- `InquiryPurchaseFieldKey` / `InquiryPurchaseDraft` 重写为竞价同款键：
  projectOverview、maxPrice、submissionRequirements(+Type)、qualificationRequirements、
  consortiumForm(+Type)、documentAcquireTime、documentPrice、responseSubmissionTime、
  bidOpeningPlace、contactAddress/Name/Phone/Email、supervision×4、
  responseDeposit×8（Type/Amount/Form/BankInfo/OtherForm/OtherRequirement/NonRefundType/NonRefundContent）、
  performanceDeposit×4、contractSubcontracting(+Type)、siteSurvey(+Type)、copyCount、
  businessRequirements、technicalRequirements、quotationLetter(+Type)
  **去掉** evaluationMethod（固定法）、evaluationCommitteeCount（模板无占位符，人数固定 3 人以上单数）
- 新增 `scoringItems?: ScoringItem[]`（非字符串字段，同 quotationLetterTable 模式：
  localStorage 草稿整体序列化、导出 answers 透传）
- API `InquiryPurchaseAnswers` 同步重写。存量 localStorage 询比草稿旧键自然失效（合并空默认，不报错）

## 前端（:3005）

- `INQUIRY_PURCHASE_SECTIONS` 重构为 6 节，镜像 `INTERNAL_BIDDING_SECTIONS`：
  封面 / 采购邀请 / 供应商须知 / **④评审程序和评定成交的标准** / 采购需求 / 响应文件格式
  （供应商须知节无「评标委员会人数」字段）
- 第④节：固定信息条「本项目评审方法：综合评分法」（不可选）+ 评分标准编辑器
- 新组件 `scoring-items-editor.tsx`：
  - 列 = 序号(自动) / 评分因素 / 分值(数字) / 评分标准(多行) / 说明；行增删、上移下移
  - 底部合计行自动求和（可解析数字分值，两位小数）；合计≠100 黄色提示不阻断
  - 「AI 生成」按钮 → `generateFieldContent`（fieldKey= scoringItems），prompt 产出
    Tab 分隔行（评分因素\t分值\t评分标准\t说明），前端解析入表（仿 parseQuotationTextToTable）
- `TenderFieldConfig` 增 `scoringItems?: boolean` 标记；`tender-section-editor.tsx` 仿
  quotationType 分支渲染；`page.tsx`/`tender-write-modal.tsx` 增 scoringItems 写入通路
- **导出闸门**（前端）：询比导出时有效评分行（评分因素或评分标准非空）为 0 → 弹窗阻止
- 预览 `InquiryPurchasePreview` 重写镜像 `InternalBiddingPreview`，第三章渲染固定方法 + 评分表
- 联动：`tender-write-modal.tsx` 询比 anchor 字段 bidOpeningTime→responseSubmissionTime；
  `prefill-from-project.ts` 询比映射键对齐；`import-autofill.prompt.ts` 询比字段清单更新
  （scoringItems 不入 AI 导入清单）

## 后端（apps/api/tender-write）

- `buildInquiryPurchaseReplacementPlan` 重写 = `buildInternalBiddingReplacementPlan` 照搬，
  去掉 评标方法1/2、评标委员会人数、`shouldDeleteComprehensiveScoringTable`（固定法无需删表）；
  新增评分表条目
- `TemplateReplacement` 增 `scoringRows?: ScoringRow[]`（factor/score/criteria/note）；
  `renderTemplateXml` 新分支 `fillScoringStandardTable(xml, headingRe, rows)`：
  1. 跨 run 拼接定位标题段（/六、\s*综合评分法评审标准/，手法同 deleteComprehensiveScoringTable）
  2. 定位其后、第四章前的 `<w:tbl>`
  3. 以模板自带空行为样板克隆生成 N 数据行（保模板列宽 841/1460/912/3973/1228、边框、字体）
  4. 合计行（跨列结构 [sp2 合计][分值][sp2]）分值格写入合计；合计行其余空格保持
  5. rows 为空 → 表格原样（后端宽容，前端闸门负责拦截）
- 询比导出文件名/模板路径不变

## 测试

- API 单测（tender-write.service.spec.ts 或新增 spec）：
  1. **占位符全覆盖**：解包新 docx 提取全部 `{{}}`，与 buildInquiryPurchaseReplacementPlan +
     tenantPlan 产出比对，零残留
  2. **评分表注入**：N 行注入后行数/序号/各列文本/合计正确；XML 可再解包校验；空 rows 不动表
- 前端 tsc + lint；编辑器/预览/导出人工冒烟

## 明确不做

- 竞价评分表填写（用户裁定后续单独做）
- 评分因素跨行合并（v1 无 merge，留待用户优化）
- 询比公告侧任何改动（公告模板与计划不受影响）
