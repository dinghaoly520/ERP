# 全系统操作日志（OperationLog）— 设计文档

- **日期**：2026-07-15
- **状态**：草案，待用户 review
- **作者**：brainstorming 会话产出
- **关联分支**：`feat/standard-scorepoints`（实现时建议另开 `feat/operation-log`）

---

## 1. 背景与目标

### 1.1 现状（已核实）

- 已有 `AuditLog` 模型（`apps/api/prisma/schema.prisma:1149`）：字段为 `userId / action / resourceType / resourceId / details(Json) / ipAddress / userAgent / createdAt`，按 `[userId, createdAt]`、`[action, createdAt]` 建索引，`AuditService` 有 90 天 `@Cron('0 3 * * *')` 定时清理（`apps/api/src/audit/audit.service.ts:33`）。
- 但它是**手动散点记录**：只有认证类（`LOGIN`/`LOGOUT`/改密码等，在 `auth.controller.ts:95/117/161`）和个别业务点（`bid.service.ts` 的阶段流转/解密、`budget.service.ts`、`expert-admin.service.ts`、`supplier-portal.service.ts`）主动 `prisma.auditLog.create()`。**绝大多数普通操作（列表查询、详情查看、评分提交等）并不记录。**
- **没有任何全局拦截器**自动记录请求：`app.module.ts:94-96` 只有三个全局 Guard（`AuthGuard` / `RolesGuard` / `ThrottlerGuard`），没有 `APP_INTERCEPTOR`。
- 现有「看全部活动」权限只放给 `admin`（`apps/api/src/auth/auth-scope.ts:11` `canViewAllUserActivity`），但 **`admin` 在种子数据里无用户**（管理端实际登录用 `bid_host`「陈主任」）。
- 另有窄场景的 `BidSupervisionLog`（开标监督端，`schema.prisma:461`，字段 `role/target/action/result/riskFlag`），与本次「全量操作留痕」是两回事，互不影响。

### 1.2 目标

1. **全量留痕**：整个系统所有门户、所有角色的**每一次 API 操作**从登录起都被详细记录，不依赖业务代码手动埋点。
2. **零侵入**：通过一个后端全局拦截器一刀切覆盖，业务接口增删改都不影响日志采集。
3. **详细且安全**：记录方法/路径/查询参数/请求体/状态码/耗时/IP/UA/门户等；请求体自动脱敏（凭证全屏蔽、个人信息部分掩码），不沉淀明文密码/密钥。
4. **可追溯**：已登录操作 100% 能定位到人；匿名访问以 IP+UA+时间兜底，并通过现有 `LOGIN` AuditLog 与登录后的人关联。
5. **可查询**：提供查询 API（管理员查全部、用户查自己），供后续前端界面接入。

### 1.3 非目标（YAGNI）

- **不做前端导航埋点**：本轮只做后端拦截器；前端「点了哪个页面」的导航埋点作为后续增强。
- **不做运营级日志大屏/后台界面**：本轮只到「后端记录 + 查询 API」层；独立界面单独排期。
- **不做语义映射层**：不把 `/api/bid/score` 翻译成「专家评分提交」这类中文动作名。接口仍在变动，语义层等稳定后作为独立增强（只读 `OperationLog` 原始记录，不碰拦截器）。
- **不做值正则识别**：脱敏只按字段名匹配，不做裸手机号/身份证正则识别（会误伤订单号/流水号等长数字）。
- **不改 BullMQ 异步队列**：本轮直接同步 fire-and-forget insert；体量过大时后置改队列。
- **不碰现有 `AuditLog`**：两者并行，`AuditLog` 继续承担手动埋点的关键审计事件。

---

## 2. 数据模型 `OperationLog`

新建表（`apps/api/prisma/schema.prisma`），不复用 `AuditLog`。

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `String @id @default(cuid())` | 主键 |
| `userId` | `String?` | 操作者 id；未登录为 `null` |
| `username` | `String?` | 冗余存储，查询免 join；匿名为 `null` |
| `role` | `String?` | 角色；匿名记 `'anonymous'` |
| `portal` | `String?` | 来自 `X-Portal` 头（`web`/`expert`/`bid`/`supplier`/`mall`/`public`/`assistant`） |
| `method` | `String` | `GET`/`POST`/`PUT`/`PATCH`/`DELETE` |
| `path` | `String` | 请求路径，如 `/api/bid/projects` |
| `query` | `String?` | query string，截前 2KB |
| `body` | `Json?` | **脱敏后**的请求体，截前 4KB |
| `statusCode` | `Int` | 响应状态码 |
| `durationMs` | `Int` | 耗时（毫秒） |
| `ipAddress` | `String?` | 客户端 IP（`getClientIp`） |
| `userAgent` | `String?` | UA，截前 512 字符 |
| `referer` | `String?` | 来源页 |
| `error` | `String?` | 4xx/5xx 时记简要错误，截前 1KB |
| `createdAt` | `DateTime @default(now())` | 时间 |

