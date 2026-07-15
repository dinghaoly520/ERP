# 操作日志补记 guard 拒绝请求 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让被 guard 拒绝的请求（401/403/429）也被记入 `OperationLog`，与现有 interceptor 记录零重复、零遗漏。

**Architecture:** interceptor 记录后置请求级标志 `req.__oplogRecorded`；把全局 `HttpExceptionFilter` 从 `main.ts` 手动 new 改为 DI 注册（`APP_FILTER`），注入 `OperationLogService`，在标准化响应前补记一条（仅当标志未设 = guard 拒绝、interceptor 未运行）。`buildLogEntry` 提取到共享 util，interceptor 与 filter 复用。

**Tech Stack:** NestJS 11（ExceptionFilter / APP_FILTER / DI）、RxJS、jest、supertest。

## Global Constraints

- 工作目录 `water-erp/`（worktree `/home/asus/桌面/ERP/.claude/worktrees/feat+operation-log` 下的子目录），API 在 `apps/api`。所有 `pnpm`/测试命令从 `water-erp/` 执行。
- 去重标志键：字符串 `(req as any).__oplogRecorded`。
- guard 拒绝记录的 `durationMs` 恒为 `0`（filter 无请求开始时间，不为精确耗时加 middleware）。
- `HttpExceptionFilter` 从 `main.ts` 的 `app.useGlobalFilters(new HttpExceptionFilter())` 移除，改为 `app.module` providers 的 `{ provide: APP_FILTER, useClass: HttpExceptionFilter }`；构造注入 `OperationLogService`（`OperationLogModule` 为 `@Global` 已 export，可注入）。
- 错误响应格式必须不变：`{ statusCode, code, error, timestamp, path }`。
- 每任务结束提交；commit message 中文，结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- 关联 spec：`docs/superpowers/specs/2026-07-15-operation-log-guard-rejection-design.md`。

---

## File Structure

| 文件 | 改动 |
|------|------|
| `operation-log/log-entry.util.ts` | **新建**：从 interceptor 提取 `buildLogEntry` + `UA_MAX/QUERY_MAX/ERROR_MAX` 常量 |
| `operation-log/log-entry.util.spec.ts` | **新建**：迁移 `buildLogEntry` 的单测 |
| `operation-log/operation-log.interceptor.ts` | 修改：删除 `buildLogEntry`/常量、改 import；`record()` 内置 `__oplogRecorded` 标志 |
| `operation-log/operation-log.interceptor.spec.ts` | **删除**（其内容迁移到 `log-entry.util.spec.ts`） |
| `common/filters/http-exception.filter.ts` | 修改：DI 注入 `OperationLogService` + `enabled/bodyMaxBytes`；标准化响应前补记（标志未设时） |
| `common/filters/http-exception.filter.spec.ts` | **新建**：filter 补记逻辑单测 |
| `app.module.ts` | 修改：providers 加 `APP_FILTER → HttpExceptionFilter` |
| `main.ts` | 修改：移除 `useGlobalFilters(new HttpExceptionFilter())` 及其 import |
| `test/operation-log.e2e-spec.ts` | 修改：新增"无 token → 401 → 落库"用例 |

---

### Task 1: 提取 `buildLogEntry` 到共享 util（纯重构）

**Files:**
- Create: `apps/api/src/operation-log/log-entry.util.ts`
- Create: `apps/api/src/operation-log/log-entry.util.spec.ts`
- Modify: `apps/api/src/operation-log/operation-log.interceptor.ts`
- Delete: `apps/api/src/operation-log/operation-log.interceptor.spec.ts`

**Interfaces:**
- Produces: `buildLogEntry(req, statusCode, durationMs, error, bodyMaxBytes): OperationLogEntry`（从 `./log-entry.util` 导出）—— Task 2 的 filter 与改造后的 interceptor 都依赖它。

- [ ] **Step 1: 创建 `log-entry.util.ts`（buildLogEntry 原样搬入）**

创建 `apps/api/src/operation-log/log-entry.util.ts`，内容为当前 `operation-log.interceptor.ts` 顶部的常量与 `buildLogEntry` 函数（逐字搬迁，仅改导入路径——该文件就在 `operation-log/` 目录，相对路径与原 interceptor 相同）：

