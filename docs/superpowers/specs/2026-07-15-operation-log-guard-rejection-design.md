# 操作日志补记 guard 拒绝请求 — 设计文档

- **日期**：2026-07-15
- **状态**：草案，待用户 review
- **作者**：brainstorming 会话产出
- **关联分支**：`feat/operation-log`（在已合并的 operation-log 功能之上做后续项 1）
- **前置 spec**：`docs/superpowers/specs/2026-07-15-operation-log-design.md`

---

## 1. 背景与目标

### 1.1 现状（已核实）

operation-log 功能用一个全局 `OperationLogInterceptor`（`APP_INTERCEPTOR`）记录每次请求。但 **NestJS guard 先于 interceptor 执行**：受保护路由上被 `AuthGuard`(401)/`RolesGuard`(403)/`ThrottlerGuard`(429) 拒绝的请求，interceptor 根本不会运行，因此**这些请求没有被记录**。

- 唯一例外：`@Public` 路由（如 `/api/auth/login`）跳过 guard，interceptor 会跑 + `catchError` 记录（失败登录 401 已覆盖）。
- 既有 `HttpExceptionFilter`（`apps/api/src/common/filters/http-exception.filter.ts`）是 `@Catch()` 全局过滤器，在 `main.ts:46` 用 `app.useGlobalFilters(new HttpExceptionFilter())` **手动实例化、不走 DI**，只负责把异常标准化成 `{ statusCode, code, error, timestamp, path }` 响应，不写 `OperationLog`。

### 1.2 目标

让被 guard 拒绝的请求（401/403/429）也被记入 `OperationLog`，与现有 interceptor 记录**零重复、零遗漏**。

### 1.3 非目标（YAGNI）

- 不为 guard 拒绝的请求精确计算耗时（`durationMs` 记 0）——不为获取"请求开始时间"额外加一个全局 middleware。
- 不改 `OperationLog` 表结构（复用现有字段：`statusCode`/`role`/`userId`/`error` 等）。
- 不改成功请求与 controller 异常的记录路径（interceptor 已覆盖）。

---

## 2. 设计

### 2.1 去重机制（核心）

请求级标志 `(req as any).__oplogRecorded`（字符串键）：

- `OperationLogInterceptor` 在 `tap`（成功响应）和 `catchError`（controller 抛出的异常）记录后，都置 `req.__oplogRecorded = true`。
- `HttpExceptionFilter.catch()` 在标准化响应**之前**检查：若 `req.__oplogRecorded` **未设**，则记录一条 `OperationLog`。

这恰好区分三种路径，无重复：

| 路径 | interceptor | 标志 | filter | 结果 |
|------|-------------|------|--------|------|
| 成功请求 | `tap` 记录 | 设 true | 不经过 | 1 条（interceptor） |
| controller 异常（400/500 等） | `catchError` 记录 | 设 true | 经过但跳过 | 1 条（interceptor） |
| guard 拒绝（401/403/429） | 不运行 | 未设 | 记录 | 1 条（filter） |

### 2.2 `HttpExceptionFilter` 改造

- **DI 化**：从 `main.ts` 的 `app.useGlobalFilters(new HttpExceptionFilter())` 移除，改为在 `app.module` 的 providers 注册 `{ provide: APP_FILTER, useClass: HttpExceptionFilter }`，构造注入 `OperationLogService`（`OperationLogModule` 为 `@Global` 且已 `exports: [OperationLogService]`，可注入）。
- `catch(exception, host)` 中，在现有标准化响应逻辑**之前**插入：
  - 读 `req`；若 `OPERATION_LOG_ENABLED !== 'false'` 且 `!req.__oplogRecorded`：
    - `statusCode = exception instanceof HttpException ? exception.getStatus() : 500`
    - 用共享的 `buildLogEntry(req, statusCode, 0, exception, bodyMaxBytes)` 构建条目
    - `service.create(entry).catch(e => logger.warn(...))`（fire-and-forget，失败只 warn）
    - 置 `req.__oplogRecorded = true`（幂等防御）
  - 然后执行**原有**的标准化响应逻辑（`response.status(status).json({...})`）与控制台 `logger.warn/error`，完全不变。
- `bodyMaxBytes` 同 interceptor：`(Number(process.env.OPERATION_LOG_BODY_MAX_KB) || 4) * 1024`，构造时读取一次。

### 2.3 `buildLogEntry` 提取共享

当前 `buildLogEntry` 定义在 `operation-log.interceptor.ts`。提取到新文件 `operation-log/log-entry.util.ts`（纯函数，签名不变：`(req, statusCode, durationMs, error, bodyMaxBytes) => OperationLogEntry`）。`operation-log.interceptor.ts` 改为从该 util import。`HttpExceptionFilter` 也 import 它。脱敏（`sanitizeBody`/`sanitizeQueryString`）、IP 提取（`getClientIp`）、portal 推断（`portalFromRequest`）逻辑随之复用，不重复。

### 2.4 guard 拒绝记录的字段处理

- `statusCode`：从异常取（HttpException `.getStatus()`，否则 500）。
- `role` / `userId`：401（AuthGuard 拒绝、无有效 token）→ `req.user` 不存在 → `anonymous` / `null`；403（RolesGuard 拒绝、有 token 但无权）→ AuthGuard 已通过、`req.user` 存在 → 真实 `role` / `userId`。`buildLogEntry` 现有逻辑已覆盖这两种情况。
- `durationMs`：记 `0`（filter 无请求开始时间，guard 拒绝耗时无意义）。
- `error`：异常 message（如 `Unauthorized` / `Forbidden`），由 `buildLogEntry` 截断至 1KB。
- `body`：`sanitizeBody(req.body)`——guard 拒绝前 Express body parser 已解析，照常脱敏。

### 2.5 `OperationLogInterceptor` 配套改动

`intercept()` 中 `tap` 与 `catchError` 的 `record()` 内，调用 `service.create(entry)` 后追加 `req.__oplogRecorded = true`（仅一行）。

---

## 3. 测试

| 层 | 内容 |
|----|------|
| 单元 | `log-entry.util.spec.ts`（从 `operation-log.interceptor.spec.ts` 迁移现有 `buildLogEntry` 用例 + 补"无 user(401 场景) → anonymous"等）；新增 `http-exception.filter.spec.ts`：mock `OperationLogService` + 构造带/不带 `__oplogRecorded` 的 req，验证「标志未设 → create 被调一次 + 标志被置」「标志已设 → create 不被调」「标准化响应仍正确发出」 |
| e2e | 新增 case：受保护路由（如 `GET /api/operation-log`）**不带 token** → 期望 401 → 等待 fire-and-forget → 断言 `OperationLog` 多一条 `{ method:'GET', path:'/api/operation-log', statusCode:401, role:'anonymous', userId:null }`。这是原本漏掉、本次补上的关键场景 |

回归保证：`auth/bid/upload` 等既有 e2e 都触发错误路径，DI 化后它们仍应通过，证明错误响应格式 `{ statusCode, code, error, timestamp, path }` 不变。

---

## 4. 风险与控制

- **动到核心错误过滤器**：`HttpExceptionFilter` 从手动 new 改 DI 注册。风险是错误响应格式回归。控制：既有 e2e（多个触发 4xx/5xx）+ 新增 e2e 覆盖；DI 注入 `OperationLogService` 解析依赖（全局 provider）已确认就绪。
- **filter 写入失败**：fire-and-forget + `.catch(warn)`，不影响错误响应。
- **标志键碰撞**：`__oplogRecorded` 为内部约定键，与业务 body 无关（挂在 req 上不进 DB），碰撞风险可忽略。
