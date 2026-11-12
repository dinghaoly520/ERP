# 平板配对不迁移——双端并存同步打分设计（TAB-SYNC-01）

日期：2026-11-12
状态：**已批准**（2026-11-12 用户设计评审通过，含 §4.1 合并语义修正与裁量 10 项）
票：TAB-SYNC-01（`docs/bugs/2026-11-11-yuanguoyu/票修队列.md`）；连带关 bug#98（平板/web 不能同时登录——路线 B 多端并存实质采纳）
前置裁定：2026-11-12 用户撤销 bug#100 验收——「平板应为同步打分工具、台式机为主，非会话整体移交杀桌面」；09-22 迁移制（会话轮换杀桌面+闸4 直登 409）被推翻
前置基建：08-11 双端同步遗产（`981d4cf54` WS 自动合并+冲突弹窗、G3 草稿双槽、E 组 focus-hint）——代码完好，现行模型下为死路径，本设计复活其为主通道

## 1. 背景与问题

现行迁移制（2026-09-22）：桌面评分步签发 90s 迁移票 → 平板 `/tablet/claim` 密码重证领取 → `rotatePortalSession` 会话轮换 → **桌面 401 `SESSION_REPLACED` 死亡**。后果：

1. **双端并存被结构性封死**：闸4（`auth.service.ts:644`，签到→报告确认窗口内已有活动会话则新登录 409 `ACCOUNT_EVALUATING`）拦第三方，也拦本人第二台设备；迁移是唯一入口且以杀桌面为代价。
2. **同步基建成死路径**：同一专家无法双端在线 → `onDraftSaved` 跨设备合并、`SyncConflictModal` 冲突弹窗、focus-hint 定位链（桌面发→平板收）全部不可达。
3. **平板落地页横幅失实**（`(tablet)/tablet/page.tsx:58`）：「评分实时同步至桌面端 · 请在桌面端审阅并提交」——迁移后桌面已死，无从审阅提交；专家回桌面须平板登出或找主持人解锁再重登。
4. **「平板仅存草稿」无后端强制**：靠平板页没有提交 UI 兜着；平板持完整专家会话 token，直调 `submitScores` 后端不拒。
5. `onDraftSaved` 两端均未过滤 `expertId`（`expert.controller.ts:593` 广播全房，客户端只按 device 过滤）——并存复活后跨专家噪音放大。

## 2. 目标 / 非目标 / 反目标

**目标**
- 桌面保持唯一全量会话在线；平板以**受限配对身份**并存（不轮换会话、不影响桌面）。
- 平板写面 = 评分草稿 + 手写备忘 + focus-hint 确认；**正式提交/核对/报告/过程动作全归桌面**。
- 双端草稿实时同步：复活 08-11 基建为主通道（草稿双槽存储**零改动**，各写各槽、读时并集合并、本设备优先）。
- 防冒名强度不降：配对票据 90s 单次 + 密码重证（3 次烧票）+ 留档照补拍 + 监督留痕全保留。
- 闸4 对第三方全量登录行为不变。

**非目标**
- 不给平板提交权（用户裁定：台式机为主）。
- 不做反向「迁移」概念——配对可随时解除、随时重配，无「工位归属」语义。
- 不做多台平板并存（单专家单项目同时一台；换机=新配对替换旧配对）。

**反目标（做到即失败）**
- 平板领取配对的任何动作导致桌面会话失效。
- 受限令牌可调用任何提交类/过程类写端点。

## 3. 核心概念：配对（pairing）≠ 登录（session）

```
桌面 = 唯一全量会话（webSessionId + JWT sid 机制原样不动）
平板 = 挂在桌面会话上的受限凭证（scope=tablet-pairing，绑定 projectId/expertId，
       生命周期严格短于桌面会话：桌面轮换/登出 → 配对随 sid 失配自然死亡）
评标窗口（9-20 spec §2 定义：signedIn=true && reportConfirmed=false && stage∈{OPENING,EVALUATING}）
       → 窗口闭（报告确认/项目终态）→ 配对自动失效
```

## 4. 方案总览

