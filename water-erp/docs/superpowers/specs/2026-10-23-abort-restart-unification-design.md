# 流标收尾与重启采购统一流（开标前/中/后）设计

**日期**：2026-10-23
**状态**：已与用户逐节确认（§1–§3 均 yes）
**范围**：:3005 项目管理（PMI）流标后续流 + 后端 project-management / announcement 联动改造；:3007 仅现状衔接、不改动

---

## 1. 背景与现状

流标后 PMI 与投标侧的现状（2026-10-23 探查定稿）：

- **开标前流标**（:3005 开标确认面板底部按钮，`bid-confirm-panel.tsx:1336`）：确认弹窗（AI 预填原因）→ 流标公告向导（failed_bid）→ 发布（`announcement.service.ts:1207-1210` **发布联动 abortBidProject**）→ 前端自动 `reprocProject`（`announcement-publish-wizard.tsx:1252`）插入固定段「采购文件→开标评标」。
- **开标后流标**（`bid-confirm/abort-dialog.tsx`，B2 串联）：abort → 简版公告（type PLATFORM）→ 开标归档（scope=opening）→ 可选 C3 非招标成交登记。**不触发 reproc**。
- **评标中流标**（:3007 `dispute-block.tsx`）：仅 abortBidProject + 理由留痕，文案注明「须按法定程序公告」，公告留给 :3005。
- **PMI 终止联动**（`terminateProject`，:4046）：终止 PMI 时下游联动 BidProject 流标。
- 流标后 PMI 仍 ACTIVE，详情面板顶部有**流标提示条**（`project-detail-panel.tsx:1281`）「投标流程已流标 · 等待收尾」。
- 现有 `reproc`（`project-management.service.ts:633`）：固定插「采购文件→开标评标」段、CONTRACT 共享不删、旧轮开标评标/定标置 COMPLETED+流标备注、新轮首阶段激活。**不支持**选起点、改采购方式、删旧轮尾部。唯一真实调用方是向导（panel :15 的 import 为死引用，无 API 测试引用）。
- 多轮时间线基建已有：首轮采购/第 N 轮分组 +「流标重采」徽标 + 旧轮默认折叠（`project-stage-timeline.tsx:206`）。
- 锁定语义：`stageLocked = NOT_STARTED || isLockedByBid`（`project-detail-panel.tsx:488`）；已完成阶段目前仍可补传材料。

### 用户裁定（2026-10-23 逐条确认）

1. **流标公告先行**：流标必须先走流标公告编写+配置发布，再启动决策流。
2. **否（不继续）**= 复用现有终止：terminateProject → 已终止清单。
3. **是（继续）**：确认新建项目时的基本信息（供应商需求等），有更新则更新落库；**采购方式确认为最重点**。
4. 采购方式**全集可选**（不限制方向）；PMI.procurementMethod 更新为新方式，**项目卡片/标签等全部按新一轮方式显示**；第一轮 BidProject 保持旧方式不动。
5. 第二轮 = 新方式模板从所选起点截取到**模板末尾（含定标/合同/备案表）**；第一轮尾部（定标/合同/备案表）**删除**。
6. 第二轮起点激活、后续按正常阶段机推进（Q4-A）；第一轮**全部锁定只读**（含已完成阶段，关闭补传）。
7. 决策窗双入口：公告发布后自动弹 + 流标提示条常驻入口，**覆盖所有流标来源**。
8. **无论开标前/中/后，流标都必须发布公告，且公告发布与后续流程统一在 :3005 进行**。

## 2. 方案选型

采用**方案 A：原地改造 reproc 端点 + 新增决策向导组件**（已确认）。
备选 B（新端点双轨）因旧 reproc 唯一调用方即将移除、双轨维护成本高而否决；备选 C（前端串联分步调用）因非原子且反正要改后端而否决。

## 3. 总流程：三类流标统一收口 :3005

**统一主线**：流标（无论来源）→ :3005 发布流标公告（向导编写+配置+发布）→ 决策向导（是否继续）→ 重启 或 终止。

| 来源 | 公告 | 决策向导入口 |
|------|------|------------|
| ① 开标前 ：3005 流标按钮 | 确认弹窗 → 流标公告向导发布（发布联动 abort，现状保留） | 发布成功后**自动弹出** |
| ② 开标后 ：3005 AbortDialog | abort + 开标归档（B2 链保留；**删简版公告步骤**）→ done 态「发布流标公告」CTA → 向导发布 | CTA 发布后接决策向导；或流标提示条 |
| ③ 评标中 ：3007 异议裁决/通用流标 | :3007 只 abort+理由留痕（**现状不动**） | :3005 流标提示条「收尾处理」→ 公告闸拉向导补发 → 决策向导 |
| ④ PMI 终止联动流标 | —（终止下架公告） | 不适用（直接终止收尾） |

