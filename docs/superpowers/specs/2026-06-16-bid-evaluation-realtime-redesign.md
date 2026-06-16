# 开评标实时协作重设计 — 产品设计规格

**Date:** 2026-06-16
**Status:** Approved (architecture), Phase 0 implementation pending
**North Star:** 协作与透明度 (Collaboration & Transparency) — primary
**Supporting:** 可靠性与信任 (Reliability/Trust) + 效率与流程 (Efficiency/Flow)

---

## 1. 产品愿景

将「专家评分平台」(expert-portal :3006) 与「在线开评标系统」(bid-portal :3007) 从两个**孤立的、静默的、半功能**的工具，改造为一个**实时、透明、可信**的协作系统。

### 核心原则

1. **透明度优先 (C, north star)** — 每个人都知道流程在哪、刚发生了什么、自己在等谁。但透明有法律边界。
2. **建立在信任之上 (A, foundation)** — 政府采购系统，数据完整性不容妥协。评分不丢、归档可验、错误可见。
3. **效率服务流程 (B, supporting)** — 更少的点击、键盘可达的评分、不打断心流的交互。

### 透明度边界 (Option 2 — 已确认)

《招标投标法》要求评标专家**独立评审**。因此：

- **可共享（流程透明）:** 阶段状态、里程碑级在场状态（签到/回避/进度%/报告确认，不含分数）、事件流（解密、澄清、异常）、连接状态。
- **密封（法律独立）:** 专家之间的评分可见性、评分理由、评审中的实时分数共识。分数仅在报告汇总阶段后、且仅对 host/admin 可见。

这导致两种截然不同的视图：
- **专家侧 (expert-portal):** 丰富的流程 + **聚合**在场状态（"3/5 已签到，平均进度 60%"）—— 知道房间状态，不知道任何个人的分数或节奏压力。
- **主持/管理侧 (bid-portal):** **完整**透明 —— 个体的在场、所有分数、所有事件。这是指挥中心。

---

## 2. 跨系统现状审计 (基线)

### P0 — 数据完整性缺陷（破坏信任）

| ID | 问题 | 位置 | 影响 |
|----|------|------|------|
| P0-1 | 评分状态扁平化 — `scores` 仅按 `scoreItemId` 索引，非 `(supplierId, scoreItemId)` | expert-portal `evaluate/[id]:298+` | 切换供应商时显示的分数不变，专家可能在不知情下把供应商 A 的分覆盖到 B 的数据上 |
| P0-2 | 评分理由标注"必填"但从未校验 | `evaluate/[id]:96-116` | 空理由可提交，审计追溯的"为什么"形同虚设 |
| P0-3 | 无草稿保存 — 唯一持久化是整供应商提交 | `evaluate/[id]` 全文 | 刷新/导航丢失数十分钟细致评分 |
| P0-4 | 归档哈希链造假 — `HASH-CHAIN-{code}-{Date.now()}` | bid-portal `archive:111` | 每次渲染重新生成；"防篡改"页面提供可预测的时间戳字符串 |
| P0-5 | 登录页硬编码演示凭证 | expert-portal `login TAB_DEFAULTS` | 生产环境安全漏洞 |
| P0-6 | 错误被静默吞掉 — `.catch(() => {})` 遍布 | 所有页面 | 拉取失败显示为"暂无数据"，无法与真无数据区分 |

### P1 — 缺失核心能力（门户半功能）

| ID | 缺失 | 受影响门户 |
|----|------|-----------|
| P1-1 | expert-portal 无实时更新（无 WebSocket） | expert-portal |
| P1-2 | 专家侧无澄清问答（仅计数徽章，无阅读/发布页） | expert-portal |
| P1-3 | 回避是单一"确认"按钮，无逐供应商冲突声明 | expert-portal |
| P1-4 | 无步骤门控 — 向导标签可自由跳转，可跳过签到直接评分 | expert-portal |
| P1-5 | 澄清单向 — bid-portal 可创建但无法回复，线程单边 | bid-portal |
| P1-6 | 监督异常被动 — 只能看，无法标记/升级/批注 | bid-portal |
| P1-7 | 全系统无分页/虚拟化 | 双门户 |

### P2 — 体验与一致性

| ID | 缺口 |
|----|------|
| P2-1 | 4 个未重构 bid-portal 页面设计系统碎片化（裸 `oklch()`、内联 fontFamily、临时表格标记） |
| P2-2 | 无全局连接/状态指示器 — WebSocket 静默断开，轮询是唯一后备 |
| P2-3 | 无专家协作感知 — 专家不知谁在场、谁完成到哪 |
| P2-4 | 评分缺键盘可达性（无 ARIA、无 Tab 流） |
| P2-5 | 无重试/错误边界 — 网络闪断=手动刷新 |