```
桌面评分步「配对打分平板」(bug#100 入口重做)
   └─► POST /expert/projects/:id/pairing-ticket        90s 单次票（Redis 原子+并发锁）
          前置：EVALUATING + 核验三件套齐 + 口令已验 + 有活动会话（沿用迁移票前置）
平板浏览器 /tablet/pair?tk=…&projectId=…               （claim 页改配对语义，UI 复用）
   └─► POST /auth/expert-pairing/claim（@Public）
          票据单次 + 密码重证（3 次烧票）+ 票据绑定签发时 sid（桌面会话变了票作废）
          └─► 成功：签发受限 JWT（含桌面 sid，不轮换会话）+ Redis 配对登记 + 监督日志
双端并存：
   平板 存草稿 ──score-draft(device=tablet)──► BidExpert.scoreDraft.tablet 槽
        └─ WS DRAFT_SAVED 广播 ─► 对端拉合并草稿（合并语义见 §4.1 修正）
   桌面「去打分平板」──focus-hint(Redis 120s)──► 平板 2.5s 轮询定位+闪烁+ACK（复活）
   桌面 提交/核对/报告 —— 平板无入口，后端对受限令牌默认拒绝
```

### 4.1 草稿同步语义修正（复活的前提，P0——2026-11-12 二轮代码走查发现）

08-11 基建的合并语义有一个**从未被实跑暴露的缺陷**（该模型只存活 9 天即被闸4封死）：`getScoreDraft` 本设备槽优先合并（`expert.service.ts:2826`）× 自动保存从**全量 state** 构建 pending 草稿（tablet page:265 / desktop page:513）产生**回声**——对端经 WS 合并进来的键，2s 后被写进本设备自己的槽。推演（键 X）：

```
平板改 X=85 → 桌面合并(newItem) → 桌面槽回声 85
桌面改 X=75 → 平板拉取：tablet 槽 85 优先胜出 → 与本地相等 → 无冲突无更新（平板看不见 75）
平板再改 90 → 桌面拉取：desktop 槽 75 优先胜出 → 与本地相等（桌面看不见 90）
→ 同键被双端各改一次后永久分叉、互不可见，冲突弹窗触发条件（merged ≠ 本地）永不成立
```

**修正设计**（双槽存储/整槽覆写/提交等价过滤不动，只改合并与拉取判定）：

1. **per-entry `savedAt`**：草稿条目 `{score, reason, passed, points}` 增 `savedAt`（编辑时刻打点；跨设备合并拷贝**保留原值**——回声从此无害，新旧由时间戳裁决）。旧格式条目无 per-entry 时间戳 → 视为所属槽的顶层 `savedAt`（兼容回退）。
2. **服务端 merge 改逐键取 `savedAt` 新者**（替代本设备槽优先；时间戳相等时本设备优先 tiebreak）——`getScoreDraft` 是唯一改动点。
3. **客户端拉取三方判定**（last-synced 基线，ref map 记上次拉取值）：仅远端改动（本地 == 基线）→ 静默接受远端新值（现 newItems 路径推广到「值变但本地未动」）；双端都改动（本地 ≠ 基线 且 远端 ≠ 基线）→ **冲突弹窗**（真并发双编辑，票面④主通道语义成立）；仅本地改动 → 不动。
4. 刷新/重进：state 来自合并草稿恢复 → 基线即恢复值，自洽。

## 5. 受限令牌设计

### 5.1 JWT claims（沿用 `JWT_SECRET` 与 `JwtService` 签发）

```json
{ "sub": "<userId>", "username": "…", "role": "bid_expert",
  "sid": "<配对时刻桌面的 webSessionId>",
  "scope": "tablet-pairing", "pid": "<projectId>", "eid": "<bidExpertId>", "jti": "<pairingId>" }
```

