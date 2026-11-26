# 后端日志完善设计（控制台 + :3005 操作日志页面）

- 日期：2026-11-26
- 状态：已批准（2026-11-26）
- 范围裁定：2026-11-26 用户选「乙」——控制台（`docker logs`）与采购管理工作台「系统健康 → 操作日志」页面一并完善

## 1. 为什么做

管理员排查和日常查看时，后端日志看不出**谁**（哪个账号）、**在哪个节点**、**做什么**，手机号等信息被打码。样本是用户 2026-11-26 贴出的生产控制台日志。

现状根因（均已对代码核实）：

| # | 现象 | 根因 |
|---|------|------|
| 1 | 请求行只有「方法 路径 状态 文案」，方括号里恒为 `HttpExceptionFilter` | `apps/api/src/common/filters/http-exception.filter.ts:346-348` 只拼这四项；方括号里是报告人，不是出事的位置 |
| 2 | 成功的请求控制台一行都没有 | 同上只打 4xx/5xx；成功请求只落 `OperationLog` 表 |
| 3 | 没有用户、门户、IP、耗时 | 过滤器行里没取；且 `AuthGuard` 在会话校验**之后**才挂 `req.user`（`apps/api/src/auth/auth.guard.ts:96`）——被顶下线、冻结、角色与端口不符的 401/403，连库里都只记成匿名 |
| 4 | OCR、LLM 重试这些业务日志和请求对不上 | 没有请求号，各 logger 各打各的 |
| 5 | WS 行的用户是一串 `user:cmwj0…` | 网关直接打 `payload.sub`（cuid） |
| 6 | 页面「错误信息」显示 `Unauthorized Exception`、`Bad Request Exception` | `buildLogEntry` 在过滤器把异常翻成中文**之前**就取了 `exception.message` |
| 7 | 手机号等被打码 | `apps/api/src/operation-log/sanitize.util.ts` 写库时掩码；`notification/channels/sms.channel.ts` 控制台行掩码（等保三级 + 密评整改，2026-10） |
| 8 | 生产里 DEBUG 刷屏 | 已装的 Nest 11.1.24 **不读任何日志级别环境变量**（`LOG_LEVELS` 在该版本只是导出的常量名），默认六级全开，只能靠代码关 |
| 9 | 页面角色显示英文、门户下拉含已下线的「采购商城」、没有中文动作 | `apps/web/src/components/admin/health/operation-log-tab.tsx` |
| 10 | 短信验证码、评标室口令、回执令牌今天以明文进库 | `CREDENTIAL_KEYS` 按键名子串匹配，盖不住裸键名 `code`（`auth/dto/login.dto.ts:30`、`verification.controller.ts`、`upload.controller.ts:50`、`expert/expert.controller.ts:335`），也盖不住查询串里的回执令牌 `?t=` 与邀请码 `?code=`（`supplier/rsvp.controller.ts:25,41`、`expert/expert.controller.ts:172,256`、`supplier/supplier.controller.ts:144`）。控制台一旦打印参数摘要，这些还会上屏 |

现状数据（开发库 `OperationLog`，2026-10-28 ～ 11-26，79,960 行）：

- GET 2xx 占 91.9%；写操作（POST/PUT/PATCH/DELETE）6.8%；4xx/5xx 2.1%。
- 单个角标轮询 `GET /api/supplier/approvals/my-pending-count` 占 38.3%（30,660 行），它不在轮询排除表里。
- 接口带 `@ApiOperation` 中文摘要的：838 个里 583 个（70%）；按流量加权，80% 的请求落在带摘要的接口上。

## 2. 目标

- **G1 统一行格式**：所有日志行统一前缀（时间、级别、进程、请求上下文）。现有 554 处 `this.logger.*` 调用与 32 处裸 `console.*` 调用，一行不改。
- **G2 每个请求一行**：成功 INFO、4xx WARN、5xx ERROR，带操作人、门户、IP、动作、状态、耗时、原因；失败行附参数摘要。
- **G3 请求号贯穿**：同一请求内的业务日志自动带同一请求号与操作人；响应头回传 `X-Request-Id`。
- **G4 身份尽早记录**：守卫验签成功即记下身份，被顶下线、冻结、角色端口不符的 401/403 也看得出是谁；WS 行显示姓名而不是 cuid。
- **G5 页面可读**：每行回答「谁、从哪来、做什么、结果如何」；中文角色、中文动作、请求号、真实错误原因；加「只看失败」「只看写操作」「IP」筛选。
- **G6 明文开关**：手机号、身份证、邮箱、银行账号默认明文，一个开关恢复打码；密码、令牌、验证码任何时候都不记录。
- **G7 生产默认不输出 DEBUG/VERBOSE**，可用环境变量调。
- **G8 噪音治理**：角标轮询纳入轮询排除表。

