# 供应商要求·库内闭环设计（硬性条件核验 ↔ 推荐证据化）

日期：2026-11-04
状态：已批准（用户逐项裁定）

## 背景与问题

:3005 供应商智能选取向导（`/supplier/selection`）步骤 1「供应商要求」为五段文书体自由文本（项目概况/经营范围/资质/业绩/其他），AI 依据项目文件生成后喂给 `POST /ai/supplier-selection` 做候选池检索 + LLM 排序。问题：

1. **生成侧闭门造车**：AI 生成时不知道库内资质词表/行业分布/业绩数据，产出「ISO 9001 认证」「近三年≥2项同类业绩」等库内无法核验的表述（库内资质名自由文本、业绩表全库 0 条）。
2. **推荐侧证据不足**：喂给 LLM 的候选行只有名称/分类/经营范围截 90 字/6 标签/资质名截 60 字/评价等级/在建数；`SupplierPerformance`、`Supplier.industry`、资质有效期、惩戒记录、注册资本均未进入。
3. **段落错位**：自由文本生成连格式约束都不稳（交付/质保条款落进【业绩要求】段）。

## 用户裁定（2026-11-04）

| 决策点 | 裁定 |
|--------|------|
| 闭环范围 | **两侧都要**：生成时只从库内词表选 + 推荐时逐项核验展示 |
| 要求侧形态 | **硬性筛选条件（词表化）+ 五段软性文本保留** |
| 过滤语义 | **三态核验**：满足 / 不满足（剔除）/ 资料缺失（保留标黄，人工判断） |
| 资质核验机制 | **标准字典 + 规则匹配**（同义关键词包含；不上 LLM 兜底） |
| 治理闭环（缺失→提醒补录） | **不进本期** |

## 目标与非目标

**目标**：
- 要求侧：新增「硬性筛选条件」区（行业/资质/业绩/评价等级），选项全部来自库内真实词表与内置字典，AI 预填只能从词表选。
- 推荐侧：规则层逐项三态核验，「必须」级 FAIL 剔除、MISSING 保留标黄；LLM 候选行补齐库内证据；推荐卡展示核验矩阵与被剔除名单。

**非目标**：资料缺失→提醒补录治理；存量资质数据清洗；供应商门户录入改造；推荐结果落库审计。

## 词表与字典

| 维度 | 来源 | 说明 |
|------|------|------|
| 行业 | 库内聚合（复用 `supplier.service.industryBuckets()` 逻辑，公司视野 APPROVED） | 26 个标准值（495/496 覆盖），chips 带家数徽标 |
| 资质 | 内置代码常量 `QUALIFICATION_DICTIONARY`（首批 ~20 项）| 每项 `{ key, label, category, keywords[] }`；keywords 含同义变体（`iso9001`/`iso 9001`/`质量管理体系认证` 等）；**不建 DB 表，加项=改代码** |
| 评价等级 | A/B/C/D/E 序数比较 | 最新一条 `SupplierEvaluation.finalGrade` |
| 业绩 | 近 N 年 ≥ M 项 + 自由关键词 | 匹配 `SupplierPerformance`（recordType=performance，projectName/description contains）；**库内 0 条，框架就位、空白期恒 MISSING** |

字典首批项（实现时可增补）：ISO9001 质量管理体系、ISO14001 环境管理体系、ISO45001 职业健康安全、高新技术企业、安全生产许可证、特种设备生产/制造许可证、CCC 强制认证、建筑工程施工总承包资质、工程勘察资质、工程设计资质、测绘资质、地质灾害防治单位资质、水利水电工程施工资质、电力设施承装（修试）许可、软件企业认定、AAA 信用等级、检验检测机构资质认定（CMA）、实验室认可（CNAS）、监理资质、造船/军工等专项许可（按需）。

## 要求侧 UI（:3005 向导步骤 1）

「供应商要求」卡上半部新增「硬性筛选条件」区，四行（全部可空=不限）：

- **行业**：多选 chips（词表=库内行业+家数徽标）
- **资质**：多选 chips（字典项）+ 每项 `必须▾/优先▾` 级别
- **业绩**：近 `[N]` 年 ≥ `[M]` 项 + 关键词（可空）
- **评价等级**：`≥A / ≥B / ≥C / 不限`

