# 迭代一（在线开标大厅·实时文字地基）严格审查与修复清单

- **审查日期**：2026-07-24
- **审查范围**：`97bc8296..4b0b869f`（feat/bid-opening-hall-impl 已推送部分，34 commits；设计文档 `docs/superpowers/specs/2026-07-23-online-bid-opening-hall-design.md`）
- **审查方法**：三路独立审查（需求完整性 / 后端逻辑与安全 / 前端 UI 与质量）+ 控制器逐条交叉验证；关键发现以真实环境探针实证（curl + 匿名 socket.io 探针 + DB 直查）
- **结论**：安全不变量（供应商房间隔离、私聊双层隔离、消息不可变、成员门）经追踪确认成立且 E2E 有回归背书；但**实时通道的认证兜底、存证链路完整性、主持端移植质量**存在系统性短板。共核实 **Critical 3、Important 21（合并去重后）、Minor 约 40**。

> **范围说明**：本地分支另有并行工作线的 9 个未推送提交（C1-C6 阶段棘轮 + Phase 2/3 开评标指挥中心重构）。本清单仅计迭代一范围内问题；与并行工作线的交互项单列于 §5。

## 修复进度

- **Wave 1（安全波）✅ 已完成并通过聚焦评审**（commits `52168dc2` + `8b9afda9` + declined 专家收口）：C1 全分支闭合、S1 指派门 + declined 过滤、S7 三段门控无绕过、S10 四组负用例；**S8 用户决策已落地**：procurement_staff 放行 project 房（公开流，可见面 ⊆ 供应商可见面），不进 host 房，REST 敏感操作维持 HOST_ONLY
- **Wave 1 评审新 Minor**（不阻塞，并入后续波次）：M1 连接级信任无驱逐机制（JWT 过期/撤权后不踢）· M2 supplier 可为未参投项目 markRead('public')（仅自身游标，无泄漏）· M3 setExchangeControl 缺服务层 assertHost（仅控制器 @Roles）· M4 staff 零接收 host-only 事件的 E2E 探针 · M5 projectId 无形态校验 · M6 markRead 项目不存在语义应 404
- **Wave 2（存证波）✅ 已完成并通过聚焦评审**（commits `527027b5` + CSV 注入中和）：S2 sectionDigests+sectionsRoot 同源同时机、E2E 篡改失配负对照背书 · S3 CSV 大厅消息段 · S4 纯文本存储（全部渲染路径转义核实）· S5 空白消息 400 + 码点安全截断 · S6 复合游标（排序严格配对、旧格式兼容）+ 非法输入 400 · 评审残留 CSV 公式注入（既有跨截面弱点）已随波收口（esc 前置单引号，一处覆盖所有用户输入段）
- **Wave 2 评审新 Minor**：摘要 include 缺 orderBy tiebreaker（重导出复算场景）· hashChain 十六进制前缀不一致（archiveItems 带 `sha256:`、sectionDigests 裸 hex）· 语义非法 ISO 游标被 V8 翻滚接受 · CSV 转义路径测试补强 · sectionsRoot 可扩展覆盖全部 sections
- **Wave 3（UI 明显故障波）✅ 已完成（两轮：`1f01acd8` + 评审收口）**：C2 抽屉 portal 化（评审发现被 sticky 页头遮挡 → top-[68px] 收口）· C3 更新器纯化 + tabRef · R1 确认/异议后 refetch · R2 hydrate 按 id 合并（评审发现快速切换陈旧响应污染 → activeSupplierRef 守卫收口）· U1 双端 IME 守卫（评审发现 Vue keyup 守卫在 Chromium 无效 → 改 keydown 收口）· U7 大厅失败态+重试
- **Wave 3 待手工复验**（代码层已闭合，浏览器效果需人工确认）：① 任意滚动位置开抽屉控制行完整可点、与 z-50 模态层级正确 ② 中文输入法 Enter 选词不误发（双端）③ 私聊停留收公聊角标不再 ×2 ④ 快速连点 3 家私聊最终只含最后一家 ⑤ 停 API 刷新大厅→错误态+重试 ⑥ 供应商确认/异议后主持端表即时变化
- **Wave 3 评审新 Minor**（并入 Wave 4/5）：N4 公聊超 100 条重开尾部乱序（与"无加载更多"同源）· N5 抽屉开着切项目跨项目消息混并（随 U8 projectId reset 消解）· N6 tabRef 亚帧 ±1 未读偏差（切 tab 自纠正）
- **Wave 4a（后端实时健壮性）✅ 已完成（主修复 `0f10c9a7` + 收口 `46d98dfc`）**：R5 markRead 已读末条游标（@updatedAt 不覆盖显式值经 DB 探针实证、向后兼容）· R6 签到事务内原子抢占 · R7 异议处理状态门（收口补事务内条件 updateMany 消灭并发双处理 + 监督日志前后态）· R8 leave 按登记清表 + 定向推送按项目过滤 + presence 口径统一 · I1 唱标重录状态门（锁定态 409 RECORD_LOCKED，消灭 R7 引入的楔子态，评审推演无新死结）· 游标单调
- **Wave 4a 评审登记**（后续）：供应商端 confirmOpening/disputeOpening 无状态门（pre-existing，直调 API 可翻 EXCEPTION→CONFIRMED）· handledBy 死字段 · M3 游标 read-then-upsert 理论非原子
- **Wave 4b（双端前端健壮性）✅ 已完成（主修复 `01d05f2c` + 收口）**：R3 重连 hydrate 补齐（含 projectIdRef 陈旧响应守卫）· R4 阶段联动关输入 · R9 handlers 真 ref · R10 三态连接徽标 + 重连 · U2 即时 markRead 上报末条 id · U3 mine 判 senderId（auth store user.id 同源核实）· U4 入口收敛 + 逾期文案分态 · U5 弹窗收口（收口补网络错误兜底，修删过头退化）· U6 附件边界 · U8 项目切换全量重置（含 control）· U9 alert→toast · U11 CLOSED 禁输入 · M9 resolve 错误处理 + 防重
- **Wave 4b 评审登记**（后续/手工验收）：M4 红色"已断开"徽标实际不可达（自动重连永不放弃，恒橙色——非功能缺陷）· M5 阶段已离 OPENING 后才开的抽屉初始 stageClosed 未同步（事件驱动固有，首次发送 403 兜底）· 7+6 项视觉效果待手工验收
- **Wave 5（打磨波）✅ 已完成（`0fa06e01`）**：供应商端确认/异议 API 状态门（RECORD_NOT_CONFIRMABLE/DISPUTABLE，兼容旧值「待确认」）· I1 409 文案修正 · lastMessageId @MaxLength(64) · markRead 真库 E2E（游标单调 + @updatedAt 承重点固化）· 公聊 hydrate 窗口外语序修正（maxIso 过滤，双端 4 处）· 抽屉 stageClosed 初值同步（只升不降）· 全量 893/893 + E2E 24/24
- **最终全分支评审：✅ 合并就绪**（最高规格模型逐条核验：P0×3 + Important×21 全闭合于 diff + 现状源码双重核实；安全四主线 SAFE；893 单测实测全绿、E2E 24 条与实现逐条吻合；新发现 5 项均 Minor 入迭代二工单；合并前必修项：无）