## 3. 非目标与反目标

**非目标（本次不做，需要时另提）**

- 集中式日志（ELK/Loki）、结构化 JSON 输出、日志落盘文件与轮转（docker 日志驱动属部署侧，见第 9 节）。
- 页面实时刷新、在页面里看控制台实时日志。
- ai-worker、定时任务、队列任务的**日志内容**（只统一行格式与进程名）。
- `AuditLog`（业务审计表）不动。
- 补全全部 838 个接口的中文摘要（只补高频缺口，见附录 B）。
- 各门户前端的报错提示里展示请求号（本次只在响应头与错误响应体里提供）。
- 过期或伪造令牌的请求仍记匿名（只在验签完全成功时记录身份）。
- 存量日志行不回填（旧行无请求号、无动作名、仍打码）。
- 错误响应体不加字段（请求号只走响应头），对外响应契约一个字节不动。
- 双信封上传体里的 `envelope`、`signature`、`signP7`（`supplier-portal.controller.ts:553,589`）是投标数据，今天已入库，要不要掩码不在本次范围，另行裁定。

**反目标（做到这样算失败）**

- 日志里出现密码、令牌、验证码、短信验证码、口令、私钥的明文。
- 轮询和 DEBUG 把控制台刷满，淹没真正要看的行。
- 日志任何一步出错影响了请求本身（沿用现有口径：记录失败只告警，不抛出）。
- 破坏法定留存：迁移动了分区表的主键或分区结构，或归档流程受影响。
- 借机改动鉴权语义：`AuthGuard` 的拒绝条件与顺序一个不许变。

## 4. 约束

- **生产库是金仓**，`OperationLog` 是按月 RANGE 分区的法定留存表。给它加字段只能手写迁移（`ALTER TABLE … ADD COLUMN`），禁止用 `prisma migrate diff` 重新生成该表（会试图改回单列主键）。迁移须同时兼容 PostgreSQL 16（CI、开发副本）与金仓 PG 模式。
- **部署顺序**：迁移必须先于新代码启动（现有铁律）。新代码会写新字段，列不存在时报 P2022。
- **Nest 11.1.24**：自定义日志器必须 `extends ConsoleLogger`；`@nestjs/swagger` 11.4.4 的包导出表不开放深层路径，读不到 `DECORATORS` 常量，只能用字面量键。
- **并行会话**：实现须在隔离 worktree 里做。2026-11-26 核对时 `main` 没有未提交的受跟踪改动，另有两个 worktree 在跑：`.worktrees/pmi-pending`（`feat/pmi-pending`）与 `.worktrees/b1-c3-minors`（`fix/b1-cluster3-minors`）。`schema.prisma` 与 `app.module.ts` 属共享高危文件，合回前先看这两个分支有没有动它们。
- **共用 Prisma 客户端**：worktree 之间 `node_modules` 是软链共享的，`prisma generate` 会影响对方。生成前后要核对生成的客户端与自己的 schema 一致。
- **现有测试契约**：e2e「login 请求 password 被脱敏」「受保护路由无 token → 401 并被补记（role anonymous）」继续成立；「已认证请求被记录、body 已脱敏」按新开关语义改写。

## 5. 方案比较

**范围**（用户已选）

| 方案 | 内容 | 取舍 |
|------|------|------|
| 甲 | 只改控制台 | 全在后端一处，页面不动 |
| **乙（已选）** | 控制台 + :3005 操作日志页面 | 多一块前端与一条迁移，但「谁在哪做什么」在页面上也可查可筛 |

**控制台怎么改**（设计者代定）

| 方案 | 做法 | 取舍 |
|------|------|------|
| **A（采用）** | 自定义日志器 `extends ConsoleLogger` + 请求上下文（`AsyncLocalStorage`） | 一次接入，554 处现有调用全部继承新格式；请求内的业务日志自动带请求号与操作人 |
| B | 只加一条访问日志中间件（类 morgan） | 更省事，但业务日志仍是孤行，WS 行仍是 cuid，「节点」只能到路径一级 |
| C | 换结构化 JSON 日志（pino） | 适合接日志平台，但 `docker logs` 里人读更费劲，改动面也大 |

**页面数据从哪来**（设计者代定）

| 方案 | 做法 | 取舍 |
|------|------|------|
| **A（采用）** | `OperationLog` 加一个可空 JSON 列 `meta`，写请求时落请求号、处理器、动作名 | 干净、可扩展（以后加字段不用再迁移）；需要一条迁移；旧行没有这些信息 |
| B | 新建一张「请求轨迹」表 | 与法定留存表并存两套口径，页面要合两个数据源 |
| C | 不改表，读的时候拿路径去反查路由表 | 旧行也能有动作名，但匹配脆弱、路由一变就错，请求号仍然没处放 |