**公告闸（决策向导入口统一前置）**：无论「继续采购」还是「终止项目」分支，进入决策向导前检查当前轮是否已发布 FAILED_BID_NOTICE——无则先拉起流标公告向导，发布后自动进入决策向导。AbortDialog 简版公告（type PLATFORM）取消，避免双重公告。

**边界**：面板原有独立「项目终止」按钮（非流标语境的一般终止，如采购需求阶段）维持现状，不过公告闸。

## 4. 后端改造

### 4.1 `POST /project-management/:id/reproc` 原地改造

```ts
body: {
  startStageKey: 'PROCUREMENT_DEMAND' | 'INITIATION' | 'TENDER_DOCUMENT',  // 必填
  procurementMethod?: string,  // 不传 = 沿用当前方式；传入须 ∈ PROCUREMENT_METHODS 五种（谈判/竞价/直接/邀请招标/询比——与新建项目一致，METHOD_STAGE_TEMPLATES 全覆盖；「公开招标」仅投标侧旧清单，不属 PMI 可选集）
  basicInfo?: {                // 仅传有差异字段
    requesterName?, requesterDepartment?, procurementTitle?, procurementCategory?,
    budgetAmount?, projectReason?, supplierRequirements?, initiationDate?,
    procurementOrganizationForm?, isAnnualBudget?
  }
}
```

**事务前校验**：
- PMI=ACTIVE；写侧走 `PmiOwnershipGuard`（仅创建人）。
- **当前轮关联 BidProject 已终局且系流标**：stage=ABORTED，或 stage=ARCHIVED 且 riskNote 以「流标」开头（覆盖来源②开标归档后再重启）。
- startStage ∈ 三选；procurementMethod 合法。
- **删尾防御**：当前轮 `stageKey ∈ {AWARD_DECISION, CONTRACT, DIRECT_PURCHASE_FILING}` 的阶段若挂有附件 → 409 拒绝并提示（流标语义下不应有）。

**事务内步骤（单事务）**：
1. 更新 PMI basicInfo（仅差异字段）+ `procurementMethod`（有变更时）。
2. 删除当前轮尾部阶段（AWARD_DECISION / CONTRACT / DIRECT_PURCHASE_FILING，round=当前轮）——物理删除。
3. 当前轮 `BID_EVALUATION` 置 COMPLETED + note「已流标（重新采购）」。
4. 按（新）方式完整模板（`METHOD_STAGE_TEMPLATES`）**从 startStage 截取到模板末尾**插入 `round=当前轮+1`，stageOrder 紧接重排，stageCode 按 `stageCodeFor(projectCode, key, newRound)`。
5. 起点阶段置 IN_PROGRESS、其余 NOT_STARTED；`currentStage=startStage`、`currentRound+1`。

**保留**：既有幂等闸（新一轮未推进时拒绝重复开轮 REPROC_ALREADY_PENDING）与历史死锁自愈段。`REPROC_STAGE_SEGMENTS` 常量删除（被模板截取取代）。

### 4.2 PMI 详情响应加公告闸字段

`currentRoundFailedBidNoticePublished: boolean`——判定口径：类型 FAILED_BID_NOTICE + 关联本项目（relatedProjectCode）+ 属当前轮（发布时间晚于当前轮流标时点）。timeline.service 已有 FAILED_BID_NOTICE 查法可扩展。

> **落点偏差（2026-10-23 实施记录）**：实现改为 `GET :id/bid-project-refs` 逐轮返回 `failedBidNoticePublished`（每轮一行，判定=公告发布于该轮 BidProject 创建之后），未落在 PMI 详情响应上——复用面板既有 refs 逐轮轮询基建，且逐轮粒度比「仅当前轮」更通用（多轮展示直接可用）。终审补刀：查询限定已发布状态（PUBLISHED/ARCHIVED/OFFLINE），DRAFT 草稿不算。

### 4.3 公告发布联动加固

`announcement.service.ts:1207` 发布 FAILED_BID_NOTICE 联动 abortBidProject 前：BidProject 已 ARCHIVED/ABORTED → **跳过+日志**，不再 409（现状 ARCHIVED→ABORTED 撞单向棘轮终态守卫——来源②归档后补发公告必撞）。

## 5. 前端改造（apps/web/src/components/projects/）

### 5.1 新组件 `abort-restart-dialog.tsx`（决策向导，三步）