- **必须携带 `sid`**：`auth.guard.ts:88` 对 expert 命名空间无 sid token 一律 401。携带桌面 sid 后，现有 `sid !== User.webSessionId → 401 SESSION_REPLACED` 校验（`auth.guard.ts:81`）**原样复用**——桌面他处重登（sid 轮换）或登出（webSessionId 清空）时，平板令牌自然失效，**零新增代码得到「配对随桌面会话死亡」语义**。
- `checkPortRole('bid_expert', 'expert')`（`auth.guard.ts:95`）通过；`iat` 早于改密拦截（`auth.guard.ts:77`）同样适用。
- TTL 12h（覆盖单日评标；到期重扫码）。**实现注记**：`auth.module.ts:19` signOptions 默认 `7d`——配对令牌必须 `jwt.sign(payload, { expiresIn: '12h' })` 显式覆盖，否则静默变 7d。

### 5.2 Cookie：复用 `token_expert` 命名空间

不下发新 cookie 名。收益：WS 握手 `tokenFromHandshake`、proxy、`portalFromRequest`、平板 layout 鉴权、`@water-erp/client` 全链路零改动；配对/全量身份仅靠 claims 里的 `scope` 区分，由服务端守卫集中裁决。

### 5.3 Redis 配对登记（吊销与单台约束）

```
expert-pairing:{jti}                → { userId, expertId, projectId, pairedAt, device }   TTL 12h
expert-pairing:active:{eid}:{pid}   → jti（单台约束：同专家同项目唯一活动配对）
```

- **吊销即删键**：AuthGuard 对 scoped token 增查 `expert-pairing:{jti}` 存活且 sub 匹配，miss → 401 `PAIRING_REVOKED`（解绑即时生效，不等 JWT 过期）。
- **单台替换**：claim 时若 `active` 键已有旧 jti → 删旧 `expert-pairing:{旧jti}`（旧平板下一次请求 401 `PAIRING_REVOKED`）→ 写新键，监督日志记「平板替换配对」。现场换机常见，替换优于拒绝。
- 窗口闭/项目终态不主动清键（Redis TTL 自然过期 + sid/报告锁定闸兜底，双保险足够）。

### 5.4 AuthGuard 改动（最小增量）

在现有校验全部通过后追加：`payload.scope === 'tablet-pairing'` → 查 Redis 登记 → 挂 `req.pairingScope = { projectId: pid, expertId: eid, pairingId: jti }`。**sid 校验、冻结、临时账号、改密、端口角色校验一行不动。**

## 6. 写面白名单（默认拒绝制）

新增全局 `PairingScopeGuard`（注册于 RolesGuard 之后）：`req.pairingScope` 存在且目标路由不在白名单 → 403 `PAIRING_SCOPE_FORBIDDEN`。**默认拒绝**，镜像 2026-08-26 RolesGuard default-deny 教训——新增专家端点若漏标注，平板侧自动被拒，不会出现「忘了拦」。

白名单集中单文件维护（`apps/api/src/expert/tablet-pairing.scope.ts`，方法+路径模式）：

| 类别 | 端点 | 说明 |
|---|---|---|
| 草稿写 | `POST /expert/projects/:id/score-draft?device=tablet` | 核心写面 |
| 备忘 CRUD | `POST/PATCH/DELETE /expert/projects/:id/memos*`、`GET …/memos/:memoId/ink` | 平板手写备忘是核心价值，必须保留；墨迹 PNG 走 memos multipart 本体（`expert.controller.ts:735` FileInterceptor），**不经 `/upload`** |
| 配对留档照 | `GET /expert/projects/:id/pairing-photo-status`、`POST /expert/projects/:id/pairing-photo`、`POST /upload?category=expert_signin_photo` | claim 成功后拍照发生在 **scoped 态**（现 claim 页时序即如此）——漏配白名单会把强制留档照死锁在配对流程内；`/upload` 限 `expert_signin_photo` 类目（类目级放行，非整端点放行） |
| 焦点确认 | `GET /expert/projects/:id/focus-hint` | 读取自带 ACK 副作用，放行 |
| 评标室口令 | `POST /expert/projects/:id/room-code/verify` | **二轮修正（原误列拒绝名单）**：口令轮换（P2-10）清 `roomVerifiedAt` 后平板一切写面 403，平板无法自验=假死到桌面重验；口令是专家口头获知的共享秘密，scoped 调用无提权，连错 3 次锁 10 分钟按 BidExpert 记（与桌面同权）；平板轮换 toast 文案改「请输入新口令重新验证」 |
| 澄清文件下载 | `POST /expert/projects/:id/clarification-docs/:docId/download` | 读形写法（流式直出+监督日志副作用），同 focus-ack 性质；漏配则平板能列澄清清单却打不开文件 |
| 会话维持 | `POST /auth/logout`、`GET /auth/heartbeat`、`GET /auth/me` | logout 是 §11 分流的前提；heartbeat 供平板 `SessionWatchdog` 15s 心跳——**被吊销的空闲平板 15s 内即得 401 出遮罩**（否则须等人工触碰）；me 供 layout 鉴权 |
| 只读全集 | `GET /expert/projects*`（详情/文档/解密标书/招标文件/谈判文件/澄清文件/quote-history/my-scores/score-history/disputes/motions/assist*）、`GET /expert/profile*`、`GET /expert/statistics`、`GET /expert/tasks` | 平板渲染所需；项目类端点受下述 pid 绑定约束 |
| WS | gateway 握手与 `join:project` | 见 §10 |