## 6. 设计

「设计者代定」的条目是我的判断，批准时请重点看。

### 6.1 统一行格式

```
<时间> <级别> <进程>[@节点] <请求上下文> [模块] <消息>
```

改前（用户贴的样本）：

```
[Nest] 1  - 11/26/2026, 10:32:20 AM    WARN [HttpExceptionFilter] POST /api/auth/login 401 - 用户名或密码错误
[Nest] 1  - 11/26/2026, 10:29:45 AM   DEBUG [NotificationGateway] 拒绝已轮换会话的 WS 连接 QP3Ddd94EfV5L5YYAAFN → user:cmwj0vf6m2qd6p101cp53dvba
[Nest] 1  - 11/26/2026, 10:33:38 AM     LOG [DocumentParserService] Using OCR for PDF analysis...
```

改后（同一批请求；姓名与 IP 为示意）：

```
2026-11-26 10:32:20.331 WARN  api [req=4be10a77] 匿名 10.60.3.17 → 用户登录 POST /api/auth/login 401 6ms [UNAUTHORIZED] 用户名或密码错误 参数={"username":"Swhi-CGZX-05","password":"***"}
2026-11-26 10:29:43.018 WARN  api [req=9c21d3f0] 王强(Swhi-CGZX-05·员工)@采购管理端 10.60.3.17 → 获取当前用户信息 GET /api/auth/me 401 3ms [SESSION_REPLACED] 该账号已在其他设备登录，请重新登录
2026-11-26 10:29:45.000 DEBUG api [ws=QP3Ddd94] 王强(Swhi-CGZX-05·员工)@采购管理端 [NotificationGateway] 拒绝已轮换会话的 WS 连接
2026-11-26 10:33:38.205 INFO  api [req=3ab9e0c1] 李敏(中科院成都信息技术股份有限公司·供应商)@供应商门户 10.60.3.25 [DocumentParserService] Using OCR for PDF analysis...
2026-11-26 10:33:38.206 INFO  api [req=3ab9e0c1] [OcrService] OCR cache hit (pdf)
2026-11-26 10:33:38.381 INFO  api [req=3ab9e0c1] 李敏(中科院成都信息技术股份有限公司·供应商)@供应商门户 10.60.3.25 → 证件识别 POST /api/ocr/intake 200 1430ms
2026-11-26 10:29:43.900 WARN  api [LlmService] LLM 第 1/5 次尝试失败（DeepSeek LLM network error: connect ECONNREFUSED 182.140.248.155:443），558ms 后重试
2026-11-26 10:34:02.010 INFO  ai-worker [TenderProcessor] 任务 1234 开始
```

规则：

- **时间**：`YYYY-MM-DD HH:mm:ss.SSS`，进程本地时区（生产容器 `TZ=Asia/Shanghai`，即北京时间；美式 12 小时制去掉）。
- **级别**：定宽 5 字符：`INFO` `WARN` `ERROR` `DEBUG` `VERBOSE` `FATAL`。
- **进程**：`api`（`main.ts` 启动时传入）或 `ai-worker`（worker 入口传入）。设了环境变量 `LOG_NODE` 则带节点名，如 `api@生产`。
- **请求上下文**：只在请求或 WS 连接内出现，格式 `[req=请求号] 身份[@门户] [IP]`。
  - 身份：`姓名(账号·角色)`；姓名与账号相同或没有姓名时只显示 `账号·角色`；没有身份显示 `匿名`。
  - 门户、IP：取得到才带。角色与门户用中文（名单见附录 A）。
  - WS 连接用 `[ws=连接号]`，没有 IP 时省略。
- **模块名**：保留现有的 `[OcrService]`，它回答「在哪个位置」。
- **请求完成行**（带 `→` 的行，每个请求一行）：

  ```
  → <中文动作> <方法> <路径>[?查询串] <状态> <耗时>ms [<错误码>] <原因>[ 参数=<摘要>]
  ```

  - 成功：`INFO`，不带错误码、原因、参数。
  - 4xx：`WARN`，带错误码、原因、参数摘要。
  - 5xx：`ERROR`，第一行同上（原因用对外中文文案），其后照旧跟原始错误与堆栈。
  - 参数摘要：脱敏后的请求体前 300 字，与写库用同一份脱敏结果，不重复遍历。
  - 动作名为空（接口没有摘要也没登记）时省略这一段。