## 验证状态图例

- 【实证】= 真实环境复现验证（探针/DB 直查/验收观察）
- 【构真】= 代码构成层面确认成立（读码核实，未运行时复现）
- 【已知】= 开发/验收阶段已公开记录的偏离

---

## P0 — Critical（合并/发布前必须修复）

### C1 WebSocket 无认证连接可窃听整个项目实时流【实证】⚠️ 最高优先级
- **位置**：`apps/api/src/bid/bid.gateway.ts` handleConnection（role=undefined 不断连）+ handleJoinProject 兜底分支（无任何认证即 `client.join('project:'+id)` 并 ack `{ok:true}`）
- **实证**：匿名 socket（零 cookie）`io('/bid')` → `emit('join:project', 'cmqhero-bid-proj01')` → ack `{"ok":true}` → 收到主持端发出的 `hall:message:new` 公聊广播
- **影响**：无需登录即可实时接收：公聊全文、`decrypt:status`（每家供应商名+解密成败）、`bid:validity:change`（废标标记）、presence/签到名单、澄清问答预览、stage/opening:started（含主持人/监督姓名）。REST 侧全部要登录，**实时通道完全绕过认证**。projectId 可经公告公开渠道获得
- **沿革**：兜底分支先于迭代一存在（原 gateway 即向 project 房广播 decrypt:status），但迭代一把大厅聊天/在场/签到加入同房，暴露面显著扩大
- **修复**：`role===undefined`（未认证）join 直接拒绝（ack UNAUTHORIZED 或 disconnect）；兜底分支改显式角色白名单；非 host 角色加项目成员/指派校验。E2E 补"无 cookie 连 WS"负用例（当前套件全程带 cookie，恰漏此条）