**pid 绑定（guard 层强制，非 UI 过滤）**：`PairingScopeGuard` 对路径含 `:projectId` 参数的 `/expert/projects/:projectId*` 路由，校验路由参数 === `req.pairingScope.projectId`，不匹配 → 403 `PAIRING_PROJECT_MISMATCH`。豁免（跨项目端点，无 projectId 参数）：`/auth/*`、`/expert/profile*`、`/expert/statistics`、`/expert/tasks`。`listProjects` 返回全量但服务层按 pairingScope 过滤（§8.3）——**enforcement 在守卫，UI 过滤只是体验**。

**显式拒绝（点名防回归）**：`submitScores`、`score-review/verify`、`report/confirm`、`esign`、动议发起/投票/关闭、异议工单、澄清发起、`sign-in`、`avoidance`、`agreements`、`ai-consent`、`pairing-ticket` 签发、一切非 expert 模块端点。（`room-code/verify` 二轮修正后**移入白名单**，见上表）

服务层收口（纵深）：`saveScoreDraft` 收到 `req.pairingScope` 时强制 `device='tablet'`（防桌面槽被平板覆写）。

## 7. 闸4 与登录矩阵（不变项）

| 场景 | 行为 |
|---|---|
| 第三方全量登录（窗口开） | **不变**：409 `ACCOUNT_EVALUATING` + 告警 |
| 平板全量登录（窗口开） | **不变**：409——错误文案（`auth.controller.ts:209`）由「如需更换设备请联系主持人解除锁定」增补配对引导：「评标期间请使用桌面端『配对打分平板』二维码」，否则专家在平板密码登录只看到「找主持人」 |
| 平板配对 claim | 免闸4（沿用迁移票论证：票据前置核验+密码重证承担身份绑定，`auth.service.ts:656` 注释），**不动 `webSessionId`** |
| 窗口未开（签到前） | 平板可全量登录（现行互踢语义不变）；此阶段无配对需求（配对票据前置要求核验全齐） |
| 桌面登出 | `webSessionId` 清空 → 平板令牌 sid 失配 401（登出端点同时删该用户全部配对键，卫生性清理） |
| 桌面他处重登 | sid 轮换 → 平板 401 `SESSION_REPLACED`（自然失效，重扫码） |

## 8. claim 流改造（pairing 语义）

### 8.1 端点重命名（删旧建新）

- `POST /expert/projects/:id/transfer-ticket` → **`POST /expert/projects/:id/pairing-ticket`**（签发逻辑沿用：EVALUATING + `signedIn && avoidanceConfirmed && aiConsentConfirmed` + 口令已验 + `webSessionId` 非空；90s 单次、Redis 原子、并发互斥锁、监督日志）
- `POST /auth/expert-transfer/claim` → **`POST /auth/expert-pairing/claim`**（沿用：票据单次并发锁、密码 3 次烧票、票据绑定 sid、临时账号复核、`@Throttle 10/min`——现值 auth.controller.ts:248；**差异唯二**：成功后不调 `rotatePortalSession`，改签发 §5.1 受限 JWT + Redis 登记；返回体 `{ access_token, role, username, projectId, photoRequired }` 形状不变，claim 页改动最小化）
- `GET /expert/transfer-ticket/:ticketId/status` → `pairing-ticket/:ticketId/status`（pending/paired/expired，桌面 QR 弹窗轮询复用）
- **新增** `GET /expert/projects/:id/pairing`（桌面全量会话专用）：返回活动配对 `{ device, pairedAt } | null`——桌面「已配对」徽章与解除按钮的数据源；`DELETE /expert/projects/:id/pairing` = 解除（§9.1）
- 旧 transfer 端点删除（不留兼容层——内部系统，claim 页同仓发布）。