- **净化**：路径、查询串、参数摘要里的控制字符（ESC 等）转义，换行保留；路径与查询串合计超过 500 字截断。防日志注入。
- **着色**：终端 TTY 下保留 Nest 的级别着色，非 TTY 纯文本。
- 实时性：请求完成行在该请求结束时打印，所以排在它触发的业务日志**之后**；按请求号搜才是一个请求的完整过程。

实现：`AppLogger extends ConsoleLogger`，覆盖 `printMessages` 与 `formatMessage`，经 `NestFactory.create(AppModule, { logger })` 传入。已核实：这样接入后，每个 `new Logger('模块名')` 的调用都会把模块名作为末位参数送到同一个实例，现有调用点零改动。

**不经 Logger 的 32 处裸 `console.*`**（`knowledge/knowledge.service.ts` 9 处、`supplier/supplier.service.ts` 3 处、`common/office-to-pdf.util.ts` 3 处等，共约 15 个文件）：设计者代定，在两个进程入口（`main.ts`、worker 入口）接管全局 `console.log`、`info`、`warn`、`error`、`debug`、`trace`，转交同一格式器输出。理由：其中 18 处在请求路径上（知识库、工作安排、供应商链路的报错），正是出错时最需要知道「谁触发的」那些行；而逐处改写会铺开到十几个文件，其中有并行会话常改的大文件。

- 级别对应：`error` → ERROR，`warn` → WARN，`log` 与 `info` → INFO，`debug` 与 `trace` → DEBUG。
- Nest 自带的日志器直接写输出流、不经 `console`，不会递归；反过来，`AppLogger` 内部不得调用 `console.*`。
- 接管只发生在两个进程入口，单测里被监视的 `console.*` 不受影响。
- `ca/ca-verification.service.ts:103` 的 `[CA-DEBUG]` 今天用 `console.error` 输出，生产关了 DEBUG 也照打。本次只给它加前缀，不改级别与内容（CA 线另有会话在改）。

### 6.2 请求上下文与身份

- **存储**：模块级 `AsyncLocalStorage<LogContext>`，上下文形状：
  `{ requestId, startedAt, identity?: { userId, username, role, displayName? }, portal?, source?, ip? }`。
- **中间件**：每个请求生成 8 位十六进制请求号（服务端生成，不信任入站头），写 `X-Request-Id` 响应头，把请求号、进入时刻、门户（`portalFromRequest`）、来源（`x-portal-source`）、IP（`getClientIp`）放进上下文后在上下文内放行。
  - 经 `AppModule` 的 `NestModule.configure` 以 `forRoutes('*')` 注册，不在 `main.ts` 里手挂——这样 e2e（`Test.createTestingModule` 直接 `init`）与生产走同一条链路。
- **身份何时记下**：`AuthGuard` 在验签成功、查到用户之后**立刻**记下身份（`payload.sub`、`payload.username`、`payload.role`，外加同一次查询里的 `displayName`），然后才做启用、冻结、会话、改密、角色端口各项校验。
  - 改动只限两处：`select` 加 `displayName`；验签后写一次日志身份。拒绝条件与顺序不动。
  - 写的是模块级存储，不给 `AuthGuard` 增加构造依赖（它是全局守卫，加依赖要动模块作用域）。
- **身份也入库**（设计者代定）：验签成功后记下的身份，同样写进库表的 `userId`、`username`、`role` 三列，不只用于控制台。否则页面上被顶下线的行仍然是「匿名」，按用户筛选也找不到。
  - 三列的含义由「已认证的主体」变为「请求所持令牌对应的账号」。
  - 新带上身份的被拒行有四类：账号被冻结、会话被顶替、改过密码、临时账号失效。角色与端口不符的 403 今天就已经带身份。
  - 三个既有读端会开始在原来空白的被拒行上显示账号：法定归档留痕导出（`archive/approval-trail.exporter.ts`）、归档审计视图（`archive/archive.controller.ts`）、监督时间线（`bid/bid.service.ts`）。行上的状态码不变，读端照旧可以据此区分被拒与成功。
  - **连带修正一处**：个人中心「上次修改密码时间」取的是 `/operation-log/my` 里路径含 `/auth/password-change-requests` 的最新一行，且不看状态码（`apps/web/src/components/profile/tab-basic-info.tsx:87`）。这次之后，被顶下线的失败提交也会归到本人名下，所以该查询补上既有的 `statusClass=success` 参数。