- **Step1 是否继续该项采购**：继续采购 / 终止（终止 → 唤起现有终止对话框，复用 panel terminateOpen）。
- **Step2 基本信息确认**：预填 PMI 当前值，可编辑字段与新建项目一致（申请人/部门/名称/品类/预算/事由/供应商需求/立项日期/组织形式/年度预算）；**项目归属只读展示**（独立关系，不进 basicInfo 白名单，变更走既有归属管理）；**采购方式独立强调区**（五种全集下拉，变更时高亮「第 N+1 轮将按新方式生成阶段」）。
- **Step3 重启起点**：采购需求/采购立项/采购文件三选 + 新轮阶段序列实时预览（新方式模板截取）+ 确认执行（调改造后 reproc）。
- 成功：关闭 + 刷新详情（时间线出现第 N+1 轮、指针指向起点）。

### 5.2 衔接改造

- **向导**（`announcement-publish-wizard.tsx:1252`）：failed_bid 发布成功后**移除自动 reproc**，改为回调打开决策向导（仅 failed_bid 分支；winning_bid 等复用路径不受影响）。
- **AbortDialog**：删简版公告步骤（保留 abort + 开标归档 + C3 非招标成交登记）；done 态加「发布流标公告」CTA。
- **流标提示条**：加「收尾处理」按钮（仅创建人）→ 公告闸 → 决策向导。
- **清理**：`project-detail-panel.tsx:15` 死 import `reprocProject` 移除。

## 6. 锁定与展示

- **新增轮次锁**：`stageLocked` 增加 `selectedStage.round < currentRound` 分支 → 旧轮全部只读（补传材料/编辑字段/AI 提取全关；查看与附件下载保留）。覆盖任意旧轮（三轮流标再重启泛化）。
- **新轮正常推进**：起点 IN_PROGRESS 可操作；后续 NOT_STARTED 锁定、前置完成后解锁（Q4-A）。
- **顺带修既有 bug**：`isLockedByBid`（:482）内 `stages.find(s => s.stageKey === stageKey)` 不带 round——多轮后命中第一轮行，改按 stageKey+round 查。
- 字段编辑/上传/AI 提取按钮已统一受 stageLocked 管，轮次锁自动生效。
- **时间线**：多轮分组/第 N 轮/流标重采徽标/旧轮折叠全复用现有基建；方式变更时新轮分组头加徽标「方式：X（原 Y）」。
- **卡片/列表**：取 PMI.procurementMethod，更新后自动显示新方式，无额外改动点。

## 7. 边界与错误处理

| 场景 | 处理 |
|------|------|
| 决策向导中途放弃 | BidProject 已 ABORTED、PMI 仍 ACTIVE——流标提示条状态，常驻入口可再入 |
| 重复点击/并发重启 | REPROC_ALREADY_PENDING 幂等闸 + 单事务；PmiOwnershipGuard 仅创建人 |
| 当前轮已有非招标成交登记（C3） | 决策向导入口提示「已转非招标成交，不宜重启采购」，仅留终止分支 |
| 尾部阶段意外挂附件 | 事务前防御校验 → 409 |
| round-2 后续建 BidProject | 走现有建项目路径，自然取 PMI 更新后的新方式/新信息 |
| round-2 再流标 | 同流程泛化 round N→N+1，旧轮全锁 |
| PMI 归档闸 | completeProject 的 BID_IN_PROGRESS 闸按新轮 BidProject 生效，无需改 |

## 8. 测试

- **API 单测**（project-management.service.spec.ts 扩展）：起点三档 × 方式变/不变 × basicInfo 更新的阶段序列断言；删尾与附件防御 409；旧轮流标终态标注；幂等闸；BidProject 未终局拒绝；ARCHIVED+riskNote 流标放行。
- **公告联动加固单测**：终态项目发布流标公告不 409、跳过+日志。
- **存量回归**：bid e2e 流标相关用例；isLockedByBid 轮次修复后面板行为；向导 winning_bid 复用路径不受影响。

## 9. 关键文件清单

| 文件 | 改动 |
|------|------|
| `apps/api/src/project-management/project-management.service.ts` | reproc 改造（:633）、删 REPROC_STAGE_SEGMENTS、详情加公告闸字段 |
| `apps/api/src/project-management/project-management.controller.ts` | reproc 入参 DTO |
| `apps/api/src/announcement/announcement.service.ts` | 发布联动终态跳过（:1207） |
| `apps/web/src/components/projects/abort-restart-dialog.tsx` | 新增决策向导 |
| `apps/web/src/components/projects/announcement-publish-wizard.tsx` | 移除 failed_bid 自动 reproc（:1252） |
| `apps/web/src/components/projects/bid-confirm/abort-dialog.tsx` | 删简版公告、加公告 CTA |
| `apps/web/src/components/projects/project-detail-panel.tsx` | 流标提示条入口、stageLocked 轮次锁、isLockedByBid round 修复、死 import 清理 |
| `apps/web/src/components/projects/project-stage-timeline.tsx` | 方式变更徽标 |
| `apps/web/src/lib/api/project-management.ts` | reprocProject 带参化 |