### 8.2 留档照（保留，语义改「配对留档照」）

签到无照者配对后强制补拍：`transferPhotoPendingAt`/`transferPhotoExemptAt`/`transferPhotoExemptByName` 三列**复用不迁移**，`recordTransferPhoto`/`transferPhotoStatus` 端点保留（改名 `pairing-photo*`，守卫路径同步）；主持人豁免+5s 轮询解锁机制不变。

### 8.3 配对后平板落点

claim 成功 → 写 `token_expert`（scoped）→ 留档照环节（scoped 态，端点见 §6 白名单）→ 直接 302 `/tablet/evaluate/{projectId}`（跳过落地页）。平板落地页 `/tablet` 在 pairingScope 下仅渲染已配对项目（`listProjects` 服务层按 `req.pairingScope.projectId` 过滤）——这是体验层收口；**越权防线在 §6 的 guard 层 pid 绑定**（直链他项目 `/tablet/evaluate/{otherId}` 或持 scoped token 直调他项目端点 → 403 `PAIRING_PROJECT_MISMATCH`）。

## 9. 前端改造

### 9.1 桌面端（`(app)/evaluate/[id]/page.tsx`）

1. **入口重做（bug#100）**：评分步头部「迁移到打分平板」→「**配对打分平板**」；QR 弹窗轮询 `pending → paired`；**已配对态**常驻显示：设备摘要 + 配对时间 + 「解除配对」按钮（`DELETE /expert/projects/:id/pairing` → 删 Redis 键 + 监督日志；平板下一次请求 401 走 session-kick 遮罩回登录页）。
2. **`onDraftSaved` 补 `expertId` 过滤**：`d.expertId === project.myExpertRecord.id` 才拉取（现状任何专家存草稿都会触发白拉）。
3. **草稿合并语义改造**（§4.1）：拉取处理改三方判定（基线 ref map）、编辑打点 per-entry `savedAt`——`SyncConflictModal`/横幅 UI 组件零改动复用，但触发逻辑按 §4.1 重写；e2e 见 §12.2。
4. 迁移专属逻辑删除：`markTransferClaimed`（`transfer-claimed-flag.ts`，防「异地登录疑似冒用」误弹的补丁——配对制下桌面不再被踢，此补丁连同场景一并消亡）。

### 9.2 平板端（`(tablet)` + `(claim)`）

1. `(claim)/tablet/claim` → `(pair)/tablet/pair`：文案「迁移」→「配对」；密码重证、留档照、豁免轮询 UI 原样保留。**注意 `proxy.ts:109` 对 `/tablet/claim` 有 pathname 特判（匿名票据页先落 cookie 再弹回登录的逻辑）——路由改名须同步此分支**。
2. 页头注释与落地页横幅改为真实语义（配对制下「评分实时同步至桌面端」首次成真）：「已与桌面配对 · 评分实时同步，请在桌面端审阅并提交」。
3. **登出=解除配对**：平板「退出」按钮与 15min 空闲登出都走 scoped 分支——`POST /auth/logout` 服务端按 `scope` 分流（见 §11 关键规则），前端登出后回 `/login`。
4. `onDraftSaved` 补 `expertId` 过滤（同桌面）。
5. 评分页「平板从不提交评分」注释与行为不变；无提交/核对/报告 UI 不变。
6. **`PAIRING_REVOKED` 前端分流**：`api.ts on401` 现只认 `SESSION_REPLACED`/`ACCOUNT_FROZEN`（api.ts:24-25）——新增 `PAIRING_REVOKED` 分支：全屏遮罩「配对已解除或过期，请在桌面端重新生成配对码」+ 回登录页按钮（复用 session-kick 遮罩骨架）。`SESSION_REPLACED` 分支保留（桌面轮换/登出路径仍走它）。