### C2 主持端交流抽屉被 backdrop-filter 祖先裁剪/错位【构真】
- **位置**：`apps/bid-portal/src/components/bid/exchange-drawer.tsx:124`（`fixed right-0 top-0 h-full`）渲染于 `open/page.tsx:441-473` 的 `<SectionCard className="overflow-hidden p-0">` 内；SectionCard 实现 `packages/ui/src/section-card.tsx:18` = `glass-card glass-card-blue`，`globals.css:166` `backdrop-filter: blur(16px) saturate(1.2)`
- **机理**：CSS 规范中 `backdrop-filter` 为 fixed 后代建立包含块 → 抽屉相对**卡片**而非视口定位，高度=卡片高度、随卡片滚走、被 `overflow-hidden` 裁剪
- **验收遗漏原因**：卡片在视口顶部时抽屉"看起来正常"（验收截图即此状态）；页面下滚后抽屉跟随卡片错位
- **修复**：`createPortal(抽屉, document.body)`，或将 ExchangeDrawer 提到 SectionCard 外的页面根层

### C3 React 状态更新器内含副作用 → 未读角标双计【构真】
- **位置**：`exchange-drawer.tsx:41` `setTab(cur => { if (cur !== 'PUBLIC') setPublicUnread(n => n + 1); return cur; })`
- **机理**：更新器必须纯函数；dev StrictMode 双调更新器 → 停留私聊 tab 时每条公聊 `publicUnread +2`；生产并发渲染重放更新器同样可能多计
- **修复**：仿同文件 `activeSupplierRef`（:34-35）加 `tabRef`，handler 内读 `tabRef.current` 判断，`setPublicUnread` 移到更新器外

---

## P1 — Important：安全与存证完整性

### S1 任意 bid_expert 可进任意项目的 experts + project 房【构真】
- **位置**：`bid.gateway.ts` 专家分支无项目指派校验（注释自认"由专家门户负责"，网关层信任角色即放行）
- **影响**：任一专家 `join:project <任意id>` → 进 `experts:{id}`（收 `expert:presence:aggregate`——该事件对供应商都屏蔽，却对任意专家跨项目开放）+ project 房公开流
- **修复**：join 前校验 `bidExpert.findFirst({ projectId, expertUserId })` 指派关系

### S2 归档哈希链不覆盖大厅消息【构真】
- **位置**：`bid.service.ts` `computeArchiveChain` 仅链 `BidArchiveItem`；`hallMessages` 在 `sections` 内、链外
- **影响**：导出 JSON 后篡改 `sections.hallMessages`（开标全程对话存证）不破坏任何哈希环。新增存证数据进了归档却没进链
- **修复**：归档时新增"开标大厅交流记录" `BidArchiveItem`（内容摘要入链），或对 sections 整体补根摘要并入 chain