---

## 3. 分阶段路线图

依赖有序，每阶段独立可交付。C（协作/透明）是北极星，但建在 A（信任）与 B（效率）之上。

### Phase 0 · 可信底座 (Reliability) — A 基础, ~2-3 天

修复 P0-1 ~ P0-6。在数据不可信之上无法构建协作。

- **P0-1 评分状态重构:** `scores` Map 改为以 `${supplierId}:${scoreItemId}` 复合键索引；切换供应商下拉时正确显示该供应商已存评分；提交时从当前 `activeSupplier` 取对应切片。
- **P0-2 理由校验:** 提交前校验所有已打分项的理由非空（针对分数 < 满分的项强制要求理由，满分项可豁免）；空理由时高亮该项 + 阻止提交 + 明确提示哪一项缺理由。
- **P0-3 草稿自动保存:** debounced（2s）autosave 到 `localStorage`（键含 `projectId:expertId`）+ 显式"保存草稿"按钮；页面加载时若有未提交草稿则提示恢复；提交成功后清除草稿。
- **P0-4 真哈希链:** 后端在归档时为每个 `BidArchiveItem` 计算 SHA-256（内容 + 前一项哈希），形成链；前端显示真实哈希（截断显示 + tooltip 全文 + 复制按钮）。
- **P0-5 移除硬编码凭证:** 删除 `TAB_DEFAULTS`，登录页留空输入框；可选保留"填充演示账号"开关但仅 `NODE_ENV=development` 显示。
- **P0-6 错误可见:** 全系统 `.catch` 不再静默；引入统一的错误处理 — 拉取失败显示错误态（带"重试"按钮）而非空态；区分"加载中/为空/出错"三态。

### Phase 1 · 实时事件架构 (Real-Time Event Bus) — C 基础设施, ~3-4 天

构建承载所有透明度的统一实时层。详见 §4。

- **统一 WebSocket 层:** 重建 `use-bid-websocket.ts`（类型化载荷、陈旧闭包修复、指数退避重连、心跳、连接状态暴露、env 驱动 URL）；为 expert-portal 新建对等 hook。
- **连接状态机:** CONNECTED/RECONNECTING/DISCONNECTED，UI 指示器（绿/黄/红点 + tooltip）。
- **事件分类法 + 角色路由:** §4a 事件表 + §4b 路由矩阵，硬编码透明度边界。
- **连接指示器:** 双门户 app-shell 头部状态点。

### Phase 2 · 流程与门控 (Flow & Gating) — B 效率, ~2-3 天

修复 P1-2 ~ P1-5 + P2-4。让流程正确、高效。

- **P1-4 步骤门控:** 向导标签按状态禁用 — 未签到不可进标书获取；未回避不可进评分；强制正向推进（已完成的步骤仍可回看）。
- **P1-3 逐供应商回避:** 回避步骤展示供应商列表，专家可逐个声明"有冲突"（带理由）或"无冲突"；有冲突的供应商在后续步骤标灰且不可评分；冲突声明持久化到后端。
- **P2-4 键盘可达评分:** 单一可访问控件（数字输入 + 键盘增减），Tab 键流转评分项；ARIA `aria-valuemin/max/now/text`；快捷键 Enter 提交当前项。
- **P1-2 专家侧澄清:** expert-portal 新增澄清阅读页 + 发布澄清（向招标人/监督提问）；与 bid-portal 澄清线程双向实时。
- **P1-5 bid-portal 澄清回复:** 澄清表新增"回复"操作 + 状态徽章（待回复/已回复/已关闭）；回复实时推送到 expert-portal。

### Phase 3 · 透明度界面 (Transparency Surfaces) — C 北极星, ~4-5 天

修复 P1-1, P1-6, P2-3。在 Phase 1 事件总线上构建可见的透明度。

- **P1-1 + P2-3 专家侧实时状态板:** expert-portal 新增"实时状态"面板 — 流程时间线（当前阶段 + 已完成里程碑）+ 聚合在场板（X/Y 签到、平均进度%、报告确认数，**无个人分数**）+ 最近事件流 + 连接指示器。
- **bid-portal 实时扩展:** 把 Phase 1 之前已重构的 open/evaluate 实时能力扩展到 dashboard（工作区面板自动刷新）、archive（归档进度实时）、supervise（已在用 WebSocket，补连接指示器）。
- **P1-6 监督可操作异常:** 异常事件可"标记关注"/"升级"/"批注"；批注进入审计日志；异常不再被动展示。
- **跨门户澄清实时线程:** 澄清的创建/回复在双门户实时浮现（ambient toast + 列表更新）。