### 9.3 主持端（:3007，监督可见性）

工位矩阵/专家确认面板「当前在线设备」扩展为两行：桌面会话（`User.sessionMeta`）+ 平板配对（Redis 登记快照：设备摘要/配对时间）。数据源：专家确认列表端点聚合时附带 active pairing（新只读字段 `tabletPaired: { device, pairedAt } | null`；现 sessionMeta 聚合点在 `bid.service.ts:3365-3387` 一带）。主持人远程解绑=Phase 2（现行走桌面端解绑，现场可行）。

## 10. WebSocket

- **双 socket 并存天然支持**：`join:project`（`bid.gateway.ts:242`）按 JWT + 专家身份入 `experts:{projectId}` 房，同 user 双 socket 无互斥；`rotatePortalSession` 的 `evictUser` 全驱逐仅在**全量登录**时触发——配对不轮换，不触发。
- **握手现状（评审纠正）**：`handleConnection`（`bid.gateway.ts:184-215`）**只做 `jwt.verifyAsync`，不比对 `payload.sid` 与 `User.webSessionId`**——存量行为即如此：桌面登出/他处重登后，旧设备的 bid-gateway socket 断线重连仍可成功（notification 网关有 evictUser 主动驱逐，bid 网关没有）。本设计 Phase 1 在 `handleConnection` 补两道连接时校验：
  1. **sid 一致性**（token 带 sid 且 `sid !== User.webSessionId` → 拒连）：顺手修复上述存量缺口，对全量与配对令牌一视同仁；
  2. **配对登记存活**（`payload.scope === 'tablet-pairing'` → 查 `expert-pairing:{jti}`，miss → 拒连）：吊销后的平板无法靠重连续命。
  已建立的存量 socket（吊销前连上的）Phase 1 不主动断——残留面仅「收同房间广播」（只读，且该设备吊销前本就在房内）；Phase 2 增 `pairing:revoked` 广播+主动断连。
- 平板 `useExpertWebSocket` 事件集不变（重连补拉/延期/口令轮换/重开/他人提交刷新/DRAFT_SAVED 合并全保留）。

## 11. 监督、审计与登出分流（关键规则）

1. **登出分流（本设计最重要的一条防误杀规则）**：`POST /auth/logout` 现按 `shouldRevokeSession`（token 带 sid 即清 `User.webSessionId`，`auth.controller.ts:316`）——配对令牌**带桌面 sid**，若不分流，**平板登出会清掉桌面会话**。改为：token 含 `scope=tablet-pairing` → 仅删 `expert-pairing:{jti}` + `expert-pairing:active:*`（本人该配对）+ 清 cookie + 监督日志「平板解除配对」，**不触碰 `webSessionId`**。
2. 监督日志事件（沿用迁移制格式，`bidSupervisionLog`）：配对码签发 / 平板配对成功（含设备摘要）/ 替换配对 / 解除配对（桌面主动/平板登出）/ 密码错（riskFlag=中）/ 烧票。原「工位迁移」日志文案停用。
3. 配对登记 Redis-only，不入 DB（审计走监督日志，模式同迁移票）；**无 Prisma schema 迁移**。
4. **操作日志排除补项（二轮走查）**：`POST /expert/projects/:id/score-draft` 不在 `DEFAULT_EXCLUDE_PATHS`（operation-log.filter.ts:13）——双端 2s 防抖自动保存各一写，OperationLog 翻倍且全是编辑噪音（真正的评分审计在 `BidScoreRecordHistory` 快照+监督日志，已完备）。补 `{ method: 'POST', path: /^\/api\/expert\/projects\/[^/]+\/score-draft$/ }`。

## 12. 测试