### S3 CSV 归档静默丢失大厅消息【构真】
- **位置**：`bid.service.ts` CSV 分支有供应商/开标记录/评分/监督日志/澄清各段，**唯独无 hallMessages**（JSON 有、CSV 无）
- **修复**：CSV 增"开标大厅消息"段与 JSON 对齐

### S4 纯文本聊天过富文本消毒器 → 含 & < > 的消息损坏【实证】
- **位置**：`opening-hall.service.ts:76` `sanitizeHtmlContent(dto.content)`
- **实证**：发送 `报价 <100> 万元 & 工期 365` → DB 存 `报价 &lt;100&gt; 万元 &amp; 工期 365`；两端均纯文本插值渲染（Vue `{{ m.content }}` / React `{m.content}`）→ 用户看到字面 `&lt;`。开标异议/澄清写金额比较极常见
- **次生风险**：消毒白名单含 `img(data:/blob:)`、`a`、`span/div style`（`allowedStyles` 未配）——当前因前端转义无 XSS，迭代二若改富文本渲染即成存储型 XSS/数据外泄向量
- **修复**：TEXT 消息改纯文本转义（或直接落原文——展示侧已天然转义），别复用公告富文本消毒器

### S5 消毒后内容为空仍落库广播【实证】
- **位置**：`opening-hall.service.ts:76` + `send-message.dto.ts`（`@IsNotEmpty` 校验消毒**前**原文）
- **实证**：发送纯 `<script>alert(1)</script>` → 201 返回 id，DB 落库内容为空字符串（sanitize-html 对 nonTextTags 连内容丢弃）
- **修复**：消毒后再判空，空则 400；单测补纯脚本→空用例

### S6 非法 cursor/limit → 500【实证】
- **位置**：`opening-hall.service.ts:107,114-125` + `controller.ts:64`
- **实证**：`cursor=abc` → 500（Invalid Date 进 Prisma）；`limit=abc` → NaN → `take: NaN` → 500（`limit=-5` 正确夹取返回 200）
- **次生**：分页以非唯一 `createdAt` 做游标，同毫秒多条消息翻页被跳过（种子数据、系统连发场景）
- **修复**：cursor 先 `Date.parse` 校验 → 400；limit `Number.isFinite` 回退默认；游标改 `(createdAt, id)` 复合

### S7 markRead 无门控 → 游标表无界增长【构真】
- **位置**：`controller.ts:73-76` + `mark-read.dto.ts`（正则 `/^(public|supplier:.+)$/`）+ `service.ts:161-167`
- **影响**：任何已登录用户可对**任意 projectId** + 任意不重复 `supplier:<串>` roomKey 写游标行（userId 取自 JWT 故不影响他人，但表无界增长 + 可写 dangling projectId；仅全局限流兜底）
- **修复**：校验项目存在 + roomKey 归属（supplier 只能 `public`/`supplier:<自身>`；host 只能 `public`/`supplier:<参投成员>`）

### S8 host 角色过宽：任意 leader/staff 可跨全部项目读私聊/切控制/处理异议【设计决策点 ⚠️ 需用户定夺】
- **位置**：`opening-hall.service.ts:8` `HOST_ROLES_SET = {admin, bid_host, leader, staff}`；与 `BidOpeningSession.host` 指派无绑定
- **影响**：任一 staff 可读任意项目所有供应商私聊转录、PATCH 交流控制、以 `senderRole=HOST` 在大厅留痕（归档显示"主持人"发言，身份歧义——与 M15 同源）。属全应用一致的 RBAC 粒度，但开标场景（私聊保密、主持人身份）尤为敏感
- **修复方向（二选一，需决策）**：① 敏感操作收敛到 `admin`/`bid_host`；② 校验 `session.host` 指派