**索引**（6 个）：
- `@@index([userId, createdAt])` — 按用户查
- `@@index([createdAt])` — 时间范围、清理
- `@@index([role, createdAt])` — 按角色筛
- `@@index([portal, createdAt])` — 按门户筛
- `@@index([path, createdAt])` — 按接口筛
- `@@index([statusCode, createdAt])` — 筛异常（4xx/5xx）

**关键决策**：
- **不加 `userId` 外键**：`userId` 可能为 `null`（匿名）；且留痕场景要求「用户被删后历史日志仍可查」，故只存字符串、不做关联约束。需要人名时读冗余 `username` 字段或手动 join `User`。
- **存储预估**：按 10 万条/天 × 180 天 ≈ 1800 万条，PG 可扛；如未来过大可后置按月归档/分表，**本轮不做**。

---

## 3. 全局拦截器 `OperationLogInterceptor`

NestJS 全局拦截器，一处接入、覆盖所有路由（含 `@Public` 匿名请求）。新建模块 `apps/api/src/operation-log/`。

### 3.1 注册与执行顺序

- 在 `AppModule` providers 注册 `{ provide: APP_INTERCEPTOR, useClass: OperationLogInterceptor }`。
- `AuthGuard` 是 `APP_GUARD`，**在拦截器之前执行**——拦截器直接读 `req.user`（已解出的 `AuthenticatedUser`）：已登录拿到 `userId/username/role`，未登录（`@Public` 或未认证）则 `req.user` 不存在 → `userId=null, role='anonymous'`。

### 3.2 执行流程（每个请求）

```
请求进入
 ├─ 读 req：method/path/query/body引用/ip/UA/referer/portal(portalFromRequest)
 ├─ 读 req.user（若存在）：userId/username/role   ← AuthGuard 已挂好
 ├─ start = Date.now()
 ├─ next.handle()  →  真实业务处理
 ├─ 成功：RxJS tap → 拿 res.statusCode + duration，异步落库
 └─ 异常：catchError → 记录 error + 状态码(从异常提取) + duration，再 rethrow
```

两路都走 **fire-and-forget**：`operationLogService.create(...)` 返回的 Promise **不 await**，只挂 `.catch(err => logger.warn(...))`。日志写入失败绝不影响业务响应、不抛进主流程；记录逻辑整体 `try/catch` 包裹。

### 3.3 模块文件

| 文件 | 职责 |
|------|------|
| `operation-log.module.ts` | `@Global`，导出 `OperationLogService`，由 `AppModule` 注册拦截器 |
| `operation-log.interceptor.ts` | 拦截 + 字段提取 + `tap`/`catchError` 触发记录 |
| `operation-log.service.ts` | 封装 `prisma.operationLog.create`（fire-and-forget 调用）+ 查询方法 + `@Cron` 清理 |
| `operation-log.controller.ts` | 查询 API（见 §5） |
| `sanitize.util.ts` | 递归脱敏 + 部分掩码（见 §4） |
| `operation-log.filter.ts` | 白名单排除规则（见 §4） |

### 3.4 已知边界

`/api/auth/login` 是 `@Public`，拦截器执行时 `req.user` 尚不存在，故该条记录 `userId=null`（只能记到 IP + body 里的 username，密码已脱敏）。真正的「谁在何时登录」由现有 `auth.controller` 的 `LOGIN` AuditLog（带 userId）覆盖——两者互补，不丢信息。其余已认证接口不受影响。

---

## 4. 脱敏与过滤规则

### 4.1 脱敏（`sanitize.util.ts`）

- **按字段名匹配**（key 小写后 `includes` 敏感词），递归处理对象/数组/嵌套。
- **凭证类（强制，值 → `***`）**：`password / pwd / token / secret / apikey / api_key / authorization / kmssecret / kms / privatekey / captcha / verificationcode / smscode`。
- **个人信息类（部分掩码，保留可识别性）**：
  - 含 `phone / mobile / telephone` → 手机号掩码，保留前 3 后 4：`138****1234`。
  - 含 `idcard / idnumber` → 身份证掩码，保留前 6 后 4：`510102********1234`。
  - 含 `bankcard / cardno / bankaccount` → 银行卡掩码，保留前 4 后 4：`6222****1234`。
  - 值长度不足以掩码时回退为 `***`。
- 故意**不用** `key`/`pass`/`code` 等短词（会误伤 `monkey`/`statusCode`/`postalCode`）。
- **截断顺序**：先脱敏 → `JSON.stringify` → 超 `OPERATION_LOG_BODY_MAX_KB`（默认 4KB）截断（query 2KB / UA 512 / error 1KB）。

### 4.2 白名单排除（`operation-log.filter.ts`）

一个请求命中**任一**条件即不记录。