### Phase 4 · 一致性与打磨 (Consistency & Polish) — B 质量, ~2-3 天

修复 P2-1, P1-7, P2-5。让全系统像一个产品。

- **P2-1 设计系统统一:** 4 个未重构 bid-portal 页面（dashboard/archive/clarifications/supervise）迁移到 `SectionCard`/`MetricCard`/`workbench-*` 体系，消除裸 `oklch()`/内联字体。
- **P1-7 分页/虚拟化:** 所有列表引入分页或虚拟滚动（项目表、澄清表、监督日志、归档清单）。
- **P2-5 错误边界 + 重试:** React Error Boundary 包裹路由级；网络错误统一重试 UI。

**总计: ~13-18 天，迭代推进。**

---

## 4. 实时事件架构 (Phase 1 核心)

### 4a. 事件分类法

开标生命周期中的每一个实时事件：

| 类别 | 事件 | 载荷 |
|------|------|------|
| **解密** | `decrypt.status` | `{supplierId, status, timestamp}` |
| | `submission.opened` | `{hostId, timestamp}` |
| | `opening.started` | `{sessionId, hostId, decryptWindowEnd}` |
| **阶段** | `stage.change` | `{projectId, from, to, actor}` |
| | `evaluation.started` | `{projectId, timestamp}` |
| **专家在场** *(仅里程碑，无分数)* | `expert.signed_in` | `{expertId, timestamp}` |
| | `expert.avoidance_confirmed` | `{expertId, timestamp}` |
| | `expert.scoring_progress` | `{expertId, progressPercent, timestamp}` |
| | `expert.report_confirmed` | `{expertId, timestamp}` |
| **澄清** | `clarification.created` | `{id, issuerRole, supplierId, preview}` |
| | `clarification.replied` | `{id, replierRole, preview}` |
| **监督** | `supervision.log` | `{role, action, target, result, riskFlag}` |
| | `anomaly.detected` | `{type, supplierId?, detail, severity}` |

**铁律: 分数永不出现在事件中。** 分数仅在 bid-portal evaluate 页面（host/admin 视图）浮现。事件携带*活动里程碑*，非*评审内容*。

### 4b. 角色路由交付 (透明度边界)

| 事件 | 专家 | 主持/管理 | 监督 |
|------|:----:|:--------:|:----:|
| decrypt.status | ✅ | ✅ | ✅ |
| stage.change | ✅ | ✅ | ✅ |
| evaluation.started | ✅ | ✅ | ✅ |
| expert.signed_in | **聚合** (3/5) | 个体 | 个体 |
| expert.avoidance_confirmed | **聚合** | 个体 | 个体 |
| expert.scoring_progress | **聚合** (平均%) | 个体 | 个体 |
| expert.report_confirmed | **聚合** (完成数) | 个体 | 个体 |
| clarification.created | ✅ | ✅ | ✅ |
| clarification.replied | ✅ | ✅ | ✅ |
| supervision.log | ❌ | ✅ | ✅ |
| anomaly.detected | ❌ | ✅ | ✅ |

**聚合 vs 个体:** 专家看到"3/5 已签到，平均进度 60%"——知道房间状态，不知道任何个人的分数或节奏。host/supervisor 看完整个体图景（谁落后、谁完成），因为他们管理流程。

后端在 gateway 层按 socket 的角色命名空间路由：`/bid` (host/admin/supervisor) 收全量；`/expert` (专家) 收聚合变换后的在场事件。

### 4c. 传输 — 连接状态机

重建现有 `use-bid-websocket.ts`（当前问题：硬编码 URL、无重连、陈旧闭包、无连接状态）。设计：

```
状态:  CONNECTED 🟢 → RECONNECTING 🟡 → DISCONNECTED 🔴
                                        ↑                  │
                                        └── 退避 1s→2s→5s→10s (封顶)
```

- **类型化载荷** — 每事件有 TS interface，消除 `any`。
- **陈旧闭包修复** — handler 存入 ref，effect 每渲染重绑。
- **指数退避** — 1s → 2s → 5s → 10s（封顶），成功后重置。
- **心跳** — 每 20s ping，10s 无 pong 则重连。
- **连接状态暴露** — hook 返回 `{status, lastEventAt, reconnectNow}`，UI 据此渲染指示器。
- **env 驱动 URL** — 读 `NEXT_PUBLIC_WS_URL`，回退本地 `:4001`。

### 4d. UX 界面

**连接指示器** — 双门户 app-shell 头部小点：