```ts
import { Request } from 'express';
import type { OperationLogEntry } from './operation-log.types';
import { getClientIp } from '../common/client-ip.util';
import { portalFromRequest } from '../auth/portal-cookie';
import { sanitizeBody, sanitizeQueryString, truncateString } from './sanitize.util';

const UA_MAX = 512;
const QUERY_MAX = 2048;
const ERROR_MAX = 1024;

/** 从请求 + 响应元信息构建日志载荷（纯函数，便于单测） */
export function buildLogEntry(
  req: Request,
  statusCode: number,
  durationMs: number,
  error: unknown | null,
  bodyMaxBytes: number,
): OperationLogEntry {
  const user = (req as any).user;
  const ua = req.headers['user-agent'];
  const referer = req.headers['referer'];
  const [path, query = ''] = (req as any).originalUrl?.split('?') ?? [req.path, ''];
  return {
    userId: user?.sub ?? null,
    username: user?.username ?? null,
    role: user?.role ?? 'anonymous',
    portal: portalFromRequest(req) ?? null,
    method: req.method,
    path,
    query: query ? sanitizeQueryString(query, QUERY_MAX) : null,
    body: sanitizeBody((req as any).body, bodyMaxBytes),
    statusCode,
    durationMs,
    ipAddress: getClientIp(req),
    userAgent: ua ? truncateString(String(ua), UA_MAX) : null,
    referer: referer ? truncateString(String(referer), QUERY_MAX) : null,
    error: error ? truncateString(error instanceof Error ? error.message : String(error), ERROR_MAX) : null,
  };
}
```

- [ ] **Step 2: 迁移单测到 `log-entry.util.spec.ts`**

读取当前 `apps/api/src/operation-log/operation-log.interceptor.spec.ts`，把整份内容（`makeReq` helper + `describe('buildLogEntry', ...)` 全部用例）复制到新文件 `apps/api/src/operation-log/log-entry.util.spec.ts`，**唯一改动**：把第一行导入

```ts
import { buildLogEntry } from './operation-log.interceptor';
```

改为

```ts
import { buildLogEntry } from './log-entry.util';
```

其余测试代码不变。

- [ ] **Step 3: 删除旧 spec**

删除 `apps/api/src/operation-log/operation-log.interceptor.spec.ts`（其内容已迁出；interceptor 的 RxJS 接线无单测，由 e2e 覆盖）。

- [ ] **Step 4: 改造 interceptor —— 移除 buildLogEntry、改 import**

修改 `apps/api/src/operation-log/operation-log.interceptor.ts`：
1. 删除顶部 `buildLogEntry` 函数定义及其上方注释、`UA_MAX/QUERY_MAX/ERROR_MAX` 三行常量。
2. 把导入区改为（移除 `buildLogEntry` 现在不再直接需要的 `getClientIp`/`portalFromRequest`/`sanitize*`/`OperationLogEntry` 类型，新增从 util 的导入）：

```ts
import { CallHandler, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { Request } from 'express';
import { OperationLogService } from './operation-log.service';
import { buildLogEntry } from './log-entry.util';
import { DEFAULT_EXCLUDE_PATHS, parseExcludePaths, shouldExclude, type ExcludePattern } from './operation-log.filter';
```

（`OperationLogInterceptor` 类体本轮不动；Task 2 再加标志。）

- [ ] **Step 5: 运行测试确认绿**

Run（在 `water-erp/`）:
```bash
pnpm --filter api test -- operation-log
```
Expected: 全绿（`log-entry.util.spec` 取代了原 `interceptor.spec`，用例数不变；`sanitize/filter/service` spec 不受影响）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/operation-log/log-entry.util.ts apps/api/src/operation-log/log-entry.util.spec.ts apps/api/src/operation-log/operation-log.interceptor.ts apps/api/src/operation-log/operation-log.interceptor.spec.ts
git commit -m "refactor(operation-log): 提取 buildLogEntry 到 log-entry.util（interceptor/filter 共享）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: interceptor 置标志 + HttpExceptionFilter 补记 + 注册

**Files:**
- Modify: `apps/api/src/operation-log/operation-log.interceptor.ts`（`record()` 置标志）
- Modify: `apps/api/src/common/filters/http-exception.filter.ts`（DI + 补记）
- Modify: `apps/api/src/app.module.ts`（注册 APP_FILTER）
- Modify: `apps/api/src/main.ts`（移除 useGlobalFilters）
- Test: `apps/api/src/common/filters/http-exception.filter.spec.ts`（新建）

**Interfaces:**
- Consumes: `buildLogEntry`（Task 1）、`OperationLogService.create(entry)`（已存在，fire-and-forget 安全）
- Produces: DI 化的 `HttpExceptionFilter`（构造注入 `OperationLogService`）；请求级标志 `__oplogRecorded`

- [ ] **Step 1: interceptor `record()` 置标志**

修改 `apps/api/src/operation-log/operation-log.interceptor.ts` 的 `record` 闭包，在 `service.create(...).catch(...)` 之后追加一行置标志：