- **耗时**（设计者代定）：从请求进入中间件起算。今天被守卫拒绝的行耗时恒为 0。
- **错误响应体不动**：请求号只走响应头。
- **WS**：通知、开标大厅、聊天三个网关在握手验签成功后，把连接号与身份写入日志上下文，再打日志。身份取 JWT 里的 `username`、`role`；姓名只在网关本来就查库的那条路径上顺带取，不为日志新增数据库查询。现有日志级别不变。
- **非请求上下文**（启动、定时任务、ai-worker）：没有请求上下文段，只有时间、级别、进程。

### 6.3 请求完成行与噪音规则

沿用操作日志现有的排除表（`operation-log.filter.ts`：心跳、各门户轮询、健康检查、文档页、socket.io）。

| 请求类别 | 控制台 | 库表 |
|----------|--------|------|
| 不在排除表 | 成功一行 INFO；失败一行 WARN 或 ERROR | 照记 |
| 在排除表（轮询等） | 成功不打；失败打一行，**不带参数摘要** | 不记（同今天） |

排除表里有两条 POST 正是因为请求体敏感才不入库（`supplier-portal` 的解密上传带着唱标承诺随机数、评分草稿），所以排除表路由的失败行一律不带参数摘要，查询串照打（按 6.8 掩码）。

- 打印点两处，共用一个纯函数排版，互不重复：
  - `OperationLogInterceptor`：请求过了守卫之后的成功或失败，在这里打印并置标志。
  - `HttpExceptionFilter`：标志没置（守卫拒绝、路由不存在、排除表里的失败）才打印。
- 环境变量 `HTTP_ACCESS_LOG=off` 可关掉请求完成行，库表照记。
- 排除表新增 `GET /api/supplier/approvals/my-pending-count`（方法限定，与 `/api/notifications/unread-count` 同类）。

### 6.4 错误原因统一

把过滤器里「异常 → 状态码、错误码、中文文案」的映射抽成纯函数，三处共用：响应体（行为不变）、请求完成行、库表 `error` 列。

- `error` 列改存 `[错误码] 中文原因`。
- 5xx 且不是 `HttpException` 时，后面追加原始错误消息（保留现有的排障信息，如 Prisma 调用错误文本）。
- 异常没带错误码时，日志里按状态码给通用码：400 `BAD_REQUEST`、401 `UNAUTHORIZED`、403 `FORBIDDEN`、404 `NOT_FOUND`、409 `CONFLICT`、429 `TOO_MANY_REQUESTS`、其余 `INTERNAL_ERROR`。**只用于日志，响应体的 `code` 不变**（如登录失败的响应仍是 `INTERNAL_ERROR`，改动它属于接口契约变更）。
- 错误原文不新增脱敏逻辑，维持现状。

### 6.5 库表新增 `meta`

`schema.prisma` 的 `model OperationLog` 加 `meta Json?`。迁移手写一条：

```sql
ALTER TABLE "OperationLog" ADD COLUMN IF NOT EXISTS "meta" JSONB;
```

分区父表加列会自动下发到各月分区；新建分区由现有 `PARTITION OF` 语句继承。归档的 `SELECT *` 自然带上它。旧行为 `null`，旧代码忽略该列，可回退。

`meta` 形状：

```json
{
  "requestId": "3ab9e0c1",
  "handler": "OcrController.intake",
  "route": "/api/ocr/intake",
  "action": "证件识别",
  "source": "mobile-3011"
}
```

- `handler`：控制器类名.方法名。
- `route`：路由模式（`/api/bid/projects/:id`），便于按接口聚合。
- `action`：中文动作名，来源见 6.6；没有则省略。
- `source`：仅当请求带 `x-portal-source` 时记录（移动驾驶舱自报 `mobile-3011`，它的门户名是 `web`，靠这个区分）。

**元信息在哪取**：加一个排在守卫链最前、恒放行的全局守卫，请求一进来就把 `handler`、`route`、`action` 挂到请求对象上。原因：被守卫拒绝的请求（401、403、429）不经过拦截器，而过滤器拿不到执行上下文；恰恰是这些行最需要知道「想做什么」。它不是鉴权守卫，命名与注释须写明。

### 6.6 「操作」中文名来源

按顺序取，取到即止：

1. **纠偏表**（新文件，一份清单）：`方法 + 路由模式` → 中文名。用于没有摘要、摘要是英文、或摘要过长过技术化的接口。首批条目见附录 B。
2. **接口自带的 `@ApiOperation` 摘要**：用字面量键 `'swagger/apiOperation'` 经 `Reflector` 读（约束见第 4 节）；用一条单测把这个键钉在真实的 `@ApiOperation` 装饰器上。
3. 都没有：控制台省略动作名，页面显示 `控制器.方法`。

不批量改 838 个控制器去补摘要（改动面铺得太大，也增加并行会话的合并冲突）。摘要是接口中文名的正式出处，新接口照常写摘要即可。

