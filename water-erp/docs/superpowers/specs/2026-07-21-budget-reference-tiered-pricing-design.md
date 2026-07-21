# 预算参考定价：置信分层估算（方法 C）

日期：2026-07-21　范围：`apps/api` 的 `analyze-budget-reference` + `apps/web` 新建项目浮层

## 背景与缺陷

旧算法用标题/品类检索“同类”历史项目，`weight = relevance²/Σ`，**锚点 = Σ weightᵢ × 历史总价ᵢ**，再 `× adjustmentFactor(夹紧 0.85–1.20)`。
缺陷：参考项只有总价，无数量/单位/规格；AI 相关度衡量“是否同类对象”，不衡量“规模/数量/规格是否相当”。于是“同类但 10 倍量”的项目被高权重拖进加权平均，**把规模差异当成了价格**；夹紧作用在因子上，救不了已坏的锚点。
关键事实：系统已有按单价、带规格/单位的干净数据（`CatalogItem.unit/specification/referencePrice/averagePrice/lastDealPrice/priceMin/priceMax/nationalStandard`、`BudgetItem.qty/unit/referencePrice/specification`），旧算法完全未用。

## 目标

在**单价层**归一 + **可比门控** + **规模护栏**，按数据质量分层给出结果；用区间+置信替代“假精确单点”；吃上现成的目录/预算行项目数据；对货物/服务/工程三类都不失效。

## 方法：置信分层（Tier 1–4）

入参扩展（向后兼容，全部可选）：`budgetListId?`、`lines?: {name, specification?, unit?, qty?}[]`、`procurementType?`。

- **行项目解析**：`lines` 显式 > 由 `budgetListId` 读 `BudgetItem` > 否则把 `procurementTitle` 当作“单行 qty=1”的隐式行（用于“整台设备/单项服务”的常见情形）。
- **目录匹配（纯确定性，v1 不调 LLM，保证可审计/可复现）**：对每行，归一化名称后在 `CatalogItem` 内按 `名称相等 → 互相包含` 检索，`category/unit` 作 tie-break 与校验。匹配质量 `exact | contained | none`。
- **Tier 1（高·点估计+窄带）**：所有行都匹配到目录。单价取 `referencePrice`；区间取 `[priceMin,priceMax]`（缺则 ref×[0.92,1.08]）；规格不一致只告警+降置信，不擅自改价；`lineTotal = unitPrice×qty` 求和。
- **Tier 2（中·点估计+较宽带）**：部分行仅能回退到 `BudgetItem.referencePrice`（无目录单价带）。
- **Tier 3（低·仅区间，无单点）**：无目录/预算单价时，用历史项目作**范围类比**：按 `procurementType/category` + 标题 token 重叠检索 `ProcurementProject.budget`，做**规模护栏**（剔除 <0.3× 或 >3× 中位数的离群），返回 `[min,max,median,count]`，**不给点估计**，UI 不显示“点击填入”。
- **Tier 4（拒绝估算）**：无任何可比数据 → 明确提示补数量/规格或选目录品。

横切护栏：规模比护栏剔除离群；规格因子每维度封顶（v1 仅告警不调价，避免编造）；点估计必须过可比门，否则降级到区间。

## 输出契约（向后兼容，仅新增字段）

保留 `hasReference/message/references/pricing{anchor,anchorPrice,adjustmentFactor,adjustments,clamped,weightedContractPrice,weightedBudgetPrice}/suggestedBudget/analysis/confidence/confidenceReason/statistics`。
新增：`tier:1|2|3|4`、`tierLabel`、`rangeLow?/rangeHigh?`、`lines?:[{name,unit,qty,match,catalogName?,specification?,unitPrice?,lineLow?,lineHigh?,lineTotal?,specWarning?}]`、`historicalBand?:{min,max,median,count}`。
语义修正：Tier 1/2 时 `suggestedBudget/pricing.suggestedBudget/pricing.anchorPrice` = 行项目求和点估计；`pricing.adjustments` 承载“规格告警/数量假设/参考-均价差”等可解释项；`references[]` 仍返回（目录匹配项 + 历史类比项，标 `source`），其 `contribution` 改为对该行/点估计的贡献。Tier 3 `suggestedBudget=null`，只填 `rangeLow/High`+`historicalBand`。

## 代码布局

- 新增 `apps/api/src/project-management/budget-reference-estimator.ts`：纯函数 + 一个接受 `PrismaService` 的 `estimateBudgetReference(prisma, input)`（目录/预算/历史查询 + 分层计算），便于单测。
- `project-management.service.ts` 新增 `analyzeBudgetReference(dto)`（当前缺失，补齐即恢复编译），委托给 estimator，附带 `analysis` 文案模板。
- 新增 `dto/analyze-budget-reference.dto.ts`（class-validator，`whitelist+transform` 兼容）。
- controller 改用 DTO 类。
- 前端 `lib/api/project-management.ts` 扩展类型；`create-project-dialog.tsx` 浮层渲染 tier 徽标 + 区间 + 置信，`点击填入` 仅 Tier 1/2；调用处透传 `lines`/`budgetListId`（有则传，无则标题兜底）。

## 测试与验证

- estimator 单测：规模护栏剔除 10× 离群；规格不一致降置信不改价；Tier 1/3/4 分支；空输入→Tier 4。
- 真实库（201 目录项 + BudgetItem）curl 验证：标题“AQMS-900 环境空气自动监测站”→Tier 1（185000×qty）；“大坝安全监测设备采购”→无整名匹配时落 Tier 3 历史区间（不再给出被 10× 项目污染的假单点）。
- Playwright（dev-only `?qa=` 种子，截图后删除）验证浮层：tier+区间展示、`点击填入` 在 Tier 3 隐藏、展开仍悬浮不顶布局。

## 非目标（v1 不做）

- LLM 从自由文本抽行项目+数量（v1 用“标题=单行 qty=1”+显式 lines 兜底；后续可加，作为 Tier 1 覆盖率的提升，非正确性依赖）。
- 历史项目的行项目级单价归一（种子历史项目无行项目，留待数据具备后启用 Tier 2 的历史分支）。