### S9 WS CORS `origin:true, credentials:true`【既有配置，迭代一未改】
- **位置**：`bid.gateway.ts:81-83`
- **影响**：反射任意 Origin + 带凭证的典型 CSWSH 姿态；当前仅靠 cookie `sameSite:'lax'` 在现代浏览器兜底
- **修复**：WS cors.origin 收敛到与 HTTP 侧（main.ts 环境驱动）一致的白名单

### S10 测试有效性缺口【构真】
- **零覆盖高危路径**：C1（无认证 socket）、S1（专家跨项目）、S7、S6、S5、并发签到、归档链/CSV——E2E 全程带 cookie，恰漏最严重的 C1
- **断言空转**：`notificationMock.create` 从未被断言（"主持私聊回复+供应商离线→站内信兜底"分支零覆盖）；`listMessages` 分页/游标、`unreadCounts` host 分组、`markRead`、`presence` happy-path 均无单测；mock 透传与真实 SQL 行为（唯一约束、Invalid Date、take NaN）脱节
- **修复**：按 Wave 1/2 顺序补齐

---

## P1 — Important：实时正确性

### R1 主持端记录表不随确认/异议事件刷新（toast 有、表无）【验收观察】
- **位置**：`open/page.tsx:363-368` `onOpeningConfirmed/Disputed` 仅 toast 不 refetch → 解密表"确认"列与开标记录确认 chip 继续显示"待确认"，主持人极易误判流程卡住
- **修复**：两 handler 内 refetch `/bid/projects/:id`（与 `onStageChange` 一致）或按 payload 就地 patch

### R2 主持端 drawer hydrate 盲赋值，覆盖在途 socket 增量【构真；供应商端已修、主持端漏修】
- **位置**：`exchange-drawer.tsx:58-59, 74-75`（`setPublicMsgs(r.items.map(toMsg))` 整体赋值）——与供应商端 39087c59 已修复的竞态同源；另有 `openPrivate` 点击到重渲染间 `activeSupplierRef` 旧值小窗口
- **修复**：统一按 id 合并（`[...items, ...localFresh.filter(byId)]`）；`activeSupplierRef` 在 `openPrivate` 内同步写入

### R3 重连后无 REST 补齐（双端）【已知，§11 延后项，验收 item 8 记录】
- **位置**：`useBidWebSocket.ts:133-137` 切后台即 teardown；回前台只重连不补拉；`ChatPanel.vue` 仅 onMounted 加载历史
- **影响**：开标中切后台数分钟 → 聊天记录缺一段，而确认/异议等关键动作恰在此阶段密集
- **修复**：watch `connection` 回 `connected` 时以本地最后 `createdAt` 游标补拉增量

### R4 前端收 stage:change 不关闭聊天输入（双端）【构真，§11 规格要求】
- **位置**：ChatPanel/drawer 均不监听 `stage:change`，仅后端 403 兜底 → OPENING→EVALUATING 后输入框保持可用，反复触发 403
- **修复**：`onStageChange: d => { if (d.to !== 'OPENING') 禁用输入 }`

### R5 markRead 游标用服务端 now() → 漏算未读 + 同毫秒恒已读【构真】
- **位置**：`service.ts:161-167` + `134-141`
- **影响**："拉历史→markRead"窗口内新到消息被误判已读（供应商可能错过主持人指令）
- **修复**：markRead 接收客户端上报的 lastMessageId，用其 createdAt 定游标

### R6 签到为事务外"读后写"、无并发保护【构真】
- **位置**：`service.ts:169-194`
- **影响**：并发双签到都读 `checkInAt=null` → 重复监督日志行；update 成功而 log.create 失败 → 500 且重试命中 `already:true` → **监督日志永久丢失（存证缺口）**
- **修复**：`updateMany({ where: { id, checkInAt: null } })` 原子抢占，按 affected 行数判首签，或 `$transaction` 包裹

