# :3011 移动驾驶舱·领导视角创新设计（水叮当对话 + 感知层 + 影响力层）

> 日期：2026-10-22 · 状态：已实施（2026-10-23，13 任务 SDD 全量落地）
> 前置：:3011 三页（数据库/台账/进展）与 AI 欢迎语已上线（`130897db`…`5a3e01d5`）

## 1. 背景与目标

:3011 是领导/管理层的手机端只读驾驶舱。现状三页数据完整但存在三个结构性差距：

1. **信息平铺不分级**——领导要自己在 10 个区块里找异常，缺一层「说人话」的翻译；
2. **被动等看不告知**——数据变了界面不说话（无红点、无变化感知）；
3. **数字无参照系**——没有环比，领导只能靠记忆判断多与少。

目标：让领导 **10 秒知道有没有事 → 30 秒知道事是什么 → 随口能问 → 一键能转**。

## 2. 总体架构

**复用（不新建）**
- 水叮当大脑：`apps/api/src/assistant/`（会话属主隔离 + 工具调用链 8 工具 + 卡片 citations + RAG）；
- `DashboardService.getDashboard(startDate, endDate, scopeFilter)`（DashboardModule 已 export）；
- `ProgressService.getProgressStats / getAiInsights`（ProgressModule 需补 export）;
- `LlmService`（全部 LLM 调用收口）、`CompanyScopeService`、`/procurements/stats`；
- :3011 现有组件（SectionCard/MetricCard/BottomSheet/Chip/m-tile 体系）。

**新增**
- 后端：`/ai/mobile-brief`（今日要报）、`/dashboard?compare=true` 环比块、`/dashboard/badges`、`/dashboard/company-ranking`、`/progress/upcoming`、`assistant/tools/cockpit.tool.ts`、工具执行上下文 `AssistantToolCtx`；
- 前端：`/chat` 第四 Tab（水叮当）、今日要报卡、环比箭头、Tab 角标、转发简报、关键节点时间线、公司龙虎榜区块。

**分期**：P0 感知层（~1 天）→ P1 水叮当 Tab（~2-3 天）→ P2 影响力层（~1-2 天）。

## 3. P0 感知层

### P0-1 今日要报（数据库页首卡）

- 端点 `GET /ai/mobile-brief?companyIds=`（`@Roles(admin,leader,staff)`，Throttle 20/min，AiController 挂载）。
- 服务 `mobile-brief.service.ts`：一次聚合「本月口径 dashboard summary + 风险项目 top + 节资 top3 + 阶段分布」→ LLM 生成**固定三句结构**：
  ① 最该关注的一件事（风险/停滞，含项目名与天数）；② 一个关键数字（成交额或节资，带环比方向）；③ 一个提醒（近期节点/异常信号）。
- **每次进入现场生成、不缓存**（与欢迎语口径一致，2026-10-22 用户裁定）；prompt 禁 emoji/禁「审批」词（沿用 sanitize 兜底）/只讲需要领导知道的事、每句 ≤30 字。
- 返回 `{ focus: {text, jump}, metric: {text, jump}, reminder: {text, jump}, shareText }`——`jump` 为前端路由锚（如 `/dashboard#risk`、`/ledger?status=PENDING`）；`shareText` 供 P2 转发。
- 前端：数据库页顶部（欢迎卡下）`m-tile` 三行卡，每行可点跳转；加载中显示 skeleton 脉冲占位；失败显示「今日要报生成中，稍后下拉刷新」轻文案（非静态保底内容，可点击重试）。

### P0-2 指标环比箭头