```ts
    const record = (statusCode: number, error: unknown | null) => {
      const entry = buildLogEntry(req, statusCode, Date.now() - start, error, this.bodyMaxBytes);
      this.service.create(entry).catch((e) => this.logger.warn(`OperationLog 记录失败: ${e?.message ?? e}`));
      (req as any).__oplogRecorded = true;
    };
```

- [ ] **Step 2: 写 filter 单测（先红）**

创建 `apps/api/src/common/filters/http-exception.filter.spec.ts`：

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { OperationLogService } from '../../operation-log/operation-log.service';

describe('HttpExceptionFilter — operation-log 补记', () => {
  let filter: HttpExceptionFilter;
  let oplog: any;

  const makeHost = (reqOver: any = {}) => {
    const req: any = { method: 'GET', url: '/api/x', headers: {}, socket: {}, ...reqOver };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    return { switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }), _req: req, _res: res } as any;
  };

  beforeEach(async () => {
    oplog = { create: jest.fn().mockResolvedValue(undefined) };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [HttpExceptionFilter, { provide: OperationLogService, useValue: oplog }],
    }).compile();
    filter = mod.get(HttpExceptionFilter);
  });

  it('标志未设 → 记录一条 + 发标准化响应', () => {
    const host = makeHost(); // 无 __oplogRecorded
    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), host);
    expect(oplog.create).toHaveBeenCalledTimes(1);
    expect(oplog.create.mock.calls[0][0].statusCode).toBe(403);
    const res = host._res;
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, timestamp: expect.any(String), path: '/api/x' }));
  });

  it('标志已设（interceptor 已记）→ 不重复记录，但响应照发', () => {
    const host = makeHost({ __oplogRecorded: true });
    filter.catch(new HttpException('boom', HttpStatus.BAD_REQUEST), host);
    expect(oplog.create).not.toHaveBeenCalled();
    expect(host._res.status).toHaveBeenCalledWith(400);
  });

  it('401 且无 user → role anonymous / userId null', () => {
    const host = makeHost(); // 无 req.user
    filter.catch(new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED), host);
    const entry = oplog.create.mock.calls[0][0];
    expect(entry.statusCode).toBe(401);
    expect(entry.role).toBe('anonymous');
    expect(entry.userId).toBeNull();
    expect(entry.durationMs).toBe(0);
  });

  it('非 HttpException → status 500 仍补记', () => {
    const host = makeHost();
    filter.catch(new Error('kaboom'), host);
    expect(oplog.create.mock.calls[0][0].statusCode).toBe(500);
    expect(host._res.status).toHaveBeenCalledWith(500);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter api test -- http-exception.filter.spec`
Expected: FAIL（`HttpExceptionFilter` 无构造参数 / 无 OperationLogService provider 解析失败）。

- [ ] **Step 4: 改造 HttpExceptionFilter（DI + 补记）**

把 `apps/api/src/common/filters/http-exception.filter.ts` 整体替换为：

```ts
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { buildLogEntry } from '../../operation-log/log-entry.util';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  private readonly oplogEnabled: boolean;
  private readonly bodyMaxBytes: number;

  constructor(private readonly operationLog: OperationLogService) {
    this.oplogEnabled = process.env.OPERATION_LOG_ENABLED !== 'false';
    this.bodyMaxBytes = (Number(process.env.OPERATION_LOG_BODY_MAX_KB) || 4) * 1024;
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // ── 补记 guard 拒绝的请求：interceptor 未运行（标志未设），filter 兜底记录 ──
    if (this.oplogEnabled && !(request as any).__oplogRecorded) {
      try {
        const oplogStatus =
          exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
        const entry = buildLogEntry(request, oplogStatus, 0, exception, this.bodyMaxBytes);
        this.operationLog
          .create(entry)
          .catch((e) => this.logger.warn(`OperationLog(filter) 记录失败: ${e?.message ?? e}`));
        (request as any).__oplogRecorded = true;
      } catch (e) {
        this.logger.warn(`OperationLog(filter) 构建失败: ${e?.message ?? e}`);
      }
    }

    // ── 以下为原有标准化响应逻辑（不变）──
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';
    let code = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const obj = res as Record<string, unknown>;

        // Custom error format: { code: 'MACHINE_CODE', error: 'human-readable message' }
        if (typeof obj.code === 'string' && typeof obj.error === 'string') {
          code = obj.code;
          message = obj.error;
        } else {
          // NestJS convention: { message: '...', error: 'ErrorName' }
          message = (obj.message as string) || exception.message;
          code = (obj.error as string) || code;

          // Handle class-validator array messages
          if (Array.isArray(obj.message)) {
            message = (obj.message as string[]).join('; ');
            code = 'VALIDATION_ERROR';
          }
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(`${request.method} ${request.url} ${status}`, exception.stack);
    }

    if (status < 500) {
      this.logger.warn(`${request.method} ${request.url} ${status} - ${message}`);
    }

    response.status(status).json({
      statusCode: status,
      code,
      error: message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
```

- [ ] **Step 5: 注册 APP_FILTER，移除 main.ts 手动注册**

修改 `apps/api/src/app.module.ts`：
1. 顶部 import 区加：
```ts
import { APP_FILTER } from '@nestjs/core';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
```
2. 在 `@Module.providers` 数组（现有三个 `APP_GUARD` 之后）加：
```ts
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
```

修改 `apps/api/src/main.ts`：
1. 删除 import 行 `import { HttpExceptionFilter } from './common/filters/http-exception.filter';`
2. 删除 `app.useGlobalFilters(new HttpExceptionFilter());` 一行。

- [ ] **Step 6: 运行 filter 单测 + operation-log 单测确认绿**

Run:
```bash
pnpm --filter api test -- http-exception.filter.spec
pnpm --filter api test -- operation-log
```
Expected: filter spec 4 用例全过；operation-log 单测全绿（interceptor 改动不影响其行为）。

- [ ] **Step 7: 回归 —— auth e2e 确认错误响应格式不变**

Run:
```bash
pnpm --filter api test:e2e -- auth
```
Expected: auth e2e 全绿（401/400 等错误响应格式 `{ statusCode, code, error, timestamp, path }` 经 DI 化的 filter 仍正确）。如失败，说明 filter DI 化破坏了响应契约，必须修复后再继续。

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/operation-log/operation-log.interceptor.ts apps/api/src/common/filters/http-exception.filter.ts apps/api/src/common/filters/http-exception.filter.spec.ts apps/api/src/app.module.ts apps/api/src/main.ts
git commit -m "feat(operation-log): HttpExceptionFilter 补记 guard 拒绝请求（401/403/429）

interceptor 记录后置 __oplogRecorded 标志；filter 在标准化响应前补记（标志未设=guard
拒绝、interceptor 未运行），durationMs 记 0。filter 由 main.ts 手动 new 改为 APP_FILTER DI 注册。

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: e2e —— 无 token 访问受保护路由被补记

**Files:**
- Modify: `apps/api/test/operation-log.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 2 的 filter 补记机制

- [ ] **Step 1: 新增 e2e 用例**

在 `apps/api/test/operation-log.e2e-spec.ts` 的 `describe('OperationLog (e2e)', ...)` 内、现有用例之后，新增一个用例：

```ts
  it('受保护路由无 token → 401 并被补记（role anonymous）', async () => {
    await request(app.getHttpServer()).get('/api/operation-log').expect(401);
    // 等待 fire-and-forget 落库
    await new Promise((r) => setTimeout(r, 300));
    const row = await prisma.operationLog.findFirst({
      where: { path: '/api/operation-log', method: 'GET', statusCode: 401 },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect(row!.role).toBe('anonymous');
    expect(row!.userId).toBeNull();
    expect(row!.durationMs).toBe(0);
  });
```

（此请求**不带 cookie**：`/api/operation-log` 受 `AuthGuard` 守卫，无 token → 401；interceptor 未运行 → 标志未设 → filter 补记。这正是改造前漏掉、本次补上的场景。）

- [ ] **Step 2: 运行 e2e 确认全绿（5/5）**

Run:
```bash
pnpm --filter api exec jest --config test/jest-e2e.json --forceExit --testPathPatterns='test/operation-log.e2e-spec'
```
Expected: 5 个用例全过（原 4 个 + 新增的 401 补记）。

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/operation-log.e2e-spec.ts
git commit -m "test(operation-log): e2e 验证 guard 拒绝请求被补记（无 token 401 落库）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 完成判定

- 3 个任务 checkbox 勾选；`pnpm --filter api test -- operation-log http-exception.filter` 全绿；`pnpm --filter api test:e2e -- operation-log` 5/5、`auth` e2e 全绿。
- 手动验证：启动 `pnpm dev:api`，不带 token `curl -i localhost:4001/api/operation-log` 返回 401，且 `OperationLog` 表多一条 `statusCode=401, role=anonymous, userId=null, durationMs=0` 的记录。
- 去重验证：失败登录（`POST /api/auth/login` 错误口令）仍只产生 1 条记录（interceptor 记 + 置标志，filter 跳过）—— 不重复。