**AI 预填**：新端点 `POST /ai/suggest-hard-conditions`（入参 projectContext，仿 `suggest-tags` 先例）——LLM 只能从词表/字典里选，选不出留空；与「AI 按项目文件生成」按钮合并为一次交互，同时填硬性条件与五段文本。

五段自由文本原样保留（软性描述：LLM 语义排序 + 对外文书）。

## API 契约扩展

`POST /ai/supplier-selection` 请求体新增（全可空，**不传=现状行为，老调用零破坏**）：

```ts
hardConditions?: {
  industries?: string[];                                  // 库内行业值
  qualifications?: { key: string; required: boolean }[];  // 字典 key
  performance?: { years?: number; minCount?: number; keywords?: string[] };
  minGrade?: 'A' | 'B' | 'C';
}
```

响应新增：

- `conditionsCheck`: 每家推荐供应商 `{ supplierId, checks: [{ type: 'industry'|'qualification'|'performance'|'grade', label, status: 'PASS'|'FAIL'|'MISSING', detail }] }[]`
- `filteredOut`: 被剔除名单 `{ supplierId, name, failedCondition }[]`（含家数统计），供人工复核误杀

## 核验引擎（`ai.service` 检索阶段）

候选池查询 include 补齐：`industry`、qualifications 全量（name/type/validTo/status）、performances（recordType=performance）、penalties 计数。

三态判定矩阵：

| 条件 | PASS | FAIL | MISSING |
|------|------|------|---------|
| 行业 | industry 命中任一选项 | 未命中 | industry 为空 |
| 资质（每字典项） | keywords 任一包含命中任一资质名且有效期内 | 仅命中已过期记录 | 无任何命中 |
| 业绩 | 年限窗内满足关键词的记录 ≥ M | 有记录但不足 | 0 条记录 |
| 评价 | 最新等级 ≥ 阈值 | 低于阈值 | 无评价记录 |

细则：
- 资质有效期判定：`validTo` 空=长期有效；非空且 > now=有效。
- 业绩年限窗：`signDate`（空则 `createdAt`）≥ now - N 年；无 `years` 时不限窗。`minCount` 空时不做数量判定（有记录即 PASS）；`keywords` 空时不做关键词过滤。
- **剔除规则**：行业/评价/业绩条件为单值语义（设了即必须）；资质按项级别——「必须」FAIL 剔除、「优先」仅展示。任一必须级 FAIL → 进 `filteredOut`；MISSING 一律保留标黄。
- 通过者进现有 composite 评分 + LLM 排序，主流程不动。

## LLM 排序增强（`supplier-selection-ai.service` 候选行）

候选行在现有字段基础上扩充：**行业**、**资质全名列表**（top8，替代 60 字截断）、**业绩摘要**（年限窗内条数 + 代表项目名 2 个；空明示「库内无业绩记录」）、**惩戒 N 条**、**注册资本**。

system prompt 增补：结合硬性条件核验结果择优；库内无业绩记录者不得虚构口碑。

## 推荐结果展示（步骤 2）

- 推荐卡 AI 理由下方加核验小矩阵：✓绿（PASS）/ ○黄（MISSING，悬停「库内未见该资料，请人工核实」）/ 优先项灰✓
- 摘要卡候选池统计加「硬性条件剔除 N 家（查看）」，展开 `filteredOut` 名单 + 未满足项

## 测试

- 核验引擎单测：三态全分支矩阵（行业命中/未命中/空、资质命中/过期/缺失、业绩满足/不足/无记录、评价有/无/低）
- 字典关键词变体匹配单测（`iso9001`/`ISO 9001`/`质量管理体系认证`）
- `recommendSuppliers` 带 `hardConditions`：过滤生效 + `filteredOut` 返回 + 不传时行为不变
- 前端向导无测试基建，手工验收

## 兼容与演进

- `hardConditions` 不传=与现状完全一致；`suggest-hard-conditions` 独立新端点不动现有 polish 链路。
- 业绩核验数据空白期恒 MISSING，后续资料治理（非本期）后自动生效。