**① 确定性噪声（硬编码默认）**
- 非 `/api` 前缀（静态资源、Next 产物）
- `/api/docs`、`/api/docs-json`、`/api-json`（Swagger）
- `/socket.io/*`（WebSocket 握手/轮询）
- `/api/health`、`/api/healthz`（健康检查，若有）

**② 业务高频轮询（可配置清单 `OPERATION_LOG_EXCLUDE`）**
开标大厅、评分进度等前端轮询端点，初始填入已知项，**标注「随前端开发补充」**。实现期通过排查前端 `setInterval` / `setTimeout` 轮询与 socket.io 拉取调用（主要在 `bid-portal`、`expert-portal`）确定初始清单。匹配方式支持「字符串前缀」和「正则」两种。前端改轮询路径时只改 `.env`、不动代码。

### 4.3 配置项（`.env`，均有默认值）

| 变量 | 默认 | 用途 |
|------|------|------|
| `OPERATION_LOG_ENABLED` | `true` | 总开关，开发期可关 |
| `OPERATION_LOG_EXCLUDE` | 确定性噪声 | 追加排除路径（逗号分隔，支持正则） |
| `OPERATION_LOG_BODY_MAX_KB` | `4` | body 截断阈值 |
| `OPERATION_LOG_RETENTION_DAYS` | `180` | 保留天数 |

---

## 5. 查询 API（`operation-log.controller.ts`）

### 5.1 `GET /api/operation-log` — 查全部

- **权限**：`@Roles('admin', 'bid_host')`（监督端 `bid_host` 是日志主要消费者；`admin` 无种子用户故一并放开以利演示）。`procurement_staff` 本轮不放。
- **筛选参数（全部可选）**：

| 参数 | 说明 |
|------|------|
| `userId` / `username` | 精确 |
| `role` / `portal` / `method` | 精确 |
| `path` | 模糊匹配（`contains`） |
| `statusCode` | 精确；或 `statusClass=success\|client\|server`（2xx/4xx/5xx） |
| `keyword` | 搜 `path` + `query` 两字段 |
| `startTime` / `endTime` | ISO 时间范围 |
| `limit` / `offset` | 分页，默认 50、上限 100 |

- **返回**：`{ items, total }`，`items` 含全部字段（`body` 已脱敏，可安全返回），按 `createdAt desc`。

### 5.2 `GET /api/operation-log/my` — 查自己

- **权限**：任意已登录用户（`AuthGuard` 即可，无 `@Roles`）。
- 筛选同上，但 `userId` 强制锁定为当前用户，供专家端/管理端「个人中心」后续接入展示。

---

## 6. 清理、迁移、测试与实现顺序

### 6.1 定时清理

`OperationLogService` 加 `@Cron('0 4 * * *')`（错开 `AuditLog` 的 3:00），删除 `createdAt < now - OPERATION_LOG_RETENTION_DAYS` 的记录，失败只 `warn`。模式照搬 `AuditService.scheduledCleanup`。

### 6.2 Prisma 迁移

- `schema.prisma` 新增 `OperationLog` 模型（§2 字段 + 6 索引）。
- 非交互：`migrate dev --create-only` → `db execute` → `migrate resolve --applied`，或设 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1`。
- `pnpm db:generate` 重生成 client。

### 6.3 测试策略

| 层 | 内容 |
|----|------|
| 单元 | `sanitize.util.spec.ts`（字段名脱敏 / 部分掩码格式 / 嵌套递归 / 截断）；`operation-log.filter.spec.ts`（白名单命中与放行）；`operation-log.service.spec.ts`（查询筛选、分页、时间范围） |
| 验证 | 拦截器为全局副作用，单测覆盖核心逻辑即可；另写一个 e2e 断言「打一个接口后 `OperationLog` 多一条、`body` 已脱敏」 |

### 6.4 实现顺序（build sequence）

1. Prisma 模型 + 迁移 + `db:generate`
2. `sanitize.util.ts` + spec
3. `operation-log.filter.ts`（白名单 + 读 `.env`）+ spec
4. `operation-log.service.ts`（create + 两个查询 + `@Cron` 清理）
5. `operation-log.interceptor.ts`（`tap`/`catchError` + fire-and-forget）
6. `operation-log.controller.ts`（`@Roles('admin','bid_host')` + `/my`）
7. `operation-log.module.ts`（`@Global`）→ `AppModule` 注册 `APP_INTERCEPTOR`
8. `.env` 补 4 个配置项（§4.3）
9. 单测 + e2e + 手动验证

### 6.5 性能边界（本轮不做、未来可演进）

每请求一次 DB insert（fire-and-forget、非事务）。PG 单机每秒数千 insert 无压力；若日后量大可改走 BullMQ 异步队列（同 `AiBidAnalysis` 套路）——**本轮直接同步 insert**，避免过度设计。