- `DashboardService.getDashboard` 增加可选 `compare=true`：服务端按当前区间**等长前移**取上期 summary，响应新增 `compare: { totalCount, completedCount, abnormalCount, totalAward, totalSavings, awardedBudget }`（旧值为 0 或区间空时返回 null 字段，前端不显示箭头）。
- 前端 MetricCard 增强 `delta?: {value: number; direction: 'up'|'down'|'flat'}`：箭头+百分比小徽标。
- **语义配色**（非机械红涨绿跌）：成交/完成/节资↑=绿、异常↑=红、预算↑=中性蓝；下降对调。
- 进展页四指标：`monthlyAdded/monthlyCompleted` 已有上月字段（`lastMonthAdded/lastMonthCompleted`），纯前端算箭头，后端零改动。
- 全部区间（month/quarter/year/custom）统一支持；「全部」无上期不显示。

### P0-3 Tab 角标

- 端点 `GET /dashboard/badges`（Roles 同 dashboard；CompanyScope 同口径）：一次 prisma 聚合返回 `{ abnormalCount, pendingCount, stalledCount }`——异常项目（dashboard abnormalCount 同式）、台账待处理（`/procurements/stats` pendingCount 同式）、停滞项目（active PMI 当前阶段停留 >30 天，按阶段 updatedAt 判定）。
- 前端：主 layout 挂载时拉取一次（登录后），Tab 图标右上角红点数字（≥99 显示 99+）；`document.visibilitychange` 回前台时静默刷新。数值为 0 不显示。

## 4. P1 水叮当第四 Tab

### 4.1 前端 `/chat`（`(main)/chat/page.tsx`）

- 底部栏第四项「水叮当」（Lucide `Bot` 图标），TABS 数组扩展，默认落地不变。
- 聊天 UI（cgzxui 移动版）：消息气泡流（用户右 accent 瓷片 / 水叮当左白瓷片）、工具卡片渲染（`cards: metric → 指标瓷片网格；table → 迷你表格`）、输入条钉在 Tab 栏上方（`m-input` 圆角变体 + 发送钮）、typing 指示三点。
- **快捷问题 chips**（首屏空态展示，点击即发送）：「本月成交额多少」「当前最大风险是什么」「节资排名前三」「哪个阶段最堵」。
- 公司口径标签：顶行显示当前口径（leader=本公司名 / admin=当前 CompanyPicker 选择或全部公司）；admin 切换口径后再问（`ChatDto.context.companyIds` 透传）。
- 会话：conversationId 存 localStorage，沿用既有会话（属主=JWT sub 自动隔离）；「新对话」按钮调既有 `POST /assistant/conversations`。历史消息经 `GET /assistant/conversations/:id` 恢复。
- **只读铁律**：响应中的 `pendingActions` 不渲染确认/取消按钮，仅以文字提及（驾驶舱不引入写操作）。

### 4.2 后端 A：工具执行上下文与公司口径收口（P1 安全核心）

- `AssistantTool.execute(args)` → `execute(args, ctx?: AssistantToolCtx)`，`AssistantToolCtx = { user?: { sub: string; role: string; companyId: string | null }; companyIds?: string[] }`。
- `AssistantService.chat()` 在进入工具循环前解析 ctx：认证用户查 `User.companyId`（一次 prisma 查询）；`ChatDto.context.companyIds` 仅 admin 角色采纳（非 admin 忽略并 warn）。匿名访客 ctx.user 为空、行为与现状完全一致（allowedTools 公开域限制不动）。
- 数据承载工具（`procurement / bid / supplier / expert / global_overview / cockpit`）在 ctx.user 存在且 role≠admin 时，对所有带公司归属列的查询注入本公司过滤（各工具按表映射：BidProject.companyId、Supplier.companyId、User.companyId 等；与 CompanyScopeService 三页口径一致——**leader 提问不得返回他司数据**）。
- 不动 `announcement / mall / notification`（公告本就公开域）。

### 4.3 后端 B：cockpit 工具

- `assistant/tools/cockpit.tool.ts`：`description: "查询领导驾驶舱口径数据：汇总指标/风险项目/节资排行/阶段分布/环比。args: { action: 'summary'|'risk'|'savings'|'stages' }"`。
- 实现：注入 `DashboardService` + `ProgressService`（AssistantModule imports DashboardModule；ProgressModule 补 `exports: [ProgressService]`），按 ctx 过滤（admin 支持 companyIds），本月口径 + 全量风险。
- 注册进 ToolRegistry（第 9 个工具）；工具说明写明「领导驾驶舱问答优先用本工具」。