**单测**
- `PairingScopeGuard`：白名单放行 / 默认拒绝（构造 scoped 请求打非白名单路由 → 403 `PAIRING_SCOPE_FORBIDDEN`）/ pid 绑定（同 projectId 路由参数不匹配 → 403 `PAIRING_PROJECT_MISMATCH`，豁免端点不受限）。
- claim 服务：单次性（并发锁）、密码 3 次烧票、票据 sid 绑定（桌面会话轮换后票作废）、**不动 `webSessionId` 断言**、单台替换（旧 jti 被吊销）。
- logout 分流：scoped 登出后 `webSessionId` 不变 + Redis 键已删；全量登出行为不变。
- `saveScoreDraft` 服务层收口：pairingScope 强制 tablet 槽。

**e2e（`apps/api/test/`，沿用种子+cookie 认证）**
1. 配对全链：桌面签发票 → 平板 claim → 平板 `score-draft?device=tablet` 写 → 桌面 `GET score-draft?device=desktop` 读到合并值（§4.1 逐键最新语义）。
2. **同键再编辑回归（§4.1 缺陷防复发，关键用例）**：平板改 X=85 → 桌面拉取见 85 → 桌面改 X=75 → 平板拉取见 75（不得再回显 85）→ 平板改 X=90 → 桌面见 90。另一序列：双端在同步间隔内并发改 X → 后拉取的一端弹冲突弹窗（三方基线判定）。
3. 平板 `submitScores` → 403 `PAIRING_SCOPE_FORBIDDEN`；`confirmReport`/`verify` 同。
4. 桌面解除配对 → 平板下一请求 401 `PAIRING_REVOKED`。
5. 桌面登出 → 平板 401 `SESSION_REPLACED`（sid 失配路径）。
6. 平板登出 → 桌面会话**仍活**（`/auth/me` 200）——反误杀回归。
7. 闸4 不变：窗口内第三方全量登录仍 409 `ACCOUNT_EVALUATING`。
8. bug#98 场景：平板配对态 + 桌面全量态同时在线各自可操作。
9. pid 绑定：scoped token 直调非配对项目的 `GET /expert/projects/{otherId}` → 403 `PAIRING_PROJECT_MISMATCH`；配对项目同端点 200。
10. claim→留档照全链在 scoped 态可走：claim 成功（photoRequired=true）→ `pairing-photo-status` 轮询 → `/upload?category=expert_signin_photo` → `pairing-photo` 登记 → 进评审页。
11. WS 握手：吊销后平板 socket 重连被拒；桌面登出后旧设备 socket 重连被拒（sid 校验，连带修复存量缺口）。
12. heartbeat 白名单：scoped 态 15s 心跳 200；吊销后首个心跳 401。

**浏览器验收（有头）**：双视口（桌面+平板仿真）跑「平板改分→桌面冲突弹窗」「桌面 focus-hint→平板闪烁」两条 08-11 复活链路。**桌面与平板必须用两个独立浏览器 context**（原因见 §16.1——同浏览器 cookie 互踩）。

## 13. 删除清单（防遗留死代码）

- `POST /expert/projects/:id/transfer-ticket`、`GET /expert/transfer-ticket/:ticketId/status`、`POST /auth/expert-transfer/claim` 及 `claimExpertTransfer`/`claimExpertTransferLocked` 中轮换调用（保留可复用的票据/烧票/sid 绑定逻辑并入 pairing 实现）。
- 前端 `transfer-claimed-flag.ts`、`markTransferClaimed` 及迁移 QR 弹窗的「领取成功桌面已下线」文案分支。
- `(claim)/tablet/claim` 路由（改 `(pair)/tablet/pair`）。
- 迁移制文档口径（CLAUDE.md 专家门户章节「扫码工位迁移」段落随实施更新为配对制）。

## 14. 分期

- **Phase 1（本票实施范围）**：受限令牌 + AuthGuard 增量 + PairingScopeGuard + pairing claim/登出分流 + 桌面/平板 UI 改造 + expertId 过滤 + 监督日志 + 测试全量。
- **Phase 2（backlog，不阻塞验收）**：主持端远程解绑；WS 吊销即时断连广播；平板在线/离线实时徽章（现配对状态徽章不含在线判定）。

## 15. 本设计做出的裁量（评审重点确认项）

以下为设计过程中我拍的板，评审时请重点过目（均可改）：