### 6.7 明文开关与谁能看到明文

环境变量 `LOG_PII_MASK`（设计者代定：运行期逐次读取，便于测试里切换）：

| 取值 | 手机号、身份证、邮箱、银行账号 |
|------|------------------------------|
| `true` | 打码（同今天） |
| 未设或其他（**默认**） | 明文 |

- **默认明文是设计者代定**，依据是用户明确要求可见。后果须知情：上线后，生产的操作日志**表**及其 15 年归档（MinIO 上的 gz 文件）也会开始明文保存这些信息；控制台输出同理。等保或密评测评前把开关置 `true` 即恢复打码。这只影响新写入的行。
- **服从开关的出口**（穷举）：
  1. 写库的请求体；
  2. 请求完成行的参数摘要；
  3. 短信控制台行四处——通知轨 `notification/channels/sms.channel.ts` 两处、验证码轨 `verification/sms-provider.ts` 两处。
- **不服从开关、维持原样的**：
  - `NotificationDeliveryLog.phoneMasked` 列。它是对账定位用的，表上注明「PII 不落明文」。`sms.channel.ts` 里同一个打码函数的返回值既上屏又落库，只能放开上屏那一半，落库的值继续打码。
  - 返回给前端的 `maskedPhone`，以及 `common/pii-mask.ts` 那一套管理端列表、详情、导出的掩码。
- 查询串的掩码规则见 6.8。
- **谁能读到明文**（设计者代定）：只有 `admin`。
  - `admin` 调 `GET /operation-log` 与 `GET /operation-log/my`：按库里的原样返回。
  - 其他角色（`bid_host` 查全量、各角色查「我的」）：读的时候重新打码，看到的与改造前一致。理由：这些请求体里可能有别人填进来的手机号、身份证，不是「本人自视自己的资料」。
  - 重新打码须幂等：库里已是掩码的旧值要原样返回（邮箱的掩码值不含 `@`，直接再打一次会变成 `***`）；被截断成预览文本的请求体也要盖得住。

### 6.8 凭证键补全

凭证类字段不受开关影响，恒为 `***`。现有 `CREDENTIAL_KEYS` 按键名子串匹配，有第 1 节第 10 行那个缺口。不补的话，新的控制台行会把短信验证码和回执令牌直接上屏，所以这次一并补上（设计者代定）。

- **全局凭证键**：现有清单不动。
- **新增「按路由登记的敏感键」**：裸键名 `code` 不能全局掩码（公司编码、项目编码也叫 `code`），所以按「方法 + 路由模式」登记。写库与控制台共用同一份规则，库表 `query` 列因此也不再明文存回执令牌。
- **首批登记**：

  | 方法与路由 | 请求体键 | 查询串键 | 内容 |
  |-----------|---------|---------|------|
  | `POST /api/verification/verify-registration-code` | `code` | | 短信验证码 |
  | `POST /api/verification/check-registration-code` | `code` | | 短信验证码 |
  | `POST /api/auth/mobile/login` | `code` | | 短信验证码 |
  | `POST /api/upload/registration` | `code` | | 短信验证码 |
  | `POST /api/expert/projects/:projectId/room-code/verify` | `code` | | 评标室口令 |
  | `GET /api/supplier/rsvp/verify`、`POST /api/supplier/rsvp/respond` | | `t` | 回执令牌 |
  | `GET /api/expert/rsvp/verify`、`POST /api/expert/rsvp/respond` | | `t` | 回执令牌 |
  | `GET /api/supplier/invitations/verify` | | `code` | 邀请码 |

- **今后的规矩**（写进 CLAUDE.md 注记）：新增承载验证码、口令、令牌的请求字段，不论键名叫什么，都要在这份登记里加一行。

### 6.9 日志级别

环境变量 `LOG_LEVELS`（逗号分隔，取值 `log` `warn` `error` `fatal` `debug` `verbose`，无效项忽略）：

| 环境 | 默认输出 |
|------|----------|
| `NODE_ENV=production` | `log` `warn` `error` `fatal` |
| 其他（开发、测试） | 六级全开（同今天） |

### 6.10 页面改造（:3005 系统健康 → 操作日志）

表格由 10 列收成 6 列，一行回答「谁、从哪来、做什么、结果如何、何时」：

