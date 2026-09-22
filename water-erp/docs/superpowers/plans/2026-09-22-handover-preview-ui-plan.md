# P2-3 遗留项：:3005 评标回流包内容查验视图（UI）实施计划

> **状态**：待执行（2026-09-22 归档链路整改的唯二遗留 UI 项；开工前先读本文 + 审查报告 P2-3）
> **来源**：`docs/开评标归档链路完备性审查-归档包回流包-2026-09-22.md` 第五节 P2-3（整改记录表标 ⏸ 另开任务）
> **核查**：本文所有字段/路径/端点均已对照实际代码与 2026-09-22 生成的真实回流包核验（见「事实基础」节）。

**Goal**：:3005 评标资料接收区块增加只读结构化预览——归档人员核卷不再下载 JSON 人工看。

**Tech Stack**：Next.js 16 App Router + React 19 + Tailwind v4；cgzxui 设计体系（强制，技能 `cgzxui`）；纯前端解析，**后端零改动**。

---

## 事实基础（2026-09-22 实测核查，防实现时再猜）

### 1. 数据源与获取路径
- 回流包下载地址已由现有 API 下发：`getSignPacket()`（`apps/web/src/lib/api/bid.ts:681`）返回 `SignPacketResponse`，其中 `packet.handoverDownloadUrl = /api/upload/files/{fileAssetId}`（`bid.ts:674`）。
- :3005 的 `/api` 前缀经 `src/proxy.ts`（Next 16 middleware，非 rewrites）显式 fetch + Cookie/Header 全量透传到 :4001——**页面内 `fetch(handoverDownloadUrl)` 同源可达**，鉴权随 cookie 自动带。
- 坑（memory `guarded-download-no-noreferrer`）：`<a target=_blank>` 下载别加 `rel="noreferrer"`（丢 Referer → portal 识别 401）；现有横幅用 `rel="noopener"` ✓，预览的 fetch 不受影响。

### 2. 落点组件
- `apps/web/src/components/projects/bid-confirm/evaluation-handover-block.tsx`：现有「评标资料接收」区块（30s 轮询 `getSignPacket`，横幅+下载链接+中标候选人表）。预览入口放本区块：横幅下加「查验内容」展开按钮，条件 `signData?.packet?.handoverFileAssetId`（与横幅同门槛）。
- 父面板 `bid-confirm-panel.tsx` 已把 `detail` 传入本组件，无需改 props 链。

### 3. 回流包真实结构（15 个顶级键，来自 2026-09-22 演示项目实际包）

```
packageType/packageVersion/projectId/generatedAt
evaluationSnapshot  —— 内嵌评标完整性包 v2：expertConfirmations / scoreRecords /
                       scoreHistory / pointDecisions / scoreItemDefinitions / fingerprint
evaluationResults   —— 排名：supplierName/totalScore/averageScore/rank/recommended/
                       disqualified/bidPrice/generatedAt（元口径）
signPacket          —— 签字包引用：fileAssetId/sha256/generatedAt/signPageScanFileId/closedAt
expertSignStatuses  —— 21 字段/人：expertName/expertRole/signStatus(+At)/signScanFileId/
                       dissentingOpinion/dissentingReason/esignature(剥壳摘要)(+At) +
                       身份核验域：signedIn/signInIp/signInMeta/confidentialityAgreed(+At)/
                       disciplineAgreed(+At)/aiConsentConfirmed(+At)/avoidanceConfirmed/
                       conflictedSupplierIds
expertMemos         —— 备忘：expertName/supplierName/scoreItem(Id+Name)/scorePoint(Id+Name)/
                       contentText/sourceDevice/createdAt/ink{fileAssetId,key,sha256}
requirementReviews  —— 条款裁定：expertName/supplierName/requirementId/category/verdict/note/createdAt
aiAnalysis          —— status/aiProvenance/requirements/bidders[]/report（report 含 docx/pdf 引用）
supervisionLogs     —— 全周期监督日志（实测 47 条）：time/role/action/target/result/riskFlag
disputes            —— 异议工单：含 resolvedBy/resolvedAt 裁决留痕
motions             —— 动议：votes[] 带 expertName+reason
clarifications      —— 澄清：replyChannel/replySignature/replyAttachmentIds/A-143 证据链
```

- 演示包实况（空态设计参照）：`expertMemos/disputes/motions/requirementReviews/clarifications` 为空数组、`supervisionLogs` 47 条、`expertSignStatuses` 10 人（含候补）、`evaluationSnapshot.scoreHistory` 空数组。

### 4. 设计约束
- cgzxui：`@water-erp/ui` 共享组件（`SectionCard`/`StatusBadge`/`DataToolbar` 等）+ neumorphic 规范；禁止 flat box-shadow / 渐变按钮 / emoji 图标（`.impeccable.md`）。
- 真实数据无 mock fallback：加载/空态/错误态三态齐全（拉包失败显错误横幅不吞）。
- 只读：预览不得提供任何写操作入口。

---

## 建议实现（新会话开工时按此展开，先走 brainstorming 确认细节）

**文件**：
- 新建 `apps/web/src/components/projects/bid-confirm/handover-preview.tsx`（预览主体，懒加载 fetch + 分段折叠）
- 修改 `evaluation-handover-block.tsx`（加「查验内容」展开入口）

**分段展示（从上到下）**：
1. **概要**：packageVersion / generatedAt / signPacket.closedAt（签字闭环时间）/ evaluationResults 排名表（复用现有候选人表样式）
2. **签字与身份核验**（expertSignStatuses 正选在前）：signStatus 徽章 + 不同意见（红字）+ 身份核验域勾选矩阵 + signInIp；候补折叠
3. **评分快照**（evaluationSnapshot）：专家确认进度 + scoreItemDefinitions 列表 + 「逐专家×供应商」矩阵（scoreRecords 聚合，避免全量平铺）；scoreHistory/pointDecisions 非空才显
4. **澄清/异议/动议**：三段 Tab 或折叠；各段空态文案「本项目无…」
5. **专家备忘**：卡片流（专家/供应商/评分项定位 + contentText）；ink 引用只显 sha256 前 12 位（不可内嵌字节）
6. **AI 辅助**：aiProvenance 摘要 + 每家 bidders 风险/得分徽章；report 折叠；docx/pdf 引用显文件名+指纹（点击下载走 upload 端点）
7. **监督日志**：末段默认折叠，表格（47 条量大）；riskFlag 非「无」高亮

**交互**：外层「查验内容」按钮切换展开（默认收起）；包 JSON 较大（演示包 ~220KB）——fetch 在首次展开时才发起并缓存于组件 state；提供「下载原始 JSON」次级入口（沿用 handoverDownloadUrl）。

**验证**：
- 演示项目 JJ-2026091003 现成回流包（`handoverFileAssetId` 已就绪，:3005 `projects?projectId=cmtvdx881002xuu2ceb27yesk&panel=bid-confirm` 深链直达——**勿漏参误判**，memory `procurement-web-3005-audit`）
- 空态用旧包或临时清空 mock 不可取——用 JJ 包的真实空段（memos/disputes 等）直接核空态文案
- 浏览器实测 + `pnpm --filter web lint` + cgzxui 红牌闸（`--ci`）

## 开工提醒

1. **并行会话避让**：另一会话正做 :3005 页面审计（第三轮=管理端 8 页）——开工前 `git status` 确认对方工作区干净再动 `apps/web`。
2. 本计划只做 P2-3；若顺带想补「签字扫描件上传演示数据」「评分修订轨迹」属演示准备事项，不在本 UI 范围。