### 4.4 验证

- 单测：ctx 解析（admin 采纳/非 admin 忽略 companyIds）、cockpit 工具四 action、mobile-brief 三句结构 sanitize。
- e2e（`test/` 新增 `mobile-cockpit.e2e-spec.ts`）：leader 登录 → chat 问「全部公司本月成交额」→ 断言 answer/cards 不含他司项目名；admin 传 companyIds 生效；匿名访客问 cockpit → 拒绝话术（既有 allowedTools 机制扩展）。

## 5. P2 影响力层

### P2-1 一键转发简报

- 今日要报卡右上「转发」钮：优先 `navigator.share`（移动端原生分享面板），不支持则复制到剪贴板（走 :3011 `copy-to-clipboard` 本地 util，按真实结果反馈）。
- 文案 = `mobile-brief` 返回的 `shareText`（一段 80-120 字、含今日三要点的班子群风格文本，LLM 与三句同轮生成，无额外调用）。

### P2-2 近期关键节点（进展页新区块）

- 端点 `GET /progress/upcoming?days=14`：BidProject 未来 N 天 `deadline`（截标）/ `openTime`（开标）+ PMI 关联项目名，按日聚合；CompanyScope 同口径。
- 前端：进展页顶部「未来 14 天」横向时间线卡（日期瓷片列 + 事件点 + 项目名截断），空态「近期无关键节点」。

### P2-3 公司龙虎榜（数据库页新区块，admin 可见）

- 端点 `GET /dashboard/company-ranking`：按 companyId groupBy 本月口径五指标（项目数/成交额/完成率/节资额/异常数），返回排名数组（Company 主数据补名称；无归属项目入「未归属」不计排名）。
- admin：完整榜单区块（本年+本月双口径切换 Chip）；leader/staff：显示「本公司排位卡」——本公司各指标 + 集团同指标均值对比（不暴露他司明细行，只给排位与均值）。

## 6. 数据与安全口径

- **只读**：P0-P2 全部为读路径；水叮当移动端不渲染任何写操作卡片。
- **公司隔离**：所有新端点接 `CompanyScopeService`（与三页同口径）；工具层收口见 4.2；e2e 越权抽查为闸。
- **LLM 收口**：全部走 `LlmService`（并发/重试/配额既有）；推理模型 maxTokens 给足（≥1024，2026-10-22 maxTokens=96 事故教训）；禁词「审批」出口替换复用。
- **无 mock**：所有新区块展示真实数据或空态，失败重试不造假。
- 限流：新 LLM 端点挂 AiController 类级 20/min；`/assistant/chat` 沿用现状。

## 7. 测试与验收

- 单测：mobile-brief（结构/禁词/无缓存）、compare 环比（等长前移/空上期）、badges（三计数口径）、cockpit 工具、ctx 收口。
- e2e：`mobile-cockpit.e2e-spec.ts`（leader 越权/ admin 口径切换 / 匿名拒答）+ 既有 20 套件回归绿。
- 手动冒烟清单：三 Tab + 水叮当四问（快捷 chips 全走通）/ 角标出现与消失 / 环比箭头方向语义 / 转发文案落剪贴板 / 375px 与 320px 宽度无溢出。

## 8. 里程碑

| 期 | 内容 | 预估 |
|---|---|---|
| P0 | 今日要报 + 环比箭头 + Tab 角标 | ~1 天 |
| P1 | 水叮当 Tab（前端 + ctx 收口 + cockpit 工具 + e2e） | ~2-3 天 |
| P2 | 转发简报 + 关键节点 + 公司龙虎榜 | ~1-2 天 |

## 9. 明确不做（backlog）

- G 我的关注（标记项目变化置顶）；H 长按数字追问；水叮当移动端写操作/操作预案确认；:3011 语音输入。