### R7 resolveOpeningDispute 无状态机校验【既有逻辑，迭代一仅补 emit】
- **位置**：`bid.service.ts:1145-1192`
- **影响**：主持人可对**从未被异议**的记录调 resolve-dispute，翻转 `bidSupplier.confirmStatus`；可对已处理记录反复覆盖
- **修复**：仅异议态记录可处理；处理前后态记入监督日志

### R8 leave:project 不清连接表 + supplierSockets 未按项目隔离【构真】
- **位置**：`bid.gateway.ts:180-185`（leave 只退房不清表）+ `:289-292`（私聊按 socket id 定向遍历该供应商**全部** socket，不看项目）
- **影响**：供应商 leave 后仍收私聊定向推送、presence 仍计在线；同一供应商跨项目 tab 互收定向事件（同一主体，非跨供应商泄密，但 UI 串流 + 在场表口径不一——`getOnlineSupplierIds` 按项目过滤而定向投递不过滤）
- **修复**：leave 清表；定向投递按 `socketProjects` 过滤项目

### R9 handlersRef 并非真 ref（双端）【构真】
- **位置**：React `use-bid-websocket.ts:125-141` connect() 快照 handler（既有模式）；Vue `useBidWebSocket.ts:49` `let handlersRef = handlers` setup 时一次性捕获（迭代一代码）
- **影响**：当前"碰巧正确"（handler 只闭包稳定对象）；任何新 handler 闭包可变 state 即静默 stale
- **修复**：listener 内每次取 `handlersRef.current.onX?.(d)`

### R10 断线无指示（双端；§8.1 连接状态灯未实现）【已知】
- **影响**：发送走 REST → 断线照样"发送成功"、输入清空，接收静默中断——开标场景误导性最强的故障形态
- **修复**：聊天区头部连接态徽标（绿/黄/红 + 手动重连，`reconnectNow` 已具备）

---

## P1 — Important：UI/UX

| 编号 | 问题【验证】 | 位置 | 修复方向 |
|---|---|---|---|
| U1 | 中文输入法 Enter 误发送（双端，无 isComposing 守卫）【构真】 | `ChatPanel.vue:113`、`exchange-drawer.tsx:187` | `if (e.isComposing \|\| e.keyCode === 229) return`，两端同改 |
| U2 | 默认 PUBLIC tab 不 markRead → 用户正在读却角标虚高（双端）【构真】 | `ChatPanel.vue:85-87`、`exchange-drawer.tsx:56-69` | 公聊列表可见时即 `markRead('public')` |
| U3 | ChatPanel `.mine` 误判：公聊中**其他供应商**消息被渲染成"我发的"蓝底【构真】 | `ChatPanel.vue:105` `:class="{mine: m.senderRole==='SUPPLIER'}"` | 比较 `m.senderId === 当前用户 id`（载荷已带 senderId） |
| U4 | MyBids"开标确认"入口放行 EVALUATING/ARCHIVED，大厅/后端仅 OPENING → 点进去只有灰字提示的死胡同【构真】 | `MyBids.vue:64-68` vs `OpeningHall.vue:121` vs `supplier-portal.service.ts:840/880` | 入口收敛仅 OPENING，或大厅给"逾期未确认"明确只读态 |
| U5 | 错误提示双层弹窗：axios 拦截器全局 ElMessage + 组件再弹一次（禁言发送等同文案弹两次）【构真】 | `api/index.ts:35-41` + `ChatPanel.vue:79` 等 | 二选一收口 |
| U6 | 书面来函附件：超限无提示（无 on-exceed）、上传失败/在途可裸提交、孤儿 FileAsset 不清理【构真】 | `BidDetail.vue:198-209` | on-exceed 提示 + 失败标红 + 提交门禁 upload 状态 |
| U7 | profile 失败 → ChatPanel 永不挂载、页面卡"加载供应商信息中…"无重试；refresh() 无 catch → 首屏失败永久"加载中…" + unhandled rejection【构真】 | `OpeningHall.vue:24-32, 87-93` | 错误态 + 重试按钮；refresh 内 try/catch |
| U8 | drawer 状态不随 projectId 重置（activeSupplier/privateMsgs/checkins 残留，切项目串话）【构真】 | `exchange-drawer.tsx` | `useEffect(reset, [projectId])` |
| U9 | host drawer 错误用原生 alert()（与全站 toast 体系割裂、阻塞主线程）【构真】 | `exchange-drawer.tsx:92,103` | 改 `toast.error` |
| U10 | 监督端 MsgList 内联定义 → 切换供应商/刷新时整列重挂载、滚动位置丢失【构真；迭代一代码在 supervise/page.tsx，该页已被并行工作线重构为 supervision-view.tsx 同病仍在】 | `supervision-view.tsx:285` | 提模块级组件 |
| U11 | host drawer CLOSED 态仍可输入发送（后端 403 + alert）【构真】 | `exchange-drawer.tsx` 输入框仅私聊未选时禁用 | `control==='CLOSED'` 禁用 + 提示 |