| 状态 | 视觉 | tooltip |
|------|------|---------|
| 🟢 已连接 | 稳定绿点 | "实时连接 · 最近事件 10:23" |
| 🟡 重连中 | 脉冲黄点 | "重连中… 第 2 次尝试" |
| 🔴 已断开 | 红点 + 顶部细横幅 | "连接已断开 · 5s 后重试 [立即重连]" |

**事件 toast 流** — 分层通知紧迫度：

| 层级 | 模式 | 示例 |
|------|------|------|
| 环境层 | 右下，4s 自消失，安静 | "张专家 已签到" |
| 需行动 | 持续至点击，带 CTA | "新澄清问题 — 查看" |
| 关键 | 顶部横幅，红，可关闭 | "⚠️ XX集团 解密失败" |

**在场板（专家侧）** — 实时面板，展示流程 + 同伴，**无分数**：流程时间线（核验→评标→报告→归档，当前高亮）、聚合专家组进度（X/Y 签到、平均进度条%、报告确认数）、最近事件流（时间 + 描述）。

---

## 5. 成功标准 (怎样算"极致")

### 信任层 (A)
- [ ] 切换供应商后，评分表正确显示该供应商的已存评分，且提交只影响该供应商（P0-1 回归测试覆盖）。
- [ ] 任何非满分评分项无理由时，提交被明确阻止并定位缺失项（P0-2）。
- [ ] 刷新/导航后，未提交的评分草稿可一键恢复（P0-3）。
- [ ] 归档项哈希是 SHA-256 内容链，篡改任一字节则链断裂、可检出（P0-4）。
- [ ] 生产构建中无硬编码凭证（P0-5，CI 检查）。
- [ ] 任何网络失败显示明确错误态 + 重试，而非静默空态（P0-6）。

### 协作层 (C)
- [ ] 专家在任何时刻知道：当前阶段、聚合专家组进度、最近事件、自己是否在线（连接指示器）。
- [ ] host 在任何时刻知道：每个专家的个体进度、所有分数、所有事件。
- [ ] 专家**永远**看不到其他专家的个体分数或个体进度百分比（边界回归测试）。
- [ ] 澄清的创建/回复在双门户 < 1s 内实时浮现。
- [ ] WebSocket 断开后，指示器变黄→红，自动退避重连，恢复后变绿且数据自愈（无手动刷新）。

### 效率层 (B)
- [ ] 评分全程可键盘完成（Tab 流转、数字输入、Enter 提交），无需鼠标。
- [ ] 步骤门控阻止跳过签到/回避直达评分。
- [ ] 有冲突的供应商自动标灰且不可评分，无需专家记忆。

### 一致性层
- [ ] 全部 11 页面视觉统一（同一设计系统、同一间距/字号/边框）。
- [ ] 列表超 50 项不卡顿（分页或虚拟化）。

---

## 6. 实施顺序与迭代

按 Phase 0 → 4 推进。每 Phase 独立 spec → plan → 实现 → 验证。

**下一动作:** 进入 Phase 0 的详细实施计划（writing-plans），逐项实现 P0-1 ~ P0-6。

---

## 附录 A — 关键文件索引

### expert-portal (:3006)
- `src/app/(app)/evaluate/[id]/page.tsx` — 5 步向导，P0-1/P0-2/P0-3/P1-4/P1-3/P2-4 的主战场
- `src/app/login/page.tsx` — P0-5 硬编码凭证
- `src/app/(app)/page.tsx` — 工作台
- `src/app/(app)/projects/page.tsx` — 项目列表
- `src/app/(app)/profile/page.tsx` — 个人信息
- `src/components/app-shell.tsx` — 连接指示器挂载点

### bid-portal (:3007)
- `src/app/(dashboard)/bid/page.tsx` — dashboard（P2-1 统一）
- `src/app/(dashboard)/bid/open/page.tsx` — 开标大厅（已重构，Phase 1 扩展实时）
- `src/app/(dashboard)/bid/evaluate/page.tsx` — 评标管理（已重构）
- `src/app/(dashboard)/bid/archive/page.tsx` — P0-4 哈希链 + P2-1 统一
- `src/app/(dashboard)/bid/clarifications/page.tsx` — P1-5 回复 + P2-1 统一
- `src/app/(dashboard)/bid/supervise/page.tsx` — P1-6 可操作异常 + P2-1 统一
- `src/hooks/use-bid-websocket.ts` — Phase 1 重建
- `src/components/notification-bell.tsx` — 用错 API 模块，Phase 1 修正

### api (:4001)
- `src/bid/` — 事件发射（gateway）、归档哈希计算（P0-4）、回避冲突持久化（P1-3）、澄清回复端点（P1-5）