```
操作                                │ 用户                 │ 来源                  │ 状态 │ 耗时  │ 时间
用户登录                            │ 王强                 │ 采购管理端            │ 401  │ 3ms   │ 11-26 10:29:43
POST /api/auth/login                │ Swhi-CGZX-05 · 员工   │ 10.60.3.17            │      │       │
────────────────────────────────────┼──────────────────────┼───────────────────────┼──────┼───────┼──────────────────
获取当前用户信息                    │ 王强                 │ 移动驾驶舱            │ 200  │ 12ms  │ 11-26 10:31:06
GET /api/auth/me                    │ Swhi-CGZX-05 · 员工   │ 10.60.3.17            │      │       │
```

- **操作**：第一行中文动作名（没有则显示 `控制器.方法`，灰色）；第二行方法徽标 + 路径，超长省略，悬停显示完整路径与查询串。旧行没有动作名时只有第二行。
- **用户**：第一行姓名（没有则账号，都没有显示「匿名」）；第二行 `账号 · 角色中文`。角色中文用 `apps/web/src/lib/role-labels.ts` 的 `ROLE_LABELS`，不在本页另写一份；那份表没有 `anonymous`，本页对匿名做一处兜底即可。控制台的角色名与它同词（附录 A）。
- **来源**：第一行门户中文；`meta.source` 是 `mobile-3011` 时显示「移动驾驶舱」。第二行 IP。
- **状态**：状态码着色不变；第二行请求号，点击复制（复制用门户自带的 `copy-to-clipboard.ts`，按真实结果提示；成功提示语带一句「可到控制台按此号搜索」）。旧行显示 `—`。
- **耗时、时间**：不变。
- **展开详情**：查询串、参数（请求体）、处理位置（`控制器.方法` + 路由模式）、请求号、Referer、User-Agent、错误（`[错误码] 原因`）。
- **筛选栏**：
  - 新增「IP」输入框（精确匹配）。
  - 新增两个开关：「只看失败」（状态码 ≥ 400）、「只看写操作」（POST/PUT/PATCH/DELETE）。
  - 角色下拉显示中文；门户下拉去掉「采购商城」。
- **导出 txt**：每行增加动作名与请求号。

接口侧（`GET /operation-log`）新增查询参数 `ip`、`failed`、`writesOnly`，返回的每行多一个 `meta` 字段。均为加法。

页面视觉沿用现有 cgzxui 设计体系，不引入新样式。

### 6.11 ai-worker

worker 入口用同一个日志器，进程名 `ai-worker`。日志内容不改。

## 7. 环境变量一览

| 变量 | 默认 | 作用 |
|------|------|------|
| `LOG_LEVELS` | 生产 `log,warn,error,fatal`；其余全开 | 输出哪些级别 |
| `LOG_PII_MASK` | 未设（明文） | `true` 时手机号等打码 |
| `HTTP_ACCESS_LOG` | 开 | `off` 关闭请求完成行 |
| `LOG_NODE` | 无 | 节点名，带在进程名后 |
| `OPERATION_LOG_ENABLED` / `OPERATION_LOG_EXCLUDE` / `OPERATION_LOG_BODY_MAX_KB` | 不变 | 现有开关 |

生产 `.env.backend` 没有新增必填项。

## 8. 测试与验收

**自动化**

- 单测：
  - 行格式与净化、级别过滤、上下文存取、裸 `console.*` 接管（级别对应、带上下文、空调用不出行）。
  - 请求完成行排版（成功、4xx、5xx、无身份、被守卫拒绝、排除表路由不带参数摘要）。
  - 异常描述映射；对外响应体与改造前逐键相等。
  - 开关两种取值下的脱敏：手机号等随开关，凭证恒 `***`。
  - 按路由登记的敏感键：上述路由的请求体 `code`、查询串 `t` 与 `code` 均为 `***`，其他路由的 `code`（公司编码）不受影响。
  - 读端按角色打码，含幂等（旧掩码值原样返回、截断预览也盖住）。
  - 元信息守卫、动作名三级来源、`swagger/apiOperation` 键钉死、新增查询参数、耗时从中间件起算。
- e2e（`operation-log.e2e-spec.ts` 扩写）：`meta` 落库（请求号、处理器、动作名）；`X-Request-Id` 响应头；`LOG_PII_MASK=true` 时手机号掩码，默认明文；密码与短信验证码两种取值下都是 `***`；回执令牌在 `query` 列是 `***`；被顶下线的 401 行三列带身份；非 `admin` 读到的是掩码。
- `npx prisma validate` 通过；`npx prisma migrate status` 干净；迁移在金仓与 PostgreSQL 两边都能重放。

**开发环境实走**