---

## P2 — Minor（分组，择机修复）

**后端**
- lastSeenAt 每次 join 无条件写库、无节流（schema 注释称"节流写入"，实现不符；重连风暴写放大）
- setExchangeControl 对无 session 项目 P2025 → 500（与 sendMessage 默认 OPEN 处理不一致）
- 归档 hallMessages `findMany` 无分页（大会内存/时延风险）
- OpeningHallMessage/ReadCursor 无 FK → 项目删除孤儿行、dangling 引用
- 实时层依赖进程内连接表，多副本部署失真（水平扩容前须加 socket.io-redis adapter）
- 无门户线索时 token 回退 `token_web` 优先（残留误判风险，现实概率低——与 S9/C1 修复一并收口）
- setExchangeControl 监督日志在事务外（控制态已切但留痕可失败）
- createQuestion DTO 过松（无 IsNotEmpty/MaxLength/消毒，与大厅消息处理不一致）
- 离线兜底通知 `.catch(()=>{})` 静默吞错；gateway 缺省 online 恒空集 → 总发兜底
- presence/unread 不校验项目存在（返回空而非 404）
- confirm/dispute `updateMany` 命中 0 行仍置状态（无记录可确认却"已确认"）；dispute 不要求已解密（与 confirm 口径不一）
- 2000 截断按 UTF-16 码元切 → 切断 emoji 代理对 / 实体中间（与 S4 一并修）

**前端**
- 自动滚底无"在底部"判断，打断上翻阅读；ChatPanel 收 PRIVATE 消息也滚公聊列表
- 签到状态不回显：刷新后已签到仍见"签到"按钮，再点照弹"签到成功"（提示失真）
- onDecryptStatus 与 profile 加载竞态（页面打开瞬间到达的本司解密事件被丢弃）
- loadUnread 覆写在途 socket 增量（角标少计）
- 时间格式四处混用（toLocaleTimeString 无日期跨天歧义 / toLocaleString / dayjs）——建议 shared 工具函数
- 三套设计语言（Tailwind slate 实色 / oklch 品牌 / Element 灰蓝），与 `.impeccable.md` 拟态体系相悖
- 死代码：open/page.tsx 不可达分支、未用 Eye 导入、无 setter useState、ChatPanel 未用 supplierName prop、MyBids 未消费 icon 字段、`useReportRealtime`+`BidRealtimeContext` 整条无消费者
- 消息气泡三份拷贝（ChatPanel/drawer/supervision 各一，着色规则微差）
- projectId 一次性 const 捕获（当前安全、未来脆弱）
- handleWithdraw 不捕获 ElMessageBox cancel → unhandled rejection
- 监督日志 key 不稳定（载荷无 id + index 移位 → 整列重挂载、同毫秒 key 碰撞）
- drawer 无遮罩/ESC/焦点管理；唱标录入模态点外部即关、无放弃确认
- host 输入框无 maxLength（服务端静默截断"缺尾巴"）
- 取消判定过宽（`includes('close')` 可能吞掉含 close 字样的真实错误）
- socket 握手不带 X-Portal extraHeaders（同域生产部署下端口区分失效的理论残留）
- `portalURL` 硬编码 `http://`（https 部署混合内容——平台既有问题）
- join ack 从不检查（被拒后 socket"已连接"却永无事件，UI 无感知）
- 倒计时窗口终态缺失（remaining≤0 横幅消失而非"已关闭"；进度环固定 30 分钟基准）
- switchTab markRead 静默 catch；审计端 `.catch(()=>{})` 使 403 与"无消息"不可区分
- openingHallApi 全 `<any>`（shared 已有类型可复用）
- 历史只取 100 条无"加载更多"（nextCursor 未消费）
- OpeningConfirm 过渡页闪一帧纯文本