| # | 裁量 | 理由 |
|---|---|---|
| 1 | 平板写面=草稿+**备忘**+focus-ack（票面「仅草稿写」的扩展解释） | 手写备忘是平板核心价值（墨迹+OCR+得分点绑定全套已建）；「仅草稿写」理解为「仅评审过程性暂存写，不含提交类」 |
| 2 | 单台配对，新配对**替换**旧配对 | 现场换机常见；拒绝式约束制造无谓的死锁场景 |
| 3 | 令牌=同命名空间 JWT + scope + Redis 登记，**不入 DB** | 复用全链路中间件；审计走监督日志（迁移票同模式）；零 schema 迁移 |
| 4 | 配对令牌 TTL 12h | 覆盖单日评标；sid 失配与吊销键才是真实失效面，TTL 只是兜底 |
| 5 | 窗口未开时平板走全量登录（互踢不变），窗口内配对为唯一入口 | 配对票据前置=核验全齐，签到前本就无配对需求 |
| 6 | Phase 1 不做 WS **主动断连**（已建立的存量 socket） | 残留 socket 仅「收同房广播」只读面；connect 时校验已掐断重连续命 |
| 7 | 端点直接重命名删旧，不留兼容 | 内部系统同仓发布；旧名与新语义（迁移≠配对）混用更危险 |
| 8 | **pid 绑定在 guard 层强制**（`/expert/projects/:projectId*` 路由参数 === 配对项目，豁免 profile/statistics/tasks/auth 等跨项目端点），非仅 UI 过滤 | 评审代理指出：仅 UI 过滤时持 scoped token 可直读他项目（含解密标书）——同主体（本人）虽本有桌面全量，但平板是现场独立物理设备，收窄爆破面与本库默认拒绝的一贯姿态一致 |
| 9 | **WS 握手 connect 时校验纳入 Phase 1**（sid 一致性 + 配对登记存活），主动断连留 Phase 2 | 评审纠正：现握手只 `verifyAsync` 不比 sid（存量缺口——登出/轮换后旧 socket 重连可活到 JWT 过期）；connect 校验两行改动同时修复存量缺口与吊销续命，性价比极高 |
| 10 | **草稿合并语义重设计**（§4.1：per-entry savedAt + 服务端逐键取新 + 客户端三方基线判定），而非原样复活 08-11 合并 | 二轮代码推演实证：原语义（本设备槽优先×回声）下同键双端再编辑=永久静默分叉、冲突弹窗永不触发——「原样复活」不成立，必须连同合并语义一起修；UI 组件仍复用 |

## 16. 边界与已知限制（业务流走查 2026-11-12 补）

1. **同浏览器双开不支持**：`token_expert` cookie 同浏览器全局唯一——若平板与桌面开在同一浏览器的两个窗口，pair 成功写 cookie 会把桌面 tab 的凭证**覆盖为 scoped token**，桌面全线 403（服务端桌面会话无恙，纯 cookie 互踩）。迁移制下同覆盖发生但桌面反正已死、无人察觉；配对制下必须显式声明：**平板须为独立设备，或同机独立浏览器 profile**。演示/验收/测试一律双 context。
2. **主持人 release-login-lock 的平板侧文案歧义**：解锁清 `webSessionId` → 平板 401 `SESSION_REPLACED` → 遮罩文案「该账号已在其他设备登录」——实际是主持人解锁，略歧义但可接受（与现行为一致，不改）。
3. **报告确认后配对不主动终结**： pairing 存活至 12h TTL，但平板写面已被 `SCORE_LOCKED`（草稿）与核对/报告端点默认拒绝收口；备忘保持开放=与桌面同权（2026-10-19 法定过程动作不冻结口径），只读浏览同桌面——接受。
4. **桌面提交后平板槽残留旧草稿会弹一次真冲突**（值不同时）：语义正确——报告确认前专家可改分重提，冲突弹窗让专家裁决，不是缺陷。
5. **15min 空闲超时=解配对**：平板空闲超时登出即解除配对，续用需桌面重新出码。三阶段预警弹窗（「继续评标」按钮）可保持在线，与现行为一致。
