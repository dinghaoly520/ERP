# Plan: bid-portal (:3007) 管理端审计问题修复

> 来源：2026-06-21 对 `http://localhost:3007/bid` 的详细审计。共 19 条问题，按 P0→P3 依次修复。
> 约束：本地 main 长期领先 origin → 走隔离分支 `fix/bid-portal-audit`，勿直接推 main；无前端组件测试 → 手动走查 + 后端 E2E；Node 24 + Next.js `--webpack`。

## 提交分组（11 组 + 2 won't-fix）

| 组 | 提交标题 | 含问题 | 文件 |
|----|---------|--------|------|
| G1 | `fix(bid): 监督端健壮性（错误态/异常源/空状态/toast）` | #2 #12 #13 #17 | supervise/page.tsx |
| G2 | `fix(bid): 归档流程可达（评标端归档入口）` | #1 | evaluate + archive |
| G3 | `fix(bid): 开标倒计时实时跳动 + 音频 resume` | #3 #16 | open/page.tsx |
| G4 | `fix(bid): 澄清答疑实时推送 + 回复行 colSpan` | #4 #6 | clarifications/page.tsx |
| G5 | `fix(bid): 评分标准 DOWNLOAD/SUBMIT 可编制` | #5 | project-tabs + bid/page + project/[id] |
| G6 | `feat(bid): 侧边栏最近项目直达` | #7 | app-shell.tsx |
| G7 | `fix(bid): standalone 路由无项目时显示引导` | #8 | 5 个 standalone page |
| G8 | `feat(api): 归档汇总端点（消除 N+1）` | #9 | bid.controller + service + archive page |
| G9 | `fix(bid): proxy 角色校验 + 端口去硬编码` | #11 #14 | proxy.ts + use-bid-websocket |
| G10 | `feat(bid): 评标排名规则说明` | #15 | evaluate/page.tsx |
| G11 | `chore(bid): 移除 project-tabs 空占位 div` | #18 | project-tabs.tsx |
| — | won't-fix（附理由） | #10 #19 | — |

## 执行顺序

```
G1(P0) → G2(P0) → G3,G4,G5(P1) → G6 → G7 → G8(后端) → G9 → G10 → G11
```

---

## Todo List（19 条）

### 🔴 P0

- [x] **#2 监督端首屏失败永久卡骨架屏** · `supervise/page.tsx:50-54`
  改：初始 fetch 包 try/catch + `error` state + 重试按钮（照搬 evaluate 页 `loadProject` 模式）。
  验收：停 API 后进监督端 → 错误态 + 重试，不再永久骨架屏。
- [ ] **#1 归档流程 UI 不可达** · `evaluate/page.tsx` / `archive/page.tsx:324`
  改：evaluate 页"评标结果汇总"区，`stage==='EVALUATING'` 且 `results.length>0` 时加"归档项目"按钮 → 调 `archiveAll(id)`，成功后 refetch；archive 详情页永远 disabled 的按钮改只读"已归档"标识。
  验收：lizhuren 进 EVALUATING 项目 → 生成结果 → 点归档 → 流转到 ARCHIVED。

### 🟠 P1

- [ ] **#3 开标倒计时不跳** · `open/page.tsx:190,331-339`
  改：加 `now` state，1s interval 内 `setNow(Date.now())`；`remaining` 用 `now` 计算。
  验收：圆环 + MM:SS 每秒跳动。
- [ ] **#16 AudioContext 可能 suspended** · `open/page.tsx:118`（与 #3 同提交）
  改：首次 click/keydown 时 `audioCtxRef.current?.resume()`。
- [ ] **#4 澄清页无实时推送** · `clarifications/page.tsx`
  改：接入 `useBidWebSocket`，`onClarificationCreated` prepend、`onClarificationReplied` 原地更新；加 ConnectionIndicator。
- [ ] **#6 澄清回复行 colSpan 错** · `clarifications/page.tsx:266`（与 #4 同提交）
  改：`colSpan={7}` → `colSpan={8}`。
- [ ] **#5 评分标准 tab 在 DOWNLOAD/SUBMIT 被隐藏** · `project-tabs.tsx:27-29` + 导航
  改：standard tab `minStage` 加 DOWNLOAD,SUBMIT；overview 加入口；`getDefaultTab` 对这两阶段返回 'standard'。

### 🟡 P2

- [ ] **#7 侧边栏缺主导航入口** · `app-shell.tsx:24-27`
  改：加"最近项目"区，复用 `recent-projects.tsx`。
- [ ] **#8 standalone 死路由** · 5 个 standalone page
  改：无 `projectId` 时渲染"请从总览选择项目"引导 + 跳 `/bid` 按钮，替代 `return null`。