1. 控制台对照 6.1 的样例：匿名 429、登录失败、被顶下线 401、一次成功写操作。按请求号搜索，能串起该请求的业务日志。
2. 被顶下线那行能看到姓名与账号，页面上该行也显示是谁。
3. WS 行显示姓名。
4. 一行不经 Logger 的裸 `console.*` 输出（比如触发一次知识库上传失败）带着请求号与操作人。
5. 页面：六列布局、中文角色与动作、请求号复制、三个新筛选、admin 看到明文而 `bid_host` 看到掩码；个人中心「上次修改密码时间」仍显示成功那一次的时间。
6. ai-worker 的行带进程名。

## 9. 部署注意

- 迁移先行，再起新镜像（现有铁律，`backend.sh` 已是先迁移后启动）。
- 建议在生产 run compose 里给 `api`、`ai-worker` 加日志轮转（如 `json-file`，`max-size=50m`、`max-file=5`）。现在没有上限，请求行增多后更需要。这是部署侧配置，不在本仓库改动范围内，由用户决定。
- 可选：生产 `.env.backend` 加 `LOG_NODE=生产`，日志行会显示 `api@生产`。

## 10. 留给实现者决定

- 新代码的目录与文件拆分（建议新建 `apps/api/src/logging/`，`operation-log/` 下的拦截器、服务、脱敏原地修改）。
- `AppLogger` 覆盖 `printMessages` 还是分别覆盖 `formatPid` 与 `formatMessage`。
- 元信息守卫、中间件、纯函数的具体命名。
- 读端重新打码的实现方式（对截断体的预览文本也要生效）。
- 导出 txt 里新增两列的位置。
- 纠偏表首批条目的最终措辞（附录 B 给的是路由清单）。

## 附录 A：角色与门户中文名

| 键 | 中文 |
|----|------|
| `admin` | 管理员 |
| `leader` | 领导 |
| `staff` | 员工 |
| `bid_host` | 开标主持 |
| `bid_expert` | 评审专家 |
| `supplier` | 供应商 |
| `anonymous` | 匿名 |
| `web` | 采购管理端 |
| `supplier` | 供应商门户 |
| `expert` | 专家门户 |
| `bid` | 开评标端 |
| `public` | 信息门户 |
| `assistant` | 水叮当助手 |
| `mobile-3011`（来源） | 移动驾驶舱 |

角色六个词与 `apps/web/src/lib/role-labels.ts` 的 `ROLE_LABELS` 逐字一致（该表在工作台里被五处页面引用，是现行口径），控制台与页面对同一个角色不出现两种写法。

## 附录 B：纠偏表首批路由清单

开发库流量最高的无摘要接口，以及摘要不可用的接口（请求数为 2026-10-28 ～ 11-26 的统计）：

| 请求数 | 方法与路由 | 情况 |
|-------|-----------|------|
| 2,476 | `GET /api/project-management` | 无摘要 |
| 1,146 | `GET /api/user-settings` | 无摘要 |
| 1,001 | `GET /api/work-arrangements` | 无摘要 |
| 920 | `GET /api/work-arrangements/daily-plan` | 无摘要 |
| 460 | `GET /api/supplier-portal/status` | 无摘要 |
| 414 | `GET /api/time` | 无摘要 |
| 368 | `GET /api/supplier-portal/bid-projects` | 无摘要 |
| 350 | `GET /api/work-arrangements/portrait` | 无摘要 |
| 310 | `GET /api/project-management/project-attributions` | 无摘要 |
| 265 | `GET /api/supplier-portal/profile` | 无摘要 |
| 245 | `GET /api/platform-push/pending` | 无摘要 |
| 234 | `GET /api/expert/projects/:id` | 无摘要（三个控制器各有一份） |
| 205 | `GET /api/supplier-portal/award-letters` | 无摘要 |
| 201 | `POST /api/tender-sample` | 无摘要 |
| 197 | `GET /api/supplier-portal/contracts` | 无摘要 |
| 176 | `GET /api/supplier-portal/dashboard-stats` | 无摘要 |
| 169 | `GET /api/expert/projects` | 无摘要 |
| 149 | `GET /api/expert/profile/contact-check` | 无摘要 |
| 203 | `GET /api/opening-hall/:id/messages` | 无摘要 |
| 99 | `POST /api/work-arrangements/daily-plan/refresh` | 无摘要 |
| 98 | `GET /api/procurements` | 无摘要 |
| 97 | `GET /api/expert/projects/:id/my-scores` | 无摘要 |
| 91 | `GET /api/supplier-portal/bid-projects/:id` | 无摘要 |
| 423 | `GET /api/knowledge` | 摘要为空（只有描述） |
| 372 | `GET /api/tender-review/rules` | 摘要是英文（`List compliance rules`） |
| 168 | `GET /api/tender-review/review/stats/today` | 摘要文本有转义残缺 |
| 128 | `GET /api/expert-admin/demand-rep-directory` | 摘要为空 |