**规格审计专属缺口**
- §8.1 缺阶段时间轴/倒计时/PresenceBar 组件化（视觉信息密度低于规格 ASCII 图）
- §8.2 花名册缺"已签到/在线/离线"三态（仅两态）；确认/异议无对应供应商行高亮
- §5.1 撤回留痕机制整体缺位（SYSTEM 枚举零写入——如需撤回语义，加 HOST-only 端点写 SYSTEM 行引用原消息 id）
- §6.1 载荷缺 `type` 字段（当前恒 TEXT，迭代二加 VOICE 时需补，建议现在随契约带上）
- §4.2 成员门每次 join 查两次 DB（socket.data 已缓存身份未复用——性能层面）
- §5.6 ReadCursor 种子为空数组（演示完整性）
- 归档含聊天记录无 E2E 断言

---

## §5 既有/并行工作线条目（不计入迭代一问题，仅登记）

- 主持页解密单条 `catch {}` 静默（`open/page.tsx:246-247`）+ 批量 `allSettled` 内层 catch 使"部分失败韧性"成死逻辑——迭代一之前的页面代码
- resolveDispute 前端无 try/catch、无防重（`open/page.tsx:228-236`）——既有
- WS CORS（S9）、portalURL http 硬编码——平台既有
- **并行工作线**（本地未推送 9 commits：C1-C6 阶段棘轮 + Phase 2/3 指挥中心）：
  - 交互点：C2 允许阶段跳步直推 OPENING（不组建会话、不发 opening:started）→ 大厅 `stage==='OPENING'` 门控先于 opening:started 事件可用，与规格"自 opening:started 起可用"语义偏移（影响轻微）
  - MsgList 重挂载问题在其重构后的 `supervision-view.tsx` 依然存在
  - CLAUDE.md 门户地图已由并行工作线更新（:3007 改纯开标执行终端、阶段棘轮说明）

---

## 修复波次建议

| 波次 | 内容 | 理由 |
|---|---|---|
| **Wave 1 · 安全** | C1（WS 认证兜底）+ S1（专家跨项目门控）+ S7（markRead 门控）+ S10 对应用例补齐（首要"无 cookie 连 WS"负用例） | 实时通道越权窃听，上线即风险 |
| **Wave 2 · 存证** | S2（哈希链）+ S3（CSV）+ S4（消毒改纯文本）+ S5（空消息 400）+ S6（非法输入 400） | 开标存证完整性——本功能的核心价值主张 |
| **Wave 3 · 明显故障** | C2（抽屉 portal）+ C3（更新器副作用）+ R1（表刷新）+ R2（hydrate 合并）+ U1（IME）+ U7（失败卡死） | 用户可感的硬故障 |
| **Wave 4 · 实时健壮性** | R3-R10 + U2-U6、U8-U11 | 边界场景与体验完整性 |
| **Wave 5 · 打磨 + 决策** | P2 各组 + **S8 host 角色范围（待您决策）** + 规格审计专属缺口 | 非阻塞项 |