- [ ] **#9 归档 N+1** · 后端 `bid.controller+service` / 前端 `archive/page.tsx`
  改：新增 `GET /bid/projects/archive-summary` 一次查询；加 @Roles + 单测；前端改用。
- [ ] **#10 proxy 每次跳转验 token** · `proxy.ts:36` — **won't-fix**：标准做法，收益低。
- [ ] **#11 proxy 不验角色** · `proxy.ts:22-47`
  改：校验 `role ∈ {admin,bid_host}`。⚠️ 先与用户确认 procurement_staff 取舍。
- [ ] **#14 硬编码 localhost:4001** · `proxy.ts:36` / `use-bid-websocket.ts:21`（与 #11 同提交）
  改：从 `@water-erp/config` 取 `PORTS.api`。

### 🟢 P3

- [ ] **#12 异常面板只覆盖解密 DANGER** · `supervise/page.tsx:99`（与 #2 同提交）
  改：加 `anomalyEvents` state，`onAnomalyDetected` push；面板合并显示。
- [ ] **#13 监督端日志无空状态** · `supervise/page.tsx:125,263`（与 #2 同提交）
- [ ] **#17 toast 写法绕** · `supervise/page.tsx:90`（与 #2 同提交）
- [ ] **#15 评标排名无说明** · `evaluate/page.tsx:284-305` — 排名列头加 tooltip。
- [ ] **#18 project-tabs 空 div** · `project-tabs.tsx:125` — 移除。
- [ ] **#19 context 与 tab 页重复拉 project** — **won't-fix**：写后取最新值的有意设计。

## Success Criteria

- 19 条全部有处置（17 改 + 2 won't-fix 附理由）
- P0/P1 在 lizhuren 账号下手动走查通过
- G8 后端单测通过；`pnpm --filter api test` 绿
- `pnpm --filter bid-portal lint`/构建通过
- 每组提交可独立 revert，不直接 push 本地 main

---

## 执行状态（2026-06-22）

全部 11 组代码改动完成，2 条 won't-fix。

| 组 | 状态 | 说明 |
|----|------|------|
| G1 | ✅ | supervise 错误态/异常源/空状态/toast |
| G2 | ✅ | 归档入口移至评标端；archive 详情页改只读徽章 |
| G3 | ✅ | 倒计时每秒跳动（`now` state）+ AudioContext resume |
| G4 | ✅ | 澄清实时推送 + 回复行 colSpan 8 |
| G5 | ✅ | 评分标准 DOWNLOAD/SUBMIT 可编制 + 导航 |
| G6 | ✅ | 侧边栏「最近访问」直达 |
| G7 | ✅ | 5 个 standalone 路由无项目时显示引导（不再永久骨架屏） |
| G8 | ✅ | 后端 `GET /bid/projects/archive-summary`（TDD，3 个新单测）+ 前端改用 |
| G9 | ✅ | proxy 角色校验（admin/bid_host/procurement_staff）+ 端口去硬编码 |
| G10 | ✅ | 评标排名规则说明（描述 + tooltip） |
| G11 | ✅ | 移除 project-tabs 空占位 div |
| — | won't-fix | #10（proxy 每跳验 token，标准做法）/ #19（重复拉 project，写后取最新值的有意设计） |

**自动化验证**
- `apps/bid-portal` tsc --noEmit：✅ exit 0
- `apps/api` tsc --noEmit（build 配置）：✅ exit 0
- `pnpm --filter api test`：282/286 通过；4 个失败均在 `expert-admin.portrait-retire.spec.ts`（confirmRetire 缺 `prisma.user.update` mock）—— 属于专家域既有问题，与本次 bid 改动无关，且 [[bid-flow-remediation]] 记录专家相关工作进行中、有「勿迁移」约束，未触碰。
- 新增 `getArchiveSummary` 3 个单测：✅ 全过
- `eslint` 未在本机 PATH（环境问题，非代码问题）；以 tsc 为准。

**待人工确认 / 走查**
- G9 角色范围：当前放行 `procurement_staff`（与后端 `@Roles` 一致）。若 CLAUDE.md 定位（仅 admin/bid_host）需收紧，改 `proxy.ts` 的 `ALLOWED_ROLES` 一处即可。
- P0/P1 需在 `lizhuren` 账号下浏览器走查（归档闭环 / 监督端错误恢复 / 倒计时跳动 / 澄清实时 / 评分标准编制）。
- 改动均在工作区未提交；按 [[local-main-diverges-from-remote]] 应走隔离分支 + PR，勿直接推 main。

