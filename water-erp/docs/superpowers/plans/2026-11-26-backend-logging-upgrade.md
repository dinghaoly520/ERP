# 后端日志完善（控制台 + 操作日志页面）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让后端每条日志看得出「谁、在哪个节点、做什么」，并让 :3005「系统健康 → 操作日志」页面一行回答同样的问题；手机号等默认明文，密码、令牌、验证码任何时候都不记录。

**Architecture:** `AsyncLocalStorage` 承载请求上下文（请求号、身份、门户、IP），由 `AppLogger`（`extends ConsoleLogger`）在统一出口拼进每一行，现有 `this.logger.*` 调用点零改动；每个请求结束时打一行「请求完成行」，控制台与库表共用同一份脱敏结果与异常描述；身份在 `AuthGuard` 验签成功后立刻记下；`OperationLog` 加可空 `meta` 列存请求号、处理器与中文动作；页面收成六列并增加三个筛选。

**Tech Stack:** NestJS 11.1.24（Express 5.2.1）、TypeScript、Prisma 6（PostgreSQL 16 用于 CI 与隔离库，金仓用于开发库与生产库）、Next.js 16 / React 19（:3005）、jest + ts-jest、node:test（web）。

**Spec:** `water-erp/docs/superpowers/specs/2026-11-26-backend-logging-upgrade-design.md`

## 全局约束

1. 全程在隔离 worktree 里做（任务 0 建立，下文记作 `$WT`）；`git add` 只加任务列出的路径，不用 `git add -A`。
2. API 的测试与类型检查用 `apps/api` 自己的工具链，命令一律 `cd "$API" && ./node_modules/.bin/<工具>`；不经 pnpm，不用根目录的 tsc。
3. ts-jest 开着类型诊断：新 spec 引用尚不存在的接口时，RED 是 `Test suite failed to run` 加 TS2339 或 TS2552。要看逐条失败，用一次性的只转译运行（命令见下），不得改 jest 配置。
4. 日志任何一步出错不得影响请求：打印与落库都在 `try/catch` 里，落库失败只告警。
5. 对外错误响应体逐键不变：`{ statusCode, code, error, timestamp, path, …附加键 }`。
6. 凭证恒为 `***`；全局 `CREDENTIAL_KEYS` 清单不动。`LOG_PII_MASK` 只有字符串 `true` 才打码，其余取值（含未设）明文，运行期逐次读环境变量。`NotificationDeliveryLog.phoneMasked` 与返回前端的 `maskedPhone` 不服从开关。
7. `AuthGuard` 的拒绝条件与顺序一个不许变，只许两处改动：`select` 加 `displayName`、验签后写一次日志身份。
8. 固定值：时间 `YYYY-MM-DD HH:mm:ss.SSS`（进程本地时区）；级别定宽 5 字符；身份 `姓名(账号·角色)`，姓名与账号相同或没有姓名时 `账号·角色`，无身份 `匿名`；上下文 `[req=请求号] 身份[@门户] [IP]`、`[ws=连接号]`；请求号 8 位十六进制；完成行 `→ <动作> <方法> <路径>[?查询串] <状态> <耗时>ms [<错误码>] <原因>[ 参数=<摘要>]`；参数摘要至多 300 字；路径与查询串合计至多 500 字；除换行与制表符外的控制字符替换为 `?`。
9. 角色与门户中文以设计稿附录 A 为准，与 web 的 `ROLE_LABELS` 逐字一致。
10. 日志级别：`NODE_ENV=production` 默认 `log,warn,error,fatal`，其余环境六级全开；`LOG_LEVELS` 逗号分隔，无效项忽略。
11. `OperationLog` 是按月分区的法定留存表：只许手写 `ADD COLUMN` 迁移，禁止 `prisma migrate diff`；改 `schema.prisma` 前后各跑一次 `prisma validate`。
12. web 文案过文案巡检闸；改页面前先加载 `water-erp:cgzxui` 技能。
13. 提交信息 `type(logging): 中文说明`，末尾一行 `Co-Authored-By: Claude Code <noreply@anthropic.com>`；不推送。

## 约定

- 路径：`api/…` 指 `$WT/water-erp/apps/api/…`；`web/…` 指 `$WT/water-erp/apps/web/…`；其余路径相对 `$WT/water-erp/`。
- 变量（任务 0 建立后每个命令块开头都带上）：

  ```bash
  WT=/home/asus/桌面/ERP/.worktrees/logging-upgrade
  API=$WT/water-erp/apps/api
  WEB=$WT/water-erp/apps/web
  ```

- 单测：`cd "$API" && ./node_modules/.bin/jest <spec 路径>`；类型检查：`cd "$API" && ./node_modules/.bin/tsc --noEmit`。
- 只转译运行（一次性，用来看新 spec 的逐条失败；参数 `TS-jest` 的配置经命令行传入）：

  ```bash
  cd "$API" && ./node_modules/.bin/jest <spec 路径> --reporters=default --transform '{"^.+\\.(t|j)s$":["ts-jest",{"tsconfig":{"allowJs":true},"isolatedModules":true}]}'
  ```

- 每个任务结束时读、写环境变量的 spec 必须自己复原环境变量（`try/finally` 或 `afterEach`），不得泄漏到别的 spec。
- 任务 0、12、13 涉及本机环境（worktree、私有隔离栈、开发库），由主会话执行；其余任务可交给子代理。

## Review Focus

1. 并发交错的两个请求：各自请求里的日志必须带各自的请求号，不得串线 → 任务 1「并发请求互不串线」。
2. 路径、查询串、参数，以及账号与姓名（供应商的账号就是企业名称，用户可填）里带换行或 ESC 的输入：日志行不得出现原始控制字符，身份不得跨行（防日志注入）→ 任务 2「控制字符被替换」「身份里的控制字符被替换」、任务 7「净化」。
3. 超大或非 JSON 的请求体（Buffer、长字符串、数组、已截断的预览）出错的请求：参数摘要不抛异常、不重复遍历原始体 → 任务 5「Buffer / 字符串 / 数组请求体」、任务 7「截断体只取预览」。
4. 被守卫拒绝的请求不经拦截器：请求完成行不得漏打，也不得与拦截器重打 → 任务 7 过滤器五个用例。
5. 非 admin 读到已截断的预览文本或旧掩码行：明文不得漏出，旧值不得被破坏 → 任务 5「读端重新打码」两个用例、任务 10「非 admin 读到的请求体重新打码」。

## 任务总览

| 任务 | 交付物 | 依赖 |
|------|--------|------|
| 0 | 隔离 worktree 与基线 | — |
| 1 | 请求上下文存储、中间件、`AppModule` 接线 | 0 |
| 2 | 行格式纯函数与中文标签 | — |
| 3 | `AppLogger`、级别开关、裸 `console` 接管、两个进程入口 | 1、2 |
| 4 | `describeException`（过滤器重构，响应不变） | — |
| 5 | 明文开关、按路由登记的敏感键、读端打码函数 | — |
| 6 | 身份尽早记录、元信息守卫、动作名 | 1 |
| 7 | 请求完成行、耗时口径、排除表 | 1、4、5、6 |
| 8 | WS 连接上下文、短信控制台行 | 1、3、5 |
| 9 | `OperationLog.meta` 列与落库 | 7 |
| 10 | 查询接口扩展与按角色打码 | 5、9 |
| 11 | 页面改造 | 10 |
| 12 | 隔离 e2e 与私有栈实走 | 1–11 |
| 13 | 变基复验、开发库迁移、合回、注记与收尾 | 12 |

---

### Task 0: 隔离 worktree 与基线（主会话执行）

**Files:** 无代码改动，无提交。

与既有做法的差别：`node_modules` 不用软链，改用硬链接复制（`cp -al`）。两个原因——软链下 Prisma 生成代码住在主工作区，`prisma generate` 会覆盖各方共用的客户端；软链指向 worktree 之外，Turbopack 不解析，worktree 里起不了页面。硬链接复制几秒完成、不占额外磁盘；生成代码所在的两个目录换成真实副本，生成只落在 worktree 内。

- [ ] **Step 1: 建 worktree 并复制依赖**

```bash
cd /home/asus/桌面/ERP
git worktree add .worktrees/logging-upgrade -b feat/logging-upgrade main
WT=/home/asus/桌面/ERP/.worktrees/logging-upgrade
SRC=/home/asus/桌面/ERP/water-erp
for rel in node_modules apps/api/node_modules apps/web/node_modules packages/client/node_modules packages/config/node_modules packages/shared/node_modules packages/ukey/node_modules; do
  cp -al "$SRC/$rel" "$WT/water-erp/$rel"
done
git -C "$WT" status --short
```

Expected: 最后一行无输出（七处 `node_modules` 都被忽略）。

- [ ] **Step 2: 把 Prisma 生成代码的两个目录换成真实副本**

```bash
for d in "$WT"/water-erp/node_modules/.pnpm/@prisma+client@*; do
  name=${d##*/}
  for sub in .prisma/client @prisma/client; do
    rm -rf "${d:?}/node_modules/$sub"
    cp -r "$SRC/node_modules/.pnpm/$name/node_modules/$sub" "$d/node_modules/$sub"
  done
done
find "$WT"/water-erp/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client -type f -links +1 | wc -l
```

Expected: 最后一行输出 `0`（副本与主工作区不再共用文件）。

- [ ] **Step 3: 占位 `.env` 与共享包**

worktree 的 `apps/api/.env` 只留两条指向不存在地址的 URL，任何误跑都连不到开发库。

```bash
printf 'DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/unused\nDIRECT_URL=postgresql://unused:unused@127.0.0.1:1/unused\n' > "$WT/water-erp/apps/api/.env"
cp "$SRC/apps/web/next-env.d.ts" "$WT/water-erp/apps/web/"
cd "$WT/water-erp" && for p in shared config ukey client; do pnpm --filter @water-erp/$p build || break; done
ls "$WT"/water-erp/packages/*/dist/index.js | wc -l
```

Expected: `4`。

- [ ] **Step 4: 基线**

```bash
cd "$API" && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/jest src/operation-log src/common/filters src/notification/notification.gateway.spec.ts src/bid/bid.gateway.spec.ts src/verification/sms-provider.spec.ts
cd "$WEB" && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/tsx --test "src/**/*.test.ts"
```

Expected: 全绿。基线不绿先停下查原因（多半是 `cp -al` 漏了目录），不要带着红基线往下做。

- [ ] **Step 5: 兜底**

`cp -al` 之后类型检查或 Turbopack 异常且十分钟内查不出原因：删掉七处 `node_modules`，改用既有做法（软链到主工作区同名目录，`apps/api/.env` 留 0 字节占位）。软链下 Prisma 客户端是各方共用的——任务 9 生成之前必须确认主工作区与其他 worktree 的 `schema.prisma` 都没有未提交改动；页面走查挪到合回之后（任务 13）。

---

### Task 1: 请求上下文存储、中间件与接线

**Files:**
- Create: `api/src/logging/request-context.storage.ts`
- Create: `api/src/logging/request-context.middleware.ts`
- Test: `api/src/logging/request-context.spec.ts`
- Modify: `api/src/app.module.ts`（导入、`implements NestModule`、`configure`）

**Interfaces:**
- Produces（后续任务都从这里取）:

  ```ts
  export interface LogIdentity { userId: string; username: string; role: string | null; displayName?: string | null }
  export interface LogContext { requestId: string; kind: 'http' | 'ws'; startedAt: number; identity?: LogIdentity; portal?: string; source?: string; ip?: string | null }
  export function runWithLogContext<T>(ctx: LogContext, fn: () => T): T   // AsyncLocalStorage.run
  export function currentLogContext(): LogContext | undefined
  export function noteLogIdentity(identity: LogIdentity): void            // 并入当前上下文；上下文外什么也不做
  export function identityFromToken(payload: { sub?: string; username?: string; role?: string; displayName?: string | null } | null | undefined): LogIdentity | undefined
  export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void
  ```

- Consumes: `auth/portal-cookie.ts` 的 `portalFromRequest`、`common/portal-source.util.ts` 的 `portalSourceOf`、`common/client-ip.util.ts` 的 `getClientIp`（均已有）。

- [ ] **Step 1: 写失败的测试** `api/src/logging/request-context.spec.ts`

```ts
import type { NextFunction, Request, Response } from 'express';
import { currentLogContext, identityFromToken, noteLogIdentity, runWithLogContext } from './request-context.storage';
import { requestContextMiddleware } from './request-context.middleware';

describe('请求上下文（2026-11-26 日志完善）', () => {
  const tick = () => new Promise((r) => setTimeout(r, 5));

  it('runWithLogContext 内取得到、外取不到，跨 await 仍在', async () => {
    expect(currentLogContext()).toBeUndefined();
    await runWithLogContext({ requestId: 'aaaa1111', kind: 'http', startedAt: 1 }, async () => {
      await tick();
      expect(currentLogContext()?.requestId).toBe('aaaa1111');
    });
    expect(currentLogContext()).toBeUndefined();
  });

  it('并发请求互不串线', async () => {
    const seen: Record<string, string | undefined> = {};
    await Promise.all([
      runWithLogContext({ requestId: 'aaaa1111', kind: 'http', startedAt: 1 }, async () => { await tick(); await tick(); seen.a = currentLogContext()?.requestId; }),
      runWithLogContext({ requestId: 'bbbb2222', kind: 'http', startedAt: 1 }, async () => { await tick(); seen.b = currentLogContext()?.requestId; }),
    ]);
    expect(seen).toEqual({ a: 'aaaa1111', b: 'bbbb2222' });
  });

  it('noteLogIdentity 并入当前上下文；上下文外什么也不做', () => {
    const ctx = { requestId: 'aaaa1111', kind: 'http' as const, startedAt: 1 };
    runWithLogContext(ctx, () => noteLogIdentity({ userId: 'u1', username: 'a', role: 'staff' }));
    expect(ctx.identity).toEqual({ userId: 'u1', username: 'a', role: 'staff' });
    expect(() => noteLogIdentity({ userId: 'u1', username: 'a', role: 'staff' })).not.toThrow();
  });

  it('identityFromToken：缺 sub 返回 undefined；缺 username 用 sub 顶替', () => {
    expect(identityFromToken(null)).toBeUndefined();
    expect(identityFromToken({ sub: 'u1' })).toEqual({ userId: 'u1', username: 'u1', role: null });
    expect(identityFromToken({ sub: 'u1', username: 'a', role: 'staff', displayName: '彭强' }))
      .toEqual({ userId: 'u1', username: 'a', role: 'staff', displayName: '彭强' });
  });

  it('中间件：写响应头，在上下文内放行（请求号 8 位十六进制、门户、来源、IP）', () => {
    const req = { headers: { 'x-portal': 'web', 'x-portal-source': 'mobile-3011', 'x-forwarded-for': '10.60.3.17, 10.0.0.1' }, socket: {} } as unknown as Request;
    const res = { setHeader: jest.fn() } as unknown as Response;
    let seen: ReturnType<typeof currentLogContext>;
    const before = Date.now();
    requestContextMiddleware(req, res, () => { seen = currentLogContext(); });
    expect(res.setHeader).toHaveBeenCalledTimes(1);
    const [header, value] = (res.setHeader as jest.Mock).mock.calls[0];
    expect(header).toBe('X-Request-Id');
    expect(value).toMatch(/^[0-9a-f]{8}$/);
    expect(seen).toMatchObject({ requestId: value, kind: 'http', portal: 'web', source: 'mobile-3011', ip: '10.60.3.17' });
    expect(seen!.startedAt).toBeGreaterThanOrEqual(before);
    expect(currentLogContext()).toBeUndefined();
  });

  it('中间件：不信任入站的 X-Request-Id', () => {
    const req = { headers: { 'x-request-id': 'deadbeef' }, socket: {} } as unknown as Request;
    const res = { setHeader: jest.fn() } as unknown as Response;
    requestContextMiddleware(req, res, () => undefined);
    expect((res.setHeader as jest.Mock).mock.calls[0][1]).not.toBe('deadbeef');
  });
});
```

- [ ] **Step 2: 跑，确认 RED**

Run: `cd "$API" && ./node_modules/.bin/jest src/logging/request-context.spec.ts`
Expected: `Test suite failed to run`，`Cannot find module './request-context.storage'`。

- [ ] **Step 3: 实现**

`request-context.storage.ts`：模块级 `export const logContextStorage = new AsyncLocalStorage<LogContext>()`。`identityFromToken` 在 `sub` 缺失时返回 `undefined`，`username` 取 `payload.username || payload.sub`。

`request-context.middleware.ts`：请求号用 `randomBytes(4).toString('hex')` 生成；先 `res.setHeader('X-Request-Id', requestId)`，再 `runWithLogContext({ requestId, kind: 'http', startedAt: Date.now(), portal: portalFromRequest(req), source: portalSourceOf(req), ip: getClientIp(req) }, next)`。

- [ ] **Step 4: 跑，确认 GREEN**

Run: 同 Step 2。Expected: `Tests: 6 passed`。

- [ ] **Step 5: 接进 `AppModule`**

`api/src/app.module.ts`：从 `@nestjs/common` 追加导入 `MiddlewareConsumer`、`NestModule`；类改为 `export class AppModule implements NestModule { configure(consumer: MiddlewareConsumer) { consumer.apply(requestContextMiddleware).forRoutes('{*splat}'); } }`。

路由通配用 `'{*splat}'` 而不是设计稿写的 `'*'`：已装的 Express 5.2.1 遇到 `'*'` 会改写并打一条 LegacyRouteConverter 警告，`'{*splat}'` 是它的正式写法（探针已验证：未匹配路由同样进入上下文）。

- [ ] **Step 6: 类型检查**

Run: `cd "$API" && ./node_modules/.bin/tsc --noEmit`
Expected: 无输出。

- [ ] **Step 7: 提交**

```bash
cd "$WT" && git add water-erp/apps/api/src/logging/request-context.storage.ts water-erp/apps/api/src/logging/request-context.middleware.ts water-erp/apps/api/src/logging/request-context.spec.ts water-erp/apps/api/src/app.module.ts
git commit -m "feat(logging): 请求上下文（请求号、门户、来源、IP）存储与中间件" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 2: 行格式纯函数与中文标签

**Files:**
- Create: `api/src/logging/labels.ts`
- Create: `api/src/logging/log-format.util.ts`
- Test: `api/src/logging/log-format.util.spec.ts`

**Interfaces:**
- Produces:

  ```ts
  // labels.ts
  export const ROLE_LABEL_ZH: Record<string, string>
  export const PORTAL_LABEL_ZH: Record<string, string>
  export const MOBILE_LABEL_ZH = '移动驾驶舱'
  export function roleLabelZh(role: string | null | undefined): string                           // 未收录的角色原样返回；没有角色返回空串
  export function portalLabelZh(portal?: string | null, source?: string | null): string | null   // source 为 mobile-3011 时返回移动驾驶舱；未收录的门户原样返回
  // log-format.util.ts
  export function formatLogTimestamp(ms: number): string
  export function sanitizeLogText(s: string): string
  export function truncateLogText(s: string, max: number): string                                 // 即 sanitize.util 的 truncateString，导入后转出，勿另写
  export function identityLabel(identity: LogIdentity | undefined): string
  export function formatLogContextTag(ctx: LogContext | undefined): string
  ```

- Consumes: 任务 1 的 `LogIdentity`、`LogContext`；`common/portal-source.util.ts` 的 `MOBILE_PORTAL_SOURCE`；`operation-log/sanitize.util.ts` 的 `truncateString`。

- [ ] **Step 1: 写失败的测试** `api/src/logging/log-format.util.spec.ts`

```ts
process.env.TZ = 'Asia/Shanghai';
import { roleLabelZh, portalLabelZh } from './labels';
import { formatLogContextTag, formatLogTimestamp, identityLabel, sanitizeLogText, truncateLogText } from './log-format.util';

describe('中文标签（设计稿附录 A）', () => {
  it('角色与门户用中文，未收录的原样返回', () => {
    expect(roleLabelZh('staff')).toBe('员工');
    expect(roleLabelZh('bid_host')).toBe('开标主持');
    expect(roleLabelZh('anonymous')).toBe('匿名');
    expect(roleLabelZh('mall')).toBe('mall');
    expect(roleLabelZh(null)).toBe('');
    expect(portalLabelZh('web')).toBe('采购管理端');
    expect(portalLabelZh('bid')).toBe('开评标端');
    expect(portalLabelZh('assistant')).toBe('水叮当助手');
    expect(portalLabelZh('nope')).toBe('nope');
    expect(portalLabelZh(null)).toBeNull();
  });

  it('来源是移动驾驶舱时，门户显示移动驾驶舱', () => {
    expect(portalLabelZh('web', 'mobile-3011')).toBe('移动驾驶舱');
  });
});

describe('行格式', () => {
  it('时间：YYYY-MM-DD HH:mm:ss.SSS，进程本地时区', () => {
    expect(formatLogTimestamp(Date.UTC(2026, 10, 26, 2, 29, 8, 412))).toBe('2026-11-26 10:29:08.412');
  });

  it('控制字符被替换为 ?，换行与制表符保留', () => {
    expect(sanitizeLogText('a\u001b[31mred\u001b[0m\r\nb\tc\u0000')).toBe('a?[31mred?[0m?\nb\tc?');
  });

  it('truncateLogText：超长截断并加标记', () => {
    expect(truncateLogText('abc', 3)).toBe('abc');
    expect(truncateLogText('abcdef', 3)).toBe('abc…[截断]');
  });

  it('身份：姓名(账号·角色)；姓名与账号相同或没有姓名时只显示账号·角色；无身份匿名', () => {
    expect(identityLabel({ userId: 'u1', username: 'Swhi-CGZX-05', role: 'staff', displayName: '王强' })).toBe('王强(Swhi-CGZX-05·员工)');
    expect(identityLabel({ userId: 'u2', username: '杨睿', role: 'bid_expert', displayName: '杨睿' })).toBe('杨睿·评审专家');
    expect(identityLabel({ userId: 'u1', username: 'Swhi-CGZX-05', role: 'staff' })).toBe('Swhi-CGZX-05·员工');
    expect(identityLabel({ userId: 'u1', username: 'a', role: 'mall' })).toBe('a·mall');
    expect(identityLabel(undefined)).toBe('匿名');
  });

  it('身份里的控制字符被替换为 ?（账号与姓名是用户可填的内容，防伪造日志行）', () => {
    expect(identityLabel({ userId: 'u1', username: '甲\n2026-11-26 10:00:00.000  INFO api 伪造行', role: 'staff', displayName: '乙\u001b[31m' }))
      .toBe('乙?[31m(甲?2026-11-26 10:00:00.000  INFO api 伪造行·员工)');
  });

  it('上下文段：[req=请求号] 身份[@门户] [IP]；WS 用连接号；没有上下文是空串', () => {
    const who = { userId: 'u1', username: 'Swhi-CGZX-05', role: 'staff', displayName: '王强' };
    expect(formatLogContextTag({ requestId: '7f3a9c12', kind: 'http', startedAt: 0, identity: who, portal: 'web', ip: '10.60.3.17' }))
      .toBe('[req=7f3a9c12] 王强(Swhi-CGZX-05·员工)@采购管理端 10.60.3.17');
    expect(formatLogContextTag({ requestId: '7f3a9c12', kind: 'http', startedAt: 0, portal: 'public', ip: '10.60.3.17' }))
      .toBe('[req=7f3a9c12] 匿名@信息门户 10.60.3.17');
    expect(formatLogContextTag({ requestId: 'ab12cd34', kind: 'ws', startedAt: 0, portal: 'web', source: 'mobile-3011' }))
      .toBe('[ws=ab12cd34] 匿名@移动驾驶舱');
    expect(formatLogContextTag({ requestId: '7f3a9c12', kind: 'http', startedAt: 0 })).toBe('[req=7f3a9c12] 匿名');
    expect(formatLogContextTag(undefined)).toBe('');
  });
});
```

- [ ] **Step 2: 跑，确认 RED**

Run: `cd "$API" && ./node_modules/.bin/jest src/logging/log-format.util.spec.ts`
Expected: `Test suite failed to run`，`Cannot find module './labels'`。

- [ ] **Step 3: 实现**

`labels.ts` 两张表照设计稿附录 A 逐字写（角色七项含 `anonymous: '匿名'`，门户六项）。`sanitizeLogText` 把除 `\n`、`\t` 外的 C0、C1 控制字符与 DEL 替换为 `?`。`identityLabel` 在 `displayName` 存在且不等于 `username` 时输出 `姓名(账号)`，再接 `·角色`；姓名与账号先各过一遍 `sanitizeLogText`，并且换行也换成 `?`（身份只能占一行）。`formatLogContextTag` 由「`[req=…] 身份@门户`」与 IP 两段用空格拼成，哪段没有就省略。

- [ ] **Step 4: 跑，确认 GREEN**

Run: 同 Step 2。Expected: `Tests: 8 passed`。

- [ ] **Step 5: 提交**

```bash
cd "$WT" && git add water-erp/apps/api/src/logging/labels.ts water-erp/apps/api/src/logging/log-format.util.ts water-erp/apps/api/src/logging/log-format.util.spec.ts
git commit -m "feat(logging): 统一行格式的纯函数与角色、门户中文标签" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 3: 日志器、级别开关与裸 console 接管

**Files:**
- Create: `api/src/logging/app-logger.ts`
- Test: `api/src/logging/app-logger.spec.ts`
- Modify: `api/src/main.ts`（第 2、15、45 行附近）
- Modify: `api/src/ai-bid-analysis-worker.ts`（`bootstrap` 开头与 `createApplicationContext`）
- Modify: `api/.env.example`（操作日志小节之后）

**Interfaces:**
- Consumes: 任务 1 的 `currentLogContext`、`runWithLogContext`；任务 2 的 `formatLogContextTag`、`formatLogTimestamp`。
- Produces:

  ```ts
  export type LogProcessName = 'api' | 'ai-worker';
  export function resolveLogLevels(): LogLevel[]                       // 读 LOG_LEVELS；生产默认 log,warn,error,fatal；其余环境六级全开
  export class AppLogger extends ConsoleLogger {
    constructor(options: { processName: string; logLevels?: LogLevel[]; colors?: boolean })
    protected formatMessage(logLevel: LogLevel, message: unknown, pidMessage: string, formattedLogLevel: string, contextMessage: string, timestampDiff: string): string
  }
  export function createAppLogger(processName: LogProcessName): AppLogger   // 级别取 resolveLogLevels()，并从 LOG_NODE 取节点名
  export function redirectConsoleToLogger(): void                     // 接管 console 的 log/info/warn/error/debug/trace
  ```

- [ ] **Step 1: 写失败的测试** `api/src/logging/app-logger.spec.ts`

```ts
process.env.TZ = 'Asia/Shanghai';
import { Logger } from '@nestjs/common';
import { AppLogger, createAppLogger, redirectConsoleToLogger, resolveLogLevels } from './app-logger';
import { runWithLogContext } from './request-context.storage';

const FIXED = '2026-11-26 10:29:08.412';
const ORIGINALS = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug, trace: console.trace };

describe('AppLogger（2026-11-26 日志完善）', () => {
  let out: string[];
  const restore: Array<() => void> = [];
  beforeEach(() => {
    out = [];
    const w = (s: unknown) => { out.push(String(s)); return true; };
    const so = jest.spyOn(process.stdout, 'write').mockImplementation(w as any);
    const se = jest.spyOn(process.stderr, 'write').mockImplementation(w as any);
    const now = jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 26, 2, 29, 8, 412));
    restore.push(() => so.mockRestore(), () => se.mockRestore(), () => now.mockRestore());
  });
  afterEach(() => {
    restore.splice(0).forEach((fn) => fn());
    Object.assign(console, ORIGINALS);
    Logger.overrideLogger(undefined);
    delete process.env.LOG_NODE;
  });

  it('行格式：时间 级别 进程 [模块] 消息', () => {
    new AppLogger({ processName: 'api', colors: false }).warn('hello', 'OcrService');
    expect(out).toEqual([`${FIXED}  WARN api [OcrService] hello\n`]);
  });

  it('new Logger(模块名) 的调用经模块名送到同一实例', () => {
    const logger = new AppLogger({ processName: 'api', colors: false });
    Logger.overrideLogger(logger);
    new Logger('OcrService').warn('hello');
    expect(out).toEqual([`${FIXED}  WARN api [OcrService] hello\n`]);
  });

  it('请求上下文出现在行里；没有上下文就没有这一段', () => {
    const logger = new AppLogger({ processName: 'api', colors: false });
    Logger.overrideLogger(logger);
    runWithLogContext({ requestId: '7f3a9c12', kind: 'http', startedAt: 0, portal: 'public', ip: '10.60.3.17' }, () => new Logger().warn('boom'));
    new Logger().warn('plain');
    expect(out).toEqual([`${FIXED}  WARN api [req=7f3a9c12] 匿名@信息门户 10.60.3.17 boom\n`, `${FIXED}  WARN api plain\n`]);
  });

  it('级别列定宽 5：log 显示 INFO，其余取大写', () => {
    const logger = new AppLogger({ processName: 'api', colors: false });
    const cases = [['error', 'ERROR'], ['log', ' INFO'], ['debug', 'DEBUG'], ['verbose', 'VERBOSE'], ['fatal', 'FATAL']] as const;
    for (const [level, label] of cases) {
      logger[level]('x');
      expect(out.pop()).toBe(`${FIXED} ${label} api x\n`);
    }
  });

  it('LOG_NODE 带节点名', () => {
    process.env.LOG_NODE = '生产';
    new AppLogger({ processName: 'api', colors: false }).log('x');
    expect(out).toEqual([`${FIXED}  INFO api@生产 x\n`]);
  });

  it('级别：生产默认不出 DEBUG 与 VERBOSE，LOG_LEVELS 可覆盖，无效项忽略', () => {
    const saved = { env: process.env.NODE_ENV, levels: process.env.LOG_LEVELS };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.LOG_LEVELS;
      expect(resolveLogLevels()).toEqual(['log', 'warn', 'error', 'fatal']);
      process.env.LOG_LEVELS = 'debug, nope ,error';
      expect(resolveLogLevels()).toEqual(['error', 'debug']);
      process.env.LOG_LEVELS = '   ';
      expect(resolveLogLevels()).toEqual(['log', 'warn', 'error', 'fatal']);
      process.env.NODE_ENV = 'development';
      expect(resolveLogLevels()).toEqual(['log', 'error', 'warn', 'debug', 'verbose', 'fatal']);
    } finally {
      if (saved.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.env;
      if (saved.levels === undefined) delete process.env.LOG_LEVELS; else process.env.LOG_LEVELS = saved.levels;
    }
  });

  it('裸 console 调用转交日志器：级别对应、请求内带上下文、空调用不出行', () => {
    Logger.overrideLogger(new AppLogger({ processName: 'api', colors: false }));
    redirectConsoleToLogger();
    try {
      console.error('上传失败', new Error('x'));
      console.log();
      console.warn('慢');
      runWithLogContext({ requestId: '7f3a9c12', kind: 'http', startedAt: 0, portal: 'web', ip: '127.0.0.1' }, () => console.info('请求里出错'));
    } finally {
      Object.assign(console, ORIGINALS);
    }
    expect(out).toHaveLength(3);
    expect(out[0].startsWith(`${FIXED} ERROR api 上传失败 Error: x\n`)).toBe(true);
    expect(out[1]).toBe(`${FIXED}  WARN api 慢\n`);
    expect(out[2]).toBe(`${FIXED}  INFO api [req=7f3a9c12] 匿名@采购管理端 127.0.0.1 请求里出错\n`);
  });

  it('createAppLogger：api 与 ai-worker 两个进程名', () => {
    createAppLogger('ai-worker').log('任务开始', 'TenderProcessor');
    expect(out).toEqual([expect.stringMatching(/ INFO ai-worker \[TenderProcessor\] 任务开始\n$/)]);
  });

  it('createAppLogger 按级别过滤：生产默认不出 DEBUG，其余环境出', () => {
    const saved = { env: process.env.NODE_ENV, levels: process.env.LOG_LEVELS };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.LOG_LEVELS;
      const prod = createAppLogger('api');
      prod.debug('hidden');
      prod.log('shown');
      process.env.NODE_ENV = 'test';
      createAppLogger('api').debug('dev shown');
    } finally {
      if (saved.env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved.env;
      if (saved.levels === undefined) delete process.env.LOG_LEVELS; else process.env.LOG_LEVELS = saved.levels;
    }
    expect(out).toEqual([expect.stringMatching(/ INFO api shown\n$/), expect.stringMatching(/DEBUG api dev shown\n$/)]);
  });
});
```

- [ ] **Step 2: 跑，确认 RED**

Run: `cd "$API" && ./node_modules/.bin/jest src/logging/app-logger.spec.ts`
Expected: `Test suite failed to run`，`Cannot find module './app-logger'`。

- [ ] **Step 3: 实现**

行由四段拼成：`formatLogTimestamp(Date.now())`、着色后的 5 字级别（`log` 显示 `INFO`）、`进程[@节点]` 加上下文段、Nest 传进来的 `contextMessage`（已含 `[模块] `，着色与否由它自带）、`this.stringifyMessage(message, logLevel)`，末尾接 `timestampDiff`。只覆盖 `formatMessage`；`printMessages`、堆栈打印、着色判断都用 Nest 自带的。构造时只在调用方显式给了 `colors` 才传给父类，否则沿用 Nest 的判断（终端着色、管道纯文本）。`redirectConsoleToLogger` 用 `util.format(...args)` 拼消息后交给一个无模块名的 `new Logger()`，带「正在输出」防递归标志，`args` 为空直接返回；内部不得调用 `console.*`。

- [ ] **Step 4: 跑，确认 GREEN**

Run: 同 Step 2。Expected: `Tests: 9 passed`。

- [ ] **Step 5: 接入两个进程入口**

`api/src/main.ts`：在 `const crashLogger = new Logger('ProcessCrash')` 之前加三行 `const appLogger = createAppLogger('api'); Logger.overrideLogger(appLogger); redirectConsoleToLogger();`；`NestFactory.create` 改为 `NestFactory.create(AppModule, { bodyParser: false, logger: appLogger })`。其余日志调用不动。

`api/src/ai-bid-analysis-worker.ts`：`bootstrap` 开头同样三行（进程名 `'ai-worker'`），`createApplicationContext(AiBidAnalysisWorkerModule, { logger: appLogger })`；文件末尾的 `console.error('Worker bootstrap failed:', err)` 不用改（已被接管）。日志内容不改。

- [ ] **Step 6: 写入 `.env.example`**

在 `OPERATION_LOG_PARTITION_MONTHS_AHEAD` 那行之后追加（四个开关一次写齐，后面任务不再改这个文件）：

```
# ── 控制台日志（apps/api/src/logging）──
LOG_LEVELS=                            # 输出级别，逗号分隔：log warn error fatal debug verbose；未设=非生产全开、生产默认 log,warn,error,fatal
LOG_NODE=                              # 节点名，带在进程名后（api@生产）；多机部署时区分日志来源
LOG_PII_MASK=                          # true=手机号/身份证/银行卡/邮箱打码；其余取值（含未设）明文。密码/令牌/验证码恒为 ***
HTTP_ACCESS_LOG=                       # off=关闭每个请求结束时的请求完成行；其余取值（含未设）打开
```

- [ ] **Step 7: 探针（不入库）**

写一个临时文件 `api/logging-probe.ts`，跑完删掉：

```ts
import { Logger } from '@nestjs/common';
import { createAppLogger, redirectConsoleToLogger } from './src/logging/app-logger';
Logger.overrideLogger(createAppLogger('api'));
redirectConsoleToLogger();
new Logger('OcrService').warn('探针');
console.error('裸 console 探针');
```

Run: `cd "$API" && ./node_modules/.bin/tsx logging-probe.ts && rm logging-probe.ts`
Expected 两行，时间取当前时刻：

```
2026-11-26 HH:mm:ss.SSS  WARN api [OcrService] 探针
2026-11-26 HH:mm:ss.SSS ERROR api 裸 console 探针
```

- [ ] **Step 8: 类型检查与提交**

Run: `cd "$API" && ./node_modules/.bin/tsc --noEmit`（Expected 无输出）

```bash
cd "$WT" && git add water-erp/apps/api/src/logging/app-logger.ts water-erp/apps/api/src/logging/app-logger.spec.ts water-erp/apps/api/src/main.ts water-erp/apps/api/src/ai-bid-analysis-worker.ts water-erp/apps/api/.env.example
git commit -m "feat(logging): 统一行格式日志器、级别开关与裸 console 接管，接入两个进程入口" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 4: 异常描述抽成纯函数

过滤器此刻不动（它到任务 7 才切过来），本任务只新增纯函数并用测试钉住它与过滤器现行映射逐项一致。

**Files:**
- Create: `api/src/common/filters/describe-exception.util.ts`
- Test: `api/src/common/filters/describe-exception.util.spec.ts`

**Interfaces:**
- Produces:

  ```ts
  export interface ExceptionDescription {
    status: number; code: string; message: string; extra: Record<string, unknown>;   // 对外响应四项，与改造前逐键一致
    logCode: string;            // 只用于日志：自带业务错误码沿用，否则按状态码取通用码
    rawMessage: string | null;  // 非 HttpException 的原始消息；HttpException 为 null
    stack: string | undefined;
  }
  export function statusDefaultCode(status: number): string
  export function describeException(exception: unknown): ExceptionDescription
  export function formatErrorForLog(d: ExceptionDescription): string   // `[日志码] 中文原因`；5xx 且有原文时追加 ` | 原始: …`
  ```

- Consumes: 无。

- [ ] **Step 1: 写失败的测试** `api/src/common/filters/describe-exception.util.spec.ts`（用例与既有过滤器 spec 的期望一一对应）

```ts
import { BadRequestException, ConflictException, HttpException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describeException, formatErrorForLog, statusDefaultCode } from './describe-exception.util';

describe('describeException（2026-11-26 日志完善）', () => {
  it('状态码通用码', () => {
    expect([400, 401, 403, 404, 409, 429, 413, 500].map(statusDefaultCode))
      .toEqual(['BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'TOO_MANY_REQUESTS', 'INTERNAL_ERROR', 'INTERNAL_ERROR']);
  });

  it('字符串 401：响应契约不变，日志码按状态码取，不保留原文', () => {
    expect(describeException(new HttpException('Unauthorized', 401))).toMatchObject({
      status: 401, code: 'INTERNAL_ERROR', message: '未登录或登录已过期，请重新登录', logCode: 'UNAUTHORIZED', rawMessage: null,
    });
  });

  it('自带业务错误码：响应与日志都用它', () => {
    const d = describeException(new UnauthorizedException({ code: 'SESSION_REPLACED', error: '该账号已在其他设备登录，请重新登录' }));
    expect(d).toMatchObject({ status: 401, code: 'SESSION_REPLACED', message: '该账号已在其他设备登录，请重新登录', logCode: 'SESSION_REPLACED' });
  });

  it('限流 429', () => {
    expect(describeException(new HttpException('x', 429))).toMatchObject({ status: 429, code: 'TOO_MANY_REQUESTS', logCode: 'TOO_MANY_REQUESTS', message: '操作过于频繁，请稍候片刻再试' });
  });

  it('校验数组：VALIDATION_ERROR，文案逐条中文化', () => {
    expect(describeException(new BadRequestException(['property phone must be a string'])))
      .toMatchObject({ status: 400, code: 'VALIDATION_ERROR', logCode: 'VALIDATION_ERROR', message: '手机号应为文本' });
  });

  it('Prisma 已知错误：已收录的按映射，未收录的 500 且码取异常码', () => {
    const mk = (code: string) => new Prisma.PrismaClientKnownRequestError('raw text', { code, clientVersion: 'test' });
    expect(describeException(mk('P2025'))).toMatchObject({ status: 404, code: 'RECORD_NOT_FOUND', logCode: 'RECORD_NOT_FOUND', rawMessage: 'raw text' });
    expect(describeException(mk('P2001'))).toMatchObject({ status: 500, code: 'P2001', logCode: 'P2001', message: '数据操作失败，请稍后重试。' });
  });

  it('普通 Error：500，对外中文，原文与堆栈保留', () => {
    const d = describeException(new Error('kaboom'));
    expect(d).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', logCode: 'INTERNAL_ERROR', message: '服务器内部错误，请稍后重试或联系管理员', rawMessage: 'kaboom' });
    expect(d.stack).toContain('kaboom');
  });

  it('body-parser 413', () => {
    const err: any = new Error('request entity too large');
    err.statusCode = 413;
    expect(describeException(err)).toMatchObject({ status: 413, message: '上传内容超出大小限制', logCode: 'INTERNAL_ERROR' });
  });

  it('K4 附加键随 extra 带出', () => {
    expect(describeException(new ConflictException({ code: 'ALREADY_PUSHED', error: 'x', itemIds: ['a'] } as any)).extra).toEqual({ itemIds: ['a'] });
  });

  it('格式化：[日志码] 文案；5xx 且有原文时追加原文', () => {
    expect(formatErrorForLog(describeException(new UnauthorizedException({ code: 'SESSION_REPLACED', error: '该账号已在其他设备登录，请重新登录' }))))
      .toBe('[SESSION_REPLACED] 该账号已在其他设备登录，请重新登录');
    expect(formatErrorForLog(describeException(new Error('kaboom')))).toBe('[INTERNAL_ERROR] 服务器内部错误，请稍后重试或联系管理员 | 原始: kaboom');
  });
});
```

- [ ] **Step 2: 跑，确认 RED**

Run: `cd "$API" && ./node_modules/.bin/jest src/common/filters/describe-exception.util.spec.ts`
Expected: `Test suite failed to run`，`Cannot find module './describe-exception.util'`。

- [ ] **Step 3: 实现**

把 `http-exception.filter.ts` 第 15–223 行（`prismaErrorToMessage` 到 `translateValidationMessage`）与其 `catch` 第 261–355 行的映射逻辑抄进新文件，行为一字不改；只增三件事：记下「业务错误码是否自带」（`{ code, error }`、嵌套形态、校验数组、限流、Prisma 各分支算自带；Nest 内置异常带出的类名式 `error` 值与初值 `INTERNAL_ERROR` 不算，改用 `statusDefaultCode(status)`）、`rawMessage`、`stack`。英文兜底闸照旧放在函数末尾。`formatErrorForLog` 的结果截到 1024 字。

- [ ] **Step 4: 跑，确认 GREEN**

Run: 同 Step 2。Expected: `Tests: 10 passed`。

- [ ] **Step 5: 提交**

```bash
cd "$WT" && git add water-erp/apps/api/src/common/filters/describe-exception.util.ts water-erp/apps/api/src/common/filters/describe-exception.util.spec.ts
git commit -m "feat(logging): 异常到状态码、错误码、中文文案的映射抽成纯函数（附日志码与原文）" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 5: 明文开关、按路由登记的敏感键、读端打码

**Files:**
- Create: `api/src/logging/pii-switch.ts`，Test: `api/src/logging/pii-switch.spec.ts`
- Create: `api/src/operation-log/sensitive-routes.ts`，Test: `api/src/operation-log/sensitive-routes.spec.ts`
- Modify: `api/src/operation-log/sanitize.util.ts`
- Test: `api/src/operation-log/sanitize.util.spec.ts`（改既有 6 个用例、加 7 个）

**Interfaces:**
- Produces:

  ```ts
  // logging/pii-switch.ts
  export function piiMaskingEnabled(): boolean          // process.env.LOG_PII_MASK === 'true'
  export function phoneForLog(phone: string): string    // 开关开：前3后4，不足 7 位 ***；关：原样
  // operation-log/sensitive-routes.ts
  export interface SensitiveRouteRule { method: string; path: string; bodyKeys?: string[]; queryKeys?: string[] }
  export const SENSITIVE_ROUTE_RULES: SensitiveRouteRule[]
  export function sensitiveKeysFor(method: string, route: string | null | undefined): { body: Set<string>; query: Set<string> }
  // operation-log/sanitize.util.ts
  export interface SanitizeOptions { maskPii?: boolean; extraCredentialKeys?: Set<string> }
  export function sanitizeValue(key: string, value: unknown, opts?: SanitizeOptions): unknown
  export function sanitizeObject(input: unknown, opts?: SanitizeOptions): unknown
  export function sanitizeBody(body: unknown, maxBytes?: number, opts?: SanitizeOptions): unknown
  export function sanitizeQueryString(query: string, maxLen?: number, extraCredentialKeys?: Set<string>): string
  export function bodyPreview(body: unknown, max?: number): string | null          // 默认 300
  export function maskPiiForReader(body: unknown, extraCredentialKeys?: Set<string>): unknown
  ```

- 规则：`opts` 没给、或给了但没写 `maskPii` 时读环境变量；`extraCredentialKeys` 按键名全等（不分大小写）命中即 `***`，优先级同全局凭证键，且不服从明文开关。`sensitiveKeysFor` 的 `route` 既可以是路由模式（写库时），也可以是具体路径（读端），规则里的 `:参数` 按单段通配匹配；路由模式带不带 `/api` 前缀、带不带结尾斜杠都能对上。

- [ ] **Step 1: 写失败的测试**

`api/src/logging/pii-switch.spec.ts`:

```ts
import { phoneForLog, piiMaskingEnabled } from './pii-switch';

describe('明文开关（2026-11-26 日志完善）', () => {
  afterEach(() => { delete process.env.LOG_PII_MASK; });

  it('只有字符串 true 才打码', () => {
    for (const v of [undefined, '', 'false', 'TRUE', '1']) {
      if (v === undefined) delete process.env.LOG_PII_MASK; else process.env.LOG_PII_MASK = v;
      expect(piiMaskingEnabled()).toBe(false);
    }
    process.env.LOG_PII_MASK = 'true';
    expect(piiMaskingEnabled()).toBe(true);
  });

  it('phoneForLog：默认明文；打码时前3后4，不足 7 位为 ***', () => {
    expect(phoneForLog('13812341234')).toBe('13812341234');
    process.env.LOG_PII_MASK = 'true';
    expect(phoneForLog('13812341234')).toBe('138****1234');
    expect(phoneForLog('123')).toBe('***');
  });
});
```

`api/src/operation-log/sensitive-routes.spec.ts`:

```ts
import { SENSITIVE_ROUTE_RULES, sensitiveKeysFor } from './sensitive-routes';

describe('按路由登记的敏感键（设计稿 6.8）', () => {
  it('首批十条规则', () => {
    expect(SENSITIVE_ROUTE_RULES.map((r) => [r.method, r.path, r.bodyKeys ?? [], r.queryKeys ?? []])).toEqual([
      ['POST', '/api/verification/verify-registration-code', ['code'], []],
      ['POST', '/api/verification/check-registration-code', ['code'], []],
      ['POST', '/api/auth/mobile/login', ['code'], []],
      ['POST', '/api/upload/registration', ['code'], []],
      ['POST', '/api/expert/projects/:projectId/room-code/verify', ['code'], []],
      ['GET', '/api/supplier/rsvp/verify', [], ['t']],
      ['POST', '/api/supplier/rsvp/respond', [], ['t']],
      ['GET', '/api/expert/rsvp/verify', [], ['t']],
      ['POST', '/api/expert/rsvp/respond', [], ['t']],
      ['GET', '/api/supplier/invitations/verify', [], ['code']],
    ]);
  });

  it('按方法加路由取键；换参数名也算命中；方法不同或其他路由返回空集', () => {
    expect(sensitiveKeysFor('POST', '/api/verification/check-registration-code')).toEqual({ body: new Set(['code']), query: new Set() });
    expect(sensitiveKeysFor('POST', '/api/expert/projects/:pid/room-code/verify').body).toEqual(new Set(['code']));
    expect(sensitiveKeysFor('POST', 'verification/check-registration-code/').body).toEqual(new Set(['code']));
    expect(sensitiveKeysFor('GET', '/api/verification/check-registration-code')).toEqual({ body: new Set(), query: new Set() });
    expect(sensitiveKeysFor('POST', '/api/companies/join')).toEqual({ body: new Set(), query: new Set() });
    expect(sensitiveKeysFor('POST', undefined)).toEqual({ body: new Set(), query: new Set() });
  });

  it('读端拿具体路径也能对上带参数的规则', () => {
    expect(sensitiveKeysFor('POST', '/api/expert/projects/clxabc123/room-code/verify').body).toEqual(new Set(['code']));
  });
});
```

`api/src/operation-log/sanitize.util.spec.ts` 改与加：

- 既有用例「手机号 → 前3后4 掩码」「身份证 → 前6后4 掩码」「银行卡 → 前4后4 掩码」「银行账号键（accountNo 扁平 / bankAccounts 整组）→ 不落明文」「邮箱 → 本地首字符+***+域名保留」「长度不足掩码时回退 ***」「递归脱敏嵌套对象与数组」：给每个 `sanitizeBody(…)` 调用补第三个参数 `{ maskPii: true }`，断言不变。
- 追加：

```ts
describe('明文开关与按路由敏感键（2026-11-26 日志完善）', () => {
  afterEach(() => { delete process.env.LOG_PII_MASK; });

  it('默认明文：手机号、身份证、银行卡、邮箱原样', () => {
    const clear = { phone: '13812341234', idCard: '510102199001011234', bankCard: '6222020200012345678', email: 'zhangsan@example.com' };
    expect(sanitizeBody(clear)).toEqual(clear);
  });

  it('环境变量与显式参数：显式 maskPii 优先于环境变量', () => {
    process.env.LOG_PII_MASK = 'true';
    expect(sanitizeBody({ phone: '13812341234' })).toEqual({ phone: '138****1234' });
    expect(sanitizeBody({ phone: '13812341234' }, 4096, { maskPii: false })).toEqual({ phone: '13812341234' });
    delete process.env.LOG_PII_MASK;
    expect(sanitizeBody({ phone: '13812341234' }, 4096, { maskPii: true })).toEqual({ phone: '138****1234' });
  });

  it('登记键恒为 ***，嵌套里也盖得住；未登记路由的 code 原样', () => {
    expect(sanitizeBody({ code: '654321', nested: { code: '654321' } }, 4096, { extraCredentialKeys: new Set(['code']) }))
      .toEqual({ code: '***', nested: { code: '***' } });
    expect(sanitizeBody({ code: 'SWHI-JJ-001' })).toEqual({ code: 'SWHI-JJ-001' });
  });

  it('查询串：登记键掩码，未登记时原样', () => {
    expect(sanitizeQueryString('t=secret-token-123&page=2', 2048, new Set(['t']))).toBe('t=***&page=2');
    expect(sanitizeQueryString('code=abc123')).toBe('code=abc123');
  });

  it('Buffer / 字符串 / 数组请求体：不抛异常且结果受限', () => {
    expect((sanitizeBody(Buffer.alloc(5000, 0x41), 1024) as any)._truncated).toBe(true);
    expect(sanitizeBody('x'.repeat(5000), 1024)).toMatchObject({ _truncated: true });
    expect(sanitizeBody([{ phone: '13812341234' }], 4096, { maskPii: true })).toEqual([{ phone: '138****1234' }]);
  });

  it('bodyPreview：普通体取 JSON、截断体只取预览文本、空体为 null', () => {
    expect(bodyPreview({ a: 1 }, 300)).toBe('{"a":1}');
    expect(bodyPreview({ _truncated: true, preview: 'x'.repeat(500) }, 300)).toBe('x'.repeat(300) + '…[截断]');
    expect(bodyPreview(null, 300)).toBeNull();
  });

  it('读端重新打码：明文打码，旧掩码值原样返回', () => {
    const clear = { phone: '13812341234', mobile: '02812345678', idCard: '510102199001011234', bankCard: '6222020200012345678', accountNo: '6222020200112233445', email: 'zhangsan@example.com', telephone: '123' };
    const once = maskPiiForReader(clear) as Record<string, unknown>;
    expect(once).toEqual({ phone: '138****1234', mobile: '028****5678', idCard: '510102********1234', bankCard: '6222****5678', accountNo: '6222****3445', email: 'z***@example.com', telephone: '***' });
    expect(maskPiiForReader(once)).toEqual(once);
  });

  it('读端重新打码：截断体的预览文本也盖得住，含值被截在一半的情况', () => {
    const preview = JSON.stringify({ phone: '13812341234', idCard: '510102199001011234' }).slice(0, 43);
    expect(preview).toBe('{"phone":"13812341234","idCard":"5101021990');
    expect((maskPiiForReader({ _truncated: true, preview }) as { preview: string }).preview).toBe('{"phone":"138****1234","idCard":"510102****1990');
    expect((maskPiiForReader({ _truncated: true, preview: '{"code":"654321","note":"x' }, new Set(['code'])) as { preview: string }).preview).toBe('{"code":"***","note":"x');
  });
});
```

- [ ] **Step 2: 跑，确认 RED**

Run: `cd "$API" && ./node_modules/.bin/jest src/logging/pii-switch.spec.ts src/operation-log/sensitive-routes.spec.ts src/operation-log/sanitize.util.spec.ts`
Expected: 前两个 `Cannot find module`；第三个 `Test suite failed to run`（`bodyPreview`、`maskPiiForReader` 不存在）。

- [ ] **Step 3: 实现**

`sensitive-routes.ts`：登记表照设计稿 6.8 的表逐行写；路径比较前先归一（补 `/api` 前缀、去结尾斜杠），带 `:参数` 的规则转成正则（每段 `[^/]+`）匹配。

`sanitize.util.ts`：`sanitizeValue` 加 `opts`，凭证判断多一条 `opts?.extraCredentialKeys?.has(key.toLowerCase())`；个人信息四类只在 `maskPii` 为真时处理，默认值取 `piiMaskingEnabled()`；`sanitizeObject`、`sanitizeBody` 把 `opts` 传下去；`sanitizeQueryString` 多认一个 `extraCredentialKeys`。`bodyPreview` 对普通体做一次 `JSON.stringify` 后截断，对 `{ _truncated, preview }` 只截预览文本。`maskPiiForReader` 恒打码（不看环境变量）：普通体走 `sanitizeObject(body, { maskPii: true, extraCredentialKeys })`；截断体对预览文本按「键值对」处理——键命中个人信息或凭证的，值替换成同类掩码，值在结尾被截断、没有收尾引号的也要处理。掩码函数沿用现有的四个，它们对已掩码的值再算一次结果不变。

- [ ] **Step 4: 跑，确认 GREEN**

Run: 同 Step 2。Expected: 三个 spec 全过。

- [ ] **Step 5: 类型检查与提交**

Run: `cd "$API" && ./node_modules/.bin/tsc --noEmit`（Expected 无输出）

```bash
cd "$WT" && git add water-erp/apps/api/src/logging/pii-switch.ts water-erp/apps/api/src/logging/pii-switch.spec.ts water-erp/apps/api/src/operation-log/sensitive-routes.ts water-erp/apps/api/src/operation-log/sensitive-routes.spec.ts water-erp/apps/api/src/operation-log/sanitize.util.ts water-erp/apps/api/src/operation-log/sanitize.util.spec.ts
git commit -m "feat(logging): 日志明文开关、按路由登记的敏感键与非 admin 读端打码" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 6: 身份尽早记录、元信息守卫、中文动作名

**Files:**
- Create: `api/src/logging/action-labels.ts`，Test: `api/src/logging/action-labels.spec.ts`
- Create: `api/src/logging/request-meta.util.ts`
- Create: `api/src/logging/request-meta.guard.ts`，Test: `api/src/logging/request-meta.spec.ts`
- Modify: `api/src/auth/auth.guard.ts`（第 58 行 `select`；第 56 行查库之后加一行）
- Test: `api/src/auth/auth.guard.spec.ts`（新建）
- Modify: `api/src/app.module.ts`（`providers` 里排在最前的守卫）

**Interfaces:**
- Consumes: 任务 1 的 `noteLogIdentity`、`identityFromToken`。
- Produces:

  ```ts
  // action-labels.ts
  export const API_OPERATION_METADATA_KEY = 'swagger/apiOperation'
  export const ACTION_LABEL_OVERRIDES: Record<string, string>     // 键为 `方法 /api/路径`
  export function normalizeRoutePattern(route: string | null | undefined): string | undefined   // 补开头的斜杠与 /api 前缀、去结尾斜杠
  export function resolveActionLabel(method: string, route: string | null | undefined, summary: string | undefined): string | undefined   // 纠偏表 → 摘要 → undefined
  // request-meta.util.ts
  export interface HandlerMeta { handler: string; route?: string; action?: string }
  export function stampHandlerMeta(req: Request, meta: HandlerMeta): void    // 写到 req.handlerMeta
  export function getHandlerMeta(req: Request): HandlerMeta | undefined
  // request-meta.guard.ts
  export class RequestMetaGuard implements CanActivate { constructor(reflector: Reflector) }   // 恒放行，不是鉴权守卫
  ```

- [ ] **Step 1: 写失败的测试** `api/src/logging/action-labels.spec.ts`

```ts
import { Controller, Get } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ACTION_LABEL_OVERRIDES, API_OPERATION_METADATA_KEY, normalizeRoutePattern, resolveActionLabel } from './action-labels';

@Controller('thing')
class ProbeController {
  @ApiOperation({ summary: '真实摘要' })
  @Get(':id')
  one() {}
}

describe('中文动作名三级来源（设计稿 6.6）', () => {
  it('元信息键钉在真实的 @ApiOperation 装饰器上', () => {
    expect(Reflect.getMetadata(API_OPERATION_METADATA_KEY, ProbeController.prototype.one)).toMatchObject({ summary: '真实摘要' });
  });

  it('纠偏表优先于摘要，其次取摘要，都没有返回 undefined', () => {
    expect(resolveActionLabel('GET', '/api/project-management', 'List projects')).toBe('项目列表');
    expect(resolveActionLabel('GET', '/api/thing/:id', '真实摘要')).toBe('真实摘要');
    expect(resolveActionLabel('GET', '/api/time', undefined)).toBe('服务器时间');
    expect(resolveActionLabel('GET', '/api/nope', undefined)).toBeUndefined();
    expect(resolveActionLabel('GET', '/api/nope', '')).toBeUndefined();
  });

  it('路由归一：补 /api 前缀、去结尾斜杠', () => {
    expect(normalizeRoutePattern('/api/project-management/')).toBe('/api/project-management');
    expect(normalizeRoutePattern('user-settings')).toBe('/api/user-settings');
    expect(normalizeRoutePattern(undefined)).toBeUndefined();
  });

  it('纠偏表覆盖设计稿附录 B 的全部路由，另加保存个人设置', () => {
    expect(Object.keys(ACTION_LABEL_OVERRIDES).sort()).toEqual([
      'GET /api/expert-admin/demand-rep-directory',
      'GET /api/expert/profile/contact-check',
      'GET /api/expert/projects',
      'GET /api/expert/projects/:projectId',
      'GET /api/expert/projects/:projectId/my-scores',
      'GET /api/knowledge',
      'GET /api/opening-hall/:projectId/messages',
      'GET /api/platform-push/pending',
      'GET /api/procurements',
      'GET /api/project-management',
      'GET /api/project-management/project-attributions',
      'GET /api/supplier-portal/award-letters',
      'GET /api/supplier-portal/bid-projects',
      'GET /api/supplier-portal/bid-projects/:id',
      'GET /api/supplier-portal/contracts',
      'GET /api/supplier-portal/dashboard-stats',
      'GET /api/supplier-portal/profile',
      'GET /api/supplier-portal/status',
      'GET /api/tender-review/review/stats/today',
      'GET /api/tender-review/rules',
      'GET /api/time',
      'GET /api/user-settings',
      'GET /api/work-arrangements',
      'GET /api/work-arrangements/daily-plan',
      'GET /api/work-arrangements/portrait',
      'PATCH /api/user-settings',
      'POST /api/tender-sample',
      'POST /api/work-arrangements/daily-plan/refresh',
    ]);
  });
});
```

中文名逐条（执行时照此写入，不在测试里重复）：项目列表、项目归属选项、读取个人设置、保存个人设置、工作安排列表、今日安排、重新生成今日安排、工作画像、我的供应商状态、我的供应商资料、可投项目列表、投标项目详情、我的中标通知书、我的合同、供应商首页统计、服务器时间、待推送清单、新建范本、我的评审项目列表、评审项目详情、我的评分、联系方式核查、开标大厅消息、采购台账列表、知识库列表、合规规则列表、今日审查统计、需求方代表名录。参数名以本表为准（`opening-hall` 的是 `:projectId`，与设计稿附录 B 的简写不同，已对代码核实）。

`api/src/logging/request-meta.spec.ts`:

```ts
import { ExecutionContext, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiOperation } from '@nestjs/swagger';
import { RequestMetaGuard } from './request-meta.guard';
import { getHandlerMeta } from './request-meta.util';

class ProbeController {
  @ApiOperation({ summary: '真实摘要' })
  @Get()
  load() {}

  @Get()
  plain() {}
}

describe('元信息守卫（设计稿 6.5）', () => {
  const guard = new RequestMetaGuard(new Reflector());
  const run = (req: any, handler: () => void) =>
    guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }), getHandler: () => handler, getClass: () => ProbeController } as unknown as ExecutionContext);

  it('一进来就把 控制器.方法、路由模式、中文动作挂到请求上，并放行', () => {
    const req: any = { method: 'GET', route: { path: '/api/user-settings' } };
    expect(run(req, ProbeController.prototype.load)).toBe(true);
    expect(getHandlerMeta(req)).toEqual({ handler: 'ProbeController.load', route: '/api/user-settings', action: '真实摘要' });
  });

  it('没有摘要的路由取纠偏表；没有路由信息时只挂处理器', () => {
    const req: any = { method: 'GET', route: { path: '/api/time' } };
    run(req, ProbeController.prototype.plain);
    expect(getHandlerMeta(req)).toEqual({ handler: 'ProbeController.plain', route: '/api/time', action: '服务器时间' });
    const bare: any = { method: 'GET' };
    expect(run(bare, ProbeController.prototype.plain)).toBe(true);
    expect(getHandlerMeta(bare)).toEqual({ handler: 'ProbeController.plain' });
  });
});
```

`api/src/auth/auth.guard.spec.ts`（新建）:

```ts
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { currentLogContext, runWithLogContext } from '../logging/request-context.storage';

const payload = { sub: 'u1', username: 'Swhi-CGZX-05', role: 'staff', sid: 'sid-old' };
const userRow = (over: Record<string, unknown> = {}) =>
  ({ isActive: true, isFrozen: false, isTempExpert: false, webSessionId: 'sid-old', passwordChangedAt: null, displayName: '彭强', ...over });
function handler() {}
class Guarded {}

function setup(row: unknown) {
  const prisma = { user: { findUnique: jest.fn().mockResolvedValue(row) }, bidExpert: { count: jest.fn().mockResolvedValue(1) } };
  const jwt = { verifyAsync: jest.fn().mockResolvedValue(payload) };
  const guard = new AuthGuard(jwt as any, new Reflector(), prisma as any);
  const req: any = { method: 'GET', path: '/api/user-settings', headers: { 'x-web-token': 'tok', 'x-portal': 'web' }, cookies: {} };
  const ctx: any = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => handler, getClass: () => Guarded };
  return { guard, req, ctx, prisma, jwt };
}
const inRequest = (fn: () => Promise<unknown>) => {
  const seen: Array<ReturnType<typeof currentLogContext>> = [];
  const run = runWithLogContext({ requestId: '4be10a77', kind: 'http', startedAt: 0 }, async () => { await fn(); seen.push(currentLogContext()); });
  return run.then(() => seen[0]);
};

describe('AuthGuard 记日志身份（设计稿 6.2）', () => {
  it('查到用户就记身份：被顶下线的 401 也看得出是谁；同一次查询带出姓名', async () => {
    const { guard, ctx, prisma } = setup(userRow({ webSessionId: 'sid-new' }));
    const seen = await inRequest(() => expect(guard.canActivate(ctx)).rejects.toMatchObject({ response: { code: 'SESSION_REPLACED' } }));
    expect(seen?.identity).toEqual({ userId: 'u1', username: 'Swhi-CGZX-05', role: 'staff', displayName: '彭强' });
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ displayName: true }) }));
  });

  it('验签失败不记身份', async () => {
    const { guard, ctx, jwt } = setup(userRow());
    jwt.verifyAsync.mockRejectedValue(new Error('bad token'));
    const seen = await inRequest(() => expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException));
    expect(seen?.identity).toBeUndefined();
  });

  it('校验通过：req.user 照旧挂载，身份同样记下', async () => {
    const { guard, req, ctx } = setup(userRow());
    const seen = await inRequest(() => expect(guard.canActivate(ctx)).resolves.toBe(true));
    expect(req.user).toEqual(payload);
    expect(seen?.identity).toMatchObject({ userId: 'u1', role: 'staff' });
  });
});
```

- [ ] **Step 2: 跑，确认 RED**

Run: `cd "$API" && ./node_modules/.bin/jest src/logging/action-labels.spec.ts src/logging/request-meta.spec.ts src/auth/auth.guard.spec.ts`
Expected: 前两个 `Cannot find module`；第三个可运行，第一条失败在 `expected undefined to equal {…}`。

- [ ] **Step 3: 实现**

`action-labels.ts`：纠偏表 28 行照 Step 1 的清单与中文名写；`resolveActionLabel` 先归一路由，再查表、再取非空摘要。元信息键用字面量：`@nestjs/swagger` 11.4.4 的包导出表不开放 `DECORATORS`，深层导入在类型与运行时都走不通。

`request-meta.guard.ts`：`canActivate` 里取 `req.route?.path` 当路由模式（Express 在进入路由前就挂好了，带 `/api` 前缀），`this.reflector.get(API_OPERATION_METADATA_KEY, handler)?.summary` 取摘要，`类名.方法名` 取处理器，`stampHandlerMeta` 后返回 `true`。

`auth/auth.guard.ts`：`select` 末尾加 `displayName: true`；查库那行之后、`if (!user || !user.isActive)` 之前加一行 `noteLogIdentity(identityFromToken({ ...payload, displayName: user?.displayName }));`，并带注释说明「日志身份，不影响下面的拒绝条件与顺序」。

`app.module.ts`：`providers` 最前面加 `{ provide: APP_GUARD, useClass: RequestMetaGuard }`，注释写明恒放行、不是鉴权守卫。

- [ ] **Step 4: 跑，确认 GREEN**

Run: 同 Step 2。Expected: 三个 spec 全过（动作名 4、守卫 2、身份 3）。

- [ ] **Step 5: 类型检查与提交**

Run: `cd "$API" && ./node_modules/.bin/tsc --noEmit`（Expected 无输出）

```bash
cd "$WT" && git add water-erp/apps/api/src/logging/action-labels.ts water-erp/apps/api/src/logging/action-labels.spec.ts water-erp/apps/api/src/logging/request-meta.util.ts water-erp/apps/api/src/logging/request-meta.guard.ts water-erp/apps/api/src/logging/request-meta.spec.ts water-erp/apps/api/src/auth/auth.guard.ts water-erp/apps/api/src/auth/auth.guard.spec.ts water-erp/apps/api/src/app.module.ts
git commit -m "feat(logging): 验签即记身份、请求元信息守卫与中文动作名" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 7: 请求完成行、耗时口径、排除表

**Files:**
- Create: `api/src/logging/request-line.util.ts`，Test: `api/src/logging/request-line.util.spec.ts`
- Create: `api/src/logging/request-line.ts`，Test: `api/src/logging/request-line.spec.ts`
- Modify: `api/src/operation-log/operation-log.types.ts`
- Modify: `api/src/operation-log/log-entry.util.ts`，Test: `api/src/operation-log/log-entry.util.spec.ts`
- Modify: `api/src/operation-log/operation-log.interceptor.ts`，Test: `api/src/operation-log/operation-log.interceptor.spec.ts`（新建）
- Modify: `api/src/common/filters/http-exception.filter.ts`，Test: `api/src/common/filters/http-exception.filter.spec.ts`（加 5 个）
- Modify: `api/src/operation-log/operation-log.filter.ts`，Test: `api/src/operation-log/operation-log.filter.spec.ts`（加 1 个）
- Modify: `api/test/setup-throttle.ts`

**Interfaces:**
- Consumes: 任务 1 `currentLogContext`；任务 2 `sanitizeLogText`、`truncateLogText`；任务 4 `describeException`；任务 5 `sensitiveKeysFor`、`bodyPreview`、`SanitizeOptions`；任务 6 `getHandlerMeta`。
- Produces:

  ```ts
  // request-line.util.ts
  export const PARAMS_PREVIEW_MAX = 300;
  export interface RequestLineInput {
    method: string; path: string; query: string | null; statusCode: number; durationMs: number; action: string | null;
    errorCode?: string | null; message?: string | null; paramsPreview?: string | null;
  }
  export function formatRequestLine(input: RequestLineInput): string
  // request-line.ts
  export function httpAccessLogEnabled(): boolean                                      // HTTP_ACCESS_LOG !== 'off'，运行期读
  export function printRequestLine(entry: OperationLogEntry, error?: unknown, opts?: { params?: boolean }): void
  // operation-log.types.ts
  export interface OperationLogMeta { requestId?: string; handler?: string; route?: string; action?: string; source?: string }
  // log-entry.util.ts（多一个可选参数）
  export function buildLogEntry(req: Request, statusCode: number, durationMs: number, error: unknown | null, bodyMaxBytes: number, ctx?: LogContext): OperationLogEntry
  ```

- [ ] **Step 1: 写失败的测试**

`api/src/logging/request-line.util.spec.ts`:

```ts
import { formatRequestLine } from './request-line.util';

describe('请求完成行排版（设计稿 6.1）', () => {
  it('成功：→ 动作 方法 路径 状态 耗时', () => {
    expect(formatRequestLine({ method: 'POST', path: '/api/ocr/intake', query: null, statusCode: 200, durationMs: 1430, action: '证件识别' }))
      .toBe('→ 证件识别 POST /api/ocr/intake 200 1430ms');
  });

  it('没有动作名时省略动作段；查询串跟在路径后', () => {
    expect(formatRequestLine({ method: 'GET', path: '/api/x', query: 'page=2', statusCode: 200, durationMs: 3, action: null }))
      .toBe('→ GET /api/x?page=2 200 3ms');
  });

  it('4xx：带错误码、原因、参数摘要', () => {
    expect(formatRequestLine({
      method: 'POST', path: '/api/auth/login', query: null, statusCode: 401, durationMs: 6, action: '用户登录',
      errorCode: 'UNAUTHORIZED', message: '用户名或密码错误', paramsPreview: '{"username":"a","password":"***"}',
    })).toBe('→ 用户登录 POST /api/auth/login 401 6ms [UNAUTHORIZED] 用户名或密码错误 参数={"username":"a","password":"***"}');
  });

  it('净化：控制字符替换；路径与查询串合计超 500 字截断', () => {
    expect(formatRequestLine({ method: 'GET', path: '/api/x\u001b[31m', query: 'a\n1\u0000', statusCode: 200, durationMs: 1, action: null }))
      .toBe('→ GET /api/x?[31m?a?\n1? 200 1ms');
    const long = formatRequestLine({ method: 'GET', path: '/api/x', query: 'k=' + 'v'.repeat(600), statusCode: 200, durationMs: 1, action: null });
    expect(long.startsWith('→ GET /api/x?k=vvvv')).toBe(true);
    expect(long).toContain('…[截断]');
    expect(long.length).toBeLessThan(540);
  });
});
```

`api/src/logging/request-line.spec.ts`:

```ts
import { ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common';
import type { OperationLogEntry } from '../operation-log/operation-log.types';
import { printRequestLine } from './request-line';

const mk = (over: Partial<OperationLogEntry>): OperationLogEntry => ({
  userId: null, username: null, role: 'anonymous', portal: null, method: 'GET', path: '/api/x', query: null, body: { a: 1 },
  statusCode: 200, durationMs: 5, ipAddress: null, userAgent: null, referer: null, error: null, meta: { action: '读取' }, ...over,
});

describe('printRequestLine（设计稿 6.3）', () => {
  let spies: Record<'log' | 'warn' | 'error', jest.SpyInstance>;
  let access: string | undefined;
  beforeEach(() => {
    access = process.env.HTTP_ACCESS_LOG;
    delete process.env.HTTP_ACCESS_LOG;
    spies = {
      log: jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
      warn: jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
      error: jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
    };
  });
  afterEach(() => {
    Object.values(spies).forEach((s) => s.mockRestore());
    if (access === undefined) delete process.env.HTTP_ACCESS_LOG; else process.env.HTTP_ACCESS_LOG = access;
  });

  it('2xx 一行 INFO；4xx 一行 WARN 带错误码与参数；5xx 一行 ERROR 并带原始错误与堆栈', () => {
    printRequestLine(mk({}));
    expect(spies.log.mock.calls).toEqual([['→ 读取 GET /api/x 200 5ms']]);
    printRequestLine(mk({ statusCode: 401 }), new UnauthorizedException({ code: 'SESSION_REPLACED', error: '该账号已在其他设备登录，请重新登录' }));
    expect(spies.warn.mock.calls).toEqual([['→ 读取 GET /api/x 401 5ms [SESSION_REPLACED] 该账号已在其他设备登录，请重新登录 参数={"a":1}']]);
    printRequestLine(mk({ statusCode: 500 }), new Error('kaboom'));
    expect(spies.error.mock.calls[0][0]).toBe('→ 读取 GET /api/x 500 5ms [INTERNAL_ERROR] 服务器内部错误，请稍后重试或联系管理员\n原始错误: kaboom');
    expect(String(spies.error.mock.calls[0][1])).toContain('kaboom');
  });

  it('params 为 false 时不带参数摘要', () => {
    printRequestLine(mk({ statusCode: 403 }), new ForbiddenException(), { params: false });
    expect(spies.warn.mock.calls[0][0]).toBe('→ 读取 GET /api/x 403 5ms [FORBIDDEN] 无权访问该功能，请联系管理员开通权限');
  });

  it('HTTP_ACCESS_LOG=off 不打', () => {
    process.env.HTTP_ACCESS_LOG = 'off';
    printRequestLine(mk({}));
    printRequestLine(mk({ statusCode: 500 }), new Error('x'));
    expect(spies.log).not.toHaveBeenCalled();
    expect(spies.error).not.toHaveBeenCalled();
  });
});
```

`api/src/operation-log/log-entry.util.spec.ts`：文件顶部追加导入 `runWithLogContext`（`../logging/request-context.storage`）；把「异常：error 取 message」的断言改为 `expect(e.error).toBe('[INTERNAL_ERROR] 服务器内部错误，请稍后重试或联系管理员 | 原始: boom')`（用例名改「异常：error 存 [错误码] 中文原因，5xx 追加原文」）；追加三个用例（`makeReq` 是该文件既有的辅助函数，默认带 `x-portal: expert` 与请求体 `{ password: 'secret', score: 90 }`）：

```ts
it('验签后被拒：req.user 为空，身份取上下文；meta 带请求号、处理器、动作', () => {
  const req = makeReq({ handlerMeta: { handler: 'X.y', route: '/api/bid/score', action: '评分' } });
  const e = runWithLogContext(
    { requestId: '4be10a77', kind: 'http', startedAt: 0, identity: { userId: 'u1', username: 'Swhi-CGZX-05', role: 'staff', displayName: '彭强' } },
    () => buildLogEntry(req, 401, 3, new Error('x'), 4096),
  );
  expect(e).toMatchObject({ userId: 'u1', username: 'Swhi-CGZX-05', role: 'staff', meta: { requestId: '4be10a77', handler: 'X.y', route: '/api/bid/score', action: '评分' } });
});

it('没有上下文：meta 只有处理器信息；来源头进 meta.source', () => {
  const req = makeReq({ handlerMeta: { handler: 'X.y', route: '/api/bid/score', action: '评分' } });
  expect(buildLogEntry(req, 200, 1, null, 4096).meta).toEqual({ handler: 'X.y', route: '/api/bid/score', action: '评分' });
  const sourced = runWithLogContext({ requestId: '4be10a77', kind: 'http', startedAt: 0, source: 'mobile-3011' }, () => buildLogEntry(makeReq(), 200, 1, null, 4096));
  expect(sourced.meta).toEqual({ requestId: '4be10a77', source: 'mobile-3011' });
});

it('按路由登记的敏感键：回执令牌在查询串是 ***；其他路由的 t 原样', () => {
  const rsvp = makeReq({ method: 'GET', originalUrl: '/api/supplier/rsvp/verify?t=secret', path: '/api/supplier/rsvp/verify', url: '/api/supplier/rsvp/verify?t=secret', route: { path: '/api/supplier/rsvp/verify' } });
  expect(buildLogEntry(rsvp, 200, 1, null, 4096).query).toBe('t=***');
  const other = makeReq({ method: 'GET', originalUrl: '/api/other?t=1', path: '/api/other', url: '/api/other?t=1', route: { path: '/api/other' } });
  expect(buildLogEntry(other, 200, 1, null, 4096).query).toBe('t=1');
});
```

`api/src/operation-log/operation-log.interceptor.spec.ts`（新建）:

```ts
import { BadRequestException, Logger, Test } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import * as sanitizeUtil from './sanitize.util';
import { currentLogContext, runWithLogContext } from '../logging/request-context.storage';
import { OperationLogInterceptor } from './operation-log.interceptor';
import { OperationLogService } from './operation-log.service';

describe('OperationLogInterceptor 请求完成行（设计稿 6.3）', () => {
  let svc: { create: jest.Mock };
  let spies: Record<'log' | 'warn' | 'error', jest.SpyInstance>;
  let saved: Record<string, string | undefined>;
  const identity = { userId: 'u1', username: 'Swhi-CGZX-05', role: 'staff', displayName: '彭强' };
  const baseReq = () => ({
    method: 'GET', path: '/api/auth/me', originalUrl: '/api/auth/me', url: '/api/auth/me', headers: {}, socket: {},
    route: { path: '/api/auth/me' },
    handlerMeta: { handler: 'AuthController.me', route: '/api/auth/me', action: '获取当前用户信息' },
  }) as any;
  const ctxFor = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ statusCode: 200 }) }) }) as any;
  const inRequest = <T>(req: any, body: () => T) =>
    runWithLogContext({ requestId: '4be10a77', kind: 'http', startedAt: Date.now() - 50, identity, portal: 'web' }, body);
  const build = async () => {
    const mod = await Test.createTestingModule({ providers: [OperationLogInterceptor, { provide: OperationLogService, useValue: svc }] }).compile();
    return mod.get(OperationLogInterceptor);
  };
  const fail = (err: () => unknown) => ({ handle: () => throwError(err) });

  beforeEach(async () => {
    saved = { OPERATION_LOG_ENABLED: process.env.OPERATION_LOG_ENABLED, HTTP_ACCESS_LOG: process.env.HTTP_ACCESS_LOG };
    delete process.env.OPERATION_LOG_ENABLED;
    delete process.env.HTTP_ACCESS_LOG;
    svc = { create: jest.fn().mockResolvedValue(undefined) };
    spies = {
      log: jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
      warn: jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
      error: jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined),
    };
  });
  afterEach(() => {
    Object.values(spies).forEach((s) => s.mockRestore());
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  it('成功：一行 INFO、落库带请求号与处理器、耗时从进入时刻起算', async () => {
    const interceptor = await build();
    const req = baseReq();
    let seen: ReturnType<typeof currentLogContext>;
    spies.log.mockImplementation(() => { seen = currentLogContext(); });
    await inRequest(req, () => lastValueFrom(interceptor.intercept(ctxFor(req), { handle: () => of({ ok: true }) })));
    expect(spies.log).toHaveBeenCalledTimes(1);
    expect(spies.log.mock.calls[0][0]).toMatch(/^→ 获取当前用户信息 GET \/api\/auth\/me 200 \d+ms$/);
    expect(seen).toMatchObject({ requestId: '4be10a77', identity });
    expect(svc.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', statusCode: 200, durationMs: expect.any(Number),
      meta: { requestId: '4be10a77', handler: 'AuthController.me', route: '/api/auth/me', action: '获取当前用户信息' },
    }));
    expect(svc.create.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(50);
    expect(req.__oplogRecorded).toBe(true);
  });

  it('4xx：一行 WARN，带错误码、原因、参数摘要；error 列存 [错误码] 中文原因', async () => {
    const interceptor = await build();
    const req = { ...baseReq(), method: 'POST', body: { name: '甲' } };
    await inRequest(req, () => lastValueFrom(interceptor.intercept(ctxFor(req), fail(() => new BadRequestException({ code: 'BAD_DRAFT_KEY', error: '不支持的草稿键' })))).catch(() => undefined));
    expect(spies.warn).toHaveBeenCalledTimes(1);
    expect(spies.warn.mock.calls[0][0]).toMatch(/^→ 获取当前用户信息 POST \/api\/auth\/me 400 \d+ms \[BAD_DRAFT_KEY\] 不支持的草稿键 参数=\{"name":"甲"\}$/);
    expect(svc.create.mock.calls[0][0]).toMatchObject({ statusCode: 400, error: '[BAD_DRAFT_KEY] 不支持的草稿键' });
  });

  it('5xx：ERROR 行后跟原始错误与堆栈', async () => {
    const interceptor = await build();
    const req = baseReq();
    await inRequest(req, () => lastValueFrom(interceptor.intercept(ctxFor(req), fail(() => new Error('kaboom')))).catch(() => undefined));
    expect(spies.error).toHaveBeenCalledTimes(1);
    expect(spies.error.mock.calls[0][0]).toContain('原始错误: kaboom');
    expect(String(spies.error.mock.calls[0][1])).toContain('kaboom');
  });

  it('排除表路由：成功静默、不落库', async () => {
    const interceptor = await build();
    const req = { ...baseReq(), path: '/api/auth/heartbeat', originalUrl: '/api/auth/heartbeat' };
    await inRequest(req, () => lastValueFrom(interceptor.intercept(ctxFor(req), { handle: () => of(1) }))));
    expect(spies.log).not.toHaveBeenCalled();
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('操作日志关掉：请求完成行照打，但不落库', async () => {
    process.env.OPERATION_LOG_ENABLED = 'false';
    const interceptor = await build();
    const req = baseReq();
    await inRequest(req, () => lastValueFrom(interceptor.intercept(ctxFor(req), { handle: () => of(1) }))));
    expect(spies.log).toHaveBeenCalledTimes(1);
    expect(svc.create).not.toHaveBeenCalled();
  });

  it('HTTP_ACCESS_LOG=off：不打请求完成行，照常落库', async () => {
    process.env.HTTP_ACCESS_LOG = 'off';
    const interceptor = await build();
    const req = baseReq();
    await inRequest(req, () => lastValueFrom(interceptor.intercept(ctxFor(req), { handle: () => of(1) }))));
    expect(spies.log).not.toHaveBeenCalled();
    expect(svc.create).toHaveBeenCalledTimes(1);
  });

  it('截断体：参数摘要取预览文本前 300 字，脱敏只走一遍', async () => {
    const interceptor = await build();
    const walk = jest.spyOn(sanitizeUtil, 'sanitizeBody');
    const req = { ...baseReq(), method: 'POST', body: { data: 'y'.repeat(5000) } };
    await inRequest(req, () => lastValueFrom(interceptor.intercept(ctxFor(req), fail(() => new BadRequestException('x')))).catch(() => undefined));
    expect(walk).toHaveBeenCalledTimes(1);
    expect(spies.warn.mock.calls[0][0]).toContain('参数={"data":"' + 'y'.repeat(291) + '…[截断]');
  });
});
```

`api/src/common/filters/http-exception.filter.spec.ts`：第一个 `describe` 追加导入 `Logger`（`@nestjs/common`）与 `runWithLogContext`（`../../logging/request-context.storage`），加 5 个用例：

```ts
it('标志未设 → 打一行请求完成行并补记；error 列存 [错误码] 中文原因', () => {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  try {
    filter.catch(new HttpException('Forbidden', HttpStatus.FORBIDDEN), makeHost());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('GET /api/x 403');
    expect(oplog.create.mock.calls[0][0].error).toBe('[FORBIDDEN] 无权访问该功能，请联系管理员开通权限');
  } finally { warn.mockRestore(); }
});

it('标志已设（拦截器已打）→ 不再打请求完成行', () => {
  const quiet = ['log', 'warn', 'error'].map((m) => jest.spyOn(Logger.prototype, m as 'log').mockImplementation(() => undefined));
  try {
    filter.catch(new HttpException('boom', HttpStatus.BAD_REQUEST), makeHost({ __oplogRecorded: true }));
    for (const s of quiet) expect(s).not.toHaveBeenCalled();
  } finally { quiet.forEach((s) => s.mockRestore()); }
});

it('排除路径：打一行但不带参数摘要、不补记', () => {
  const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  try {
    const host = makeHost({ method: 'POST', url: '/api/docs', path: '/api/docs', body: { note: 'n' } });
    filter.catch(new HttpException('boom', HttpStatus.INTERNAL_SERVER_ERROR), host);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('POST /api/docs 500');
    expect(error.mock.calls[0][0]).not.toContain('参数=');
    expect(oplog.create).not.toHaveBeenCalled();
  } finally { error.mockRestore(); }
});

it('Prisma P2025：按映射后的 404 记录与打印', () => {
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  try {
    filter.catch(new Prisma.PrismaClientKnownRequestError('record not found', { code: 'P2025', clientVersion: 'test' }), makeHost());
    expect(oplog.create.mock.calls[0][0]).toMatchObject({ statusCode: 404, error: '[RECORD_NOT_FOUND] 操作的记录不存在或已被删除，请刷新后重试。' });
    expect(warn.mock.calls[0][0]).toContain('GET /api/x 404');
  } finally { warn.mockRestore(); }
});

it('有请求上下文：耗时从请求进入时刻起算，meta 带请求号', () => {
  const quiet = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  try {
    runWithLogContext({ requestId: '4be10a77', kind: 'http', startedAt: Date.now() - 50 }, () => filter.catch(new HttpException('boom', 400), makeHost()));
    expect(oplog.create.mock.calls[0][0]).toMatchObject({ meta: { requestId: '4be10a77' } });
    expect(oplog.create.mock.calls[0][0].durationMs).toBeGreaterThanOrEqual(50);
  } finally { quiet.mockRestore(); }
});
```

`api/src/operation-log/operation-log.filter.spec.ts` 加 1 个：

```ts
it('供应商角标轮询 my-pending-count 只排除 GET（2026-11-26）', () => {
  expect(shouldExclude('GET', '/api/supplier/approvals/my-pending-count', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  expect(shouldExclude('POST', '/api/supplier/approvals/my-pending-count', DEFAULT_EXCLUDE_PATHS)).toBe(false);
});
```

- [ ] **Step 2: 跑，确认 RED**

Run: `cd "$API" && ./node_modules/.bin/jest src/logging/request-line src/operation-log src/common/filters`
Expected: `request-line.*` 两个 `Cannot find module`；`log-entry` 与过滤器新增用例可运行并失败（`meta` 为 `undefined`、没有调用 `Logger`）；既有用例仍绿。

- [ ] **Step 3: 实现**

`request-line.util.ts`：`formatRequestLine` 先把路径与查询串合成一段，净化后截到 500 字，再拼 `→ [动作 ]方法 路径 状态 耗时ms`；状态码小于 400 到此为止，否则追加 `[错误码] 原因`，有参数摘要再追加 ` 参数=摘要`。

`request-line.ts`：模块级一个无模块名的 `new Logger()`；关着开关直接返回；状态码不小于 400 且传了异常时用 `describeException` 取日志码、原因、原文、堆栈；`opts.params` 不是 `false` 才取 `bodyPreview(entry.body, PARAMS_PREVIEW_MAX)`；2xx 走 `log`、4xx 走 `warn`、5xx 走 `error`（消息后换行接 `原始错误: …`，堆栈作第二个参数）。整个函数包在 `try/catch` 里，出错只 `warn` 一次。

`operation-log.types.ts`：加 `OperationLogMeta`，`OperationLogEntry` 加 `meta?: OperationLogMeta`。

`log-entry.util.ts`：身份取 `ctx?.identity`，没有再从 `req.user` 转（`identityFromToken`），`role` 缺省 `anonymous`；路由模式取 `req.handlerMeta?.route ?? req.route?.path`，交给 `sensitiveKeysFor` 得到请求体键与查询串键，分别传给 `sanitizeBody` 的 `extraCredentialKeys` 与 `sanitizeQueryString`；`error` 取 `formatErrorForLog(describeException(error))` 并截到 1024 字；`meta` 由 `requestId`（上下文）、`handler`、`route`、`action`（元信息）、`source`（上下文）拼成，全是 `undefined` 就不带这个键。

`operation-log.interceptor.ts`：两个开关都关才直接放行；命中排除表也直接放行（失败由过滤器打一行）；`record` 里耗时取「现在减上下文的进入时刻」，没有上下文才用自己记的起点；先 `printRequestLine(entry, error)`，开关开着才 `create`；`catchError` 的状态码取 `describeException(err).status`。

`http-exception.filter.ts`：删掉搬走的映射表、辅助函数与各分支里的 `this.logger.error`／`warn`，改用 `describeException` 出响应；补记条件改为「标志没设」，其中是否入库另看「操作日志开着且不在排除表」；打印用 `printRequestLine(entry, exception, { params: !excluded })`；耗时同拦截器口径，没有上下文为 0。

`operation-log.filter.ts`：`DEFAULT_EXCLUDE_PATHS` 加 `{ method: 'GET', path: '/api/supplier/approvals/my-pending-count' }`。

`api/test/setup-throttle.ts` 末尾加：`process.env.HTTP_ACCESS_LOG = process.env.HTTP_ACCESS_LOG ?? 'off';`，注释写明 e2e 默认关掉请求完成行免得每个请求一行刷屏，要断言该行的用例自己打开。

- [ ] **Step 4: 跑，确认 GREEN**

Run: `cd "$API" && ./node_modules/.bin/jest src/logging src/operation-log src/common/filters src/auth/auth.guard.spec.ts`
Expected: 全过。

- [ ] **Step 5: 类型检查与提交**

Run: `cd "$API" && ./node_modules/.bin/tsc --noEmit`（Expected 无输出）

```bash
cd "$WT" && git add water-erp/apps/api/src/logging/request-line.util.ts water-erp/apps/api/src/logging/request-line.util.spec.ts water-erp/apps/api/src/logging/request-line.ts water-erp/apps/api/src/logging/request-line.spec.ts water-erp/apps/api/src/operation-log/operation-log.types.ts water-erp/apps/api/src/operation-log/log-entry.util.ts water-erp/apps/api/src/operation-log/log-entry.util.spec.ts water-erp/apps/api/src/operation-log/operation-log.interceptor.ts water-erp/apps/api/src/operation-log/operation-log.interceptor.spec.ts water-erp/apps/api/src/common/filters/http-exception.filter.ts water-erp/apps/api/src/common/filters/http-exception.filter.spec.ts water-erp/apps/api/src/operation-log/operation-log.filter.ts water-erp/apps/api/src/operation-log/operation-log.filter.spec.ts water-erp/apps/api/test/setup-throttle.ts
git commit -m "feat(logging): 每个请求一行完成行（动作、身份、状态、耗时、原因），耗时从进入时刻起算，角标轮询入排除表" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 8: WS 连接上下文与短信控制台行

**Files:**
- Create: `api/src/logging/ws-context.util.ts`（测试并入 `api/src/logging/request-context.spec.ts`，加 2 个）
- Modify: `api/src/notification/notification.gateway.ts`，Test: `api/src/notification/notification.gateway.spec.ts`（加 2 个）
- Modify: `api/src/bid/bid.gateway.ts`，Test: `api/src/bid/bid.gateway.spec.ts`（加 1 个）
- Modify: `api/src/chat/chat.gateway.ts`，Test: `api/src/chat/chat.gateway.spec.ts`（新建，1 个）
- Modify: `api/src/notification/channels/sms.channel.ts`，Test: `api/src/notification/channels/sms.channel.spec.ts`（加 1 个）
- Modify: `api/src/verification/sms-provider.ts`，Test: `api/src/verification/sms-provider.spec.ts`（加 2 个）

**Interfaces:**
- Consumes: 任务 1 的 `runWithLogContext`、`noteLogIdentity`、`identityFromToken`、`currentLogContext`；任务 5 的 `phoneForLog`；`bid/bid.gateway.ts` 导出的 `portalFromHandshake`。
- Produces:

  ```ts
  export function wsLogContext(socket: Socket): LogContext
  // requestId = socket.id 前 8 位；kind 'ws'；门户取 portalFromHandshake；IP 取握手地址并经 getClientIp 归一；握手信息取不到的字段省略，不抛异常
  ```

- [ ] **Step 1: 写失败的测试**

`api/src/logging/request-context.spec.ts` 追加（导入 `type { Socket } from 'socket.io'` 与 `wsLogContext`）:

```ts
describe('WS 连接上下文（设计稿 6.2）', () => {
  it('连接号取 socket.id 前 8 位，门户与地址来自握手', () => {
    const socket = { id: 'QP3Ddd94EfV5L5YYAAFN', handshake: { headers: { 'x-portal': 'web' }, address: '::1', query: {} } } as unknown as Socket;
    expect(wsLogContext(socket)).toMatchObject({ requestId: 'QP3Ddd94', kind: 'ws', portal: 'web', ip: '127.0.0.1' });
  });

  it('握手信息残缺时相应字段省略，不抛异常', () => {
    expect(wsLogContext({ id: 'sock-1' } as unknown as Socket)).toMatchObject({ requestId: 'sock-1', kind: 'ws' });
  });
});
```

`api/src/notification/notification.gateway.spec.ts` 文件末尾追加（导入 `Logger` 与 `currentLogContext`）:

```ts
describe('NotificationGateway 握手日志带连接上下文（设计稿 6.2）', () => {
  const makeClient = () => ({
    id: 'QP3Ddd94EfV5L5YYAAFN',
    handshake: { headers: { origin: 'http://localhost:3005', cookie: 'token_web=jwt-x' }, address: '::1' },
    data: {} as any, join: jest.fn(), disconnect: jest.fn(),
  }) as any;
  type Ctx = ReturnType<typeof currentLogContext>;
  const capture = (seen: Ctx[]) => jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => { seen.push(currentLogContext()); });

  it('验签后握手日志带连接号与身份；查过库的路径顺带取姓名', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1', username: 'Swhi-CGZX-05', role: 'staff' }) };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ webSessionId: 'sid-old', displayName: '彭强' }) } };
    const gw = new NotificationGateway(jwt as any, prisma as any);
    const seen: Ctx[] = [];
    const debug = capture(seen);
    try {
      await gw.handleConnection(makeClient());
      jwt.verifyAsync.mockResolvedValue({ sub: 'u1', username: 'Swhi-CGZX-05', role: 'staff', sid: 'sid-old' });
      await gw.handleConnection(makeClient());
    } finally { debug.mockRestore(); }
    expect(prisma.user.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ displayName: true }) }));
    expect(seen).toEqual([
      expect.objectContaining({ requestId: 'QP3Ddd94', kind: 'ws', portal: 'web', ip: '127.0.0.1', identity: { userId: 'u1', username: 'Swhi-CGZX-05', role: 'staff' } }),
      expect.objectContaining({ identity: { userId: 'u1', username: 'Swhi-CGZX-05', role: 'staff', displayName: '彭强' } }),
    ]);
  });

  it('拒绝匿名连接那一行也带连接号', async () => {
    const gw = new NotificationGateway({ verifyAsync: jest.fn() } as any, {} as any);
    const client = makeClient();
    client.handshake.headers = {};
    const seen: Ctx[] = [];
    const debug = capture(seen);
    try { await gw.handleConnection(client); } finally { debug.mockRestore(); }
    expect(seen).toEqual([expect.objectContaining({ requestId: 'QP3Ddd94', kind: 'ws' })]);
  });
});
```

`api/src/bid/bid.gateway.spec.ts` 文件末尾追加（同样导入 `Logger`、`currentLogContext`）:

```ts
describe('BidGateway 握手日志带连接上下文（设计稿 6.2）', () => {
  it('主持人连接：握手日志带连接号与身份，入会鉴权 promise 的挂载时机不变', async () => {
    const prisma = { user: { findUnique: jest.fn() }, bidProject: { findUnique: jest.fn().mockResolvedValue(null) } } as any;
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u-host', username: '陈源远', role: 'bid_host' }) } as any;
    const gw = new BidGateway(jwt, prisma);
    const socket = ({ id: 'sock-race', data: {}, connected: true, handshake: { headers: { cookie: 'token_bid=host-jwt', 'x-portal': 'bid' }, query: {} }, disconnect: jest.fn(), join: jest.fn() } as any);
    const seen: Array<ReturnType<typeof currentLogContext>> = [];
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => { seen.push(currentLogContext()); });
    try {
      const authing = gw.handleConnection(socket);
      expect(socket.data.authReady).toBeInstanceOf(Promise);
      await authing;
    } finally { debug.mockRestore(); }
    expect(seen).toEqual([expect.objectContaining({ requestId: 'sock-rac', kind: 'ws', portal: 'bid', identity: { userId: 'u-host', username: '陈源远', role: 'bid_host' } })]);
  });
});
```

`api/src/chat/chat.gateway.spec.ts`（新建）:

```ts
import { Logger } from '@nestjs/common';
import { ChatGateway } from './chat.gateway';
import { currentLogContext } from '../logging/request-context.storage';

describe('ChatGateway 握手日志带连接上下文（设计稿 6.2）', () => {
  it('验签成功后的连接日志带连接号与身份', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1', username: '甲', role: 'staff' }) };
    const gw = new ChatGateway(jwt as any, {} as any);
    (gw as any).server = { emit: jest.fn() };
    const socket = { id: 'sock-chat-1', handshake: { headers: { cookie: 'token_web=jwt-x' } }, data: {}, join: jest.fn(), disconnect: jest.fn() } as any;
    const seen: Array<ReturnType<typeof currentLogContext>> = [];
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => { seen.push(currentLogContext()); });
    try { await gw.handleConnection(socket); } finally { debug.mockRestore(); }
    expect(seen).toEqual([expect.objectContaining({ requestId: 'sock-cha', kind: 'ws', identity: { userId: 'u1', username: '甲', role: 'staff' } })]);
  });
});
```

`api/src/notification/channels/sms.channel.spec.ts` 加 1 个（导入 `Logger`）:

```ts
it('控制台行的手机号随开关：默认明文、true 掩码；对账字段 phoneMasked 恒掩码', async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ resultCode: 0, taskId: 'T9' }) });
  const lines: string[] = [];
  const log = jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => { lines.push(String(m)); });
  try {
    delete process.env.LOG_PII_MASK;
    expect((await channel.send(payload as never)).phoneMasked).toBe('133****0619');
    process.env.LOG_PII_MASK = 'true';
    expect((await channel.send(payload as never)).phoneMasked).toBe('133****0619');
  } finally { log.mockRestore(); delete process.env.LOG_PII_MASK; }
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain('→ 13368360619');
  expect(lines[1]).toContain('→ 133****0619');
});
```

`api/src/verification/sms-provider.spec.ts` 加 2 个（导入 `Logger`、`HttpSmsProvider`）:

```ts
it('控制台行的手机号随开关：默认明文、true 掩码', async () => {
  mockFetchOnce({ resultCode: 0, taskId: 'T1' });
  mockFetchOnce({ resultCode: 0, taskId: 'T2' });
  const lines: string[] = [];
  const log = jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => { lines.push(String(m)); });
  try {
    delete process.env.LOG_PII_MASK;
    await provider.send('13800138000', '482913', 'supplier_registration');
    process.env.LOG_PII_MASK = 'true';
    await provider.send('13800138000', '482913', 'supplier_registration');
  } finally { log.mockRestore(); delete process.env.LOG_PII_MASK; }
  expect(lines[0]).toContain('→ 13800138000');
  expect(lines[1]).toContain('→ 138****8000');
});

it('HttpSmsProvider 的控制台行同样随开关', async () => {
  process.env.SMS_HTTP_ENDPOINT = 'http://sms.test/send';
  mockFetchOnce({ requestId: 'R1' });
  const lines: string[] = [];
  const log = jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => { lines.push(String(m)); });
  try {
    delete process.env.LOG_PII_MASK;
    await new HttpSmsProvider().send('13800138000', '482913', 'supplier_registration');
  } finally { log.mockRestore(); delete process.env.LOG_PII_MASK; delete process.env.SMS_HTTP_ENDPOINT; }
  expect(lines[0]).toContain('→ 13800138000');
});
```

- [ ] **Step 2: 跑，确认 RED**

Run: `cd "$API" && ./node_modules/.bin/jest src/logging/request-context.spec.ts src/notification src/bid/bid.gateway.spec.ts src/chat/chat.gateway.spec.ts src/verification/sms-provider.spec.ts`
Expected: `request-context` 报 `wsLogContext` 不存在（TS2552）；其余新增用例可运行并失败（`seen` 里是 `undefined`、日志行里是掩码或不是明文）。

- [ ] **Step 3: 实现**

`ws-context.util.ts` 照接口注释写；握手对象残缺时门户与 IP 取不到就省略。

通知网关：`handleConnection` 改为 `return runWithLogContext(wsLogContext(client), () => this.authenticate(client))`，原方法体原样搬进私有方法 `authenticate`。验签成功后 `noteLogIdentity(identityFromToken(payload))`；带 `sid` 查库那支的 `select` 加 `displayName`，查到后把姓名并进去；两条 `debug` 末尾的 `→ user:${payload.sub}` 去掉（身份已在行首）。

开标大厅网关：`handleConnection` 第一行改为 `const authReady = runWithLogContext(wsLogContext(socket), () => this.authenticateHandshake(socket));`，其余不动——`socket.data.authReady` 仍在第一个 `await` 之前挂上（2026-11-25 的入会竞态修复不许回退）。`authenticateHandshake` 里验签成功、`role` 与 `userId` 齐全之后记身份；带 `sid` 查库那支同样顺带取姓名。日志文字与级别都不动。

聊天网关：包法同通知网关，验签成功后记身份。

短信：`sms.channel.ts` 两处日志行与 `sms-provider.ts` 两个真实网关的日志行，把掩码函数换成 `phoneForLog`；`phoneMasked` 的各处赋值与 `ConsoleSmsProvider` 不动。

- [ ] **Step 4: 跑，确认 GREEN**

Run: 同 Step 2。Expected: 全过（任务 1 的 spec 变成 8 条）。

- [ ] **Step 5: 类型检查与提交**

Run: `cd "$API" && ./node_modules/.bin/tsc --noEmit`（Expected 无输出）

```bash
cd "$WT" && git add water-erp/apps/api/src/logging/ws-context.util.ts water-erp/apps/api/src/logging/request-context.spec.ts water-erp/apps/api/src/notification/notification.gateway.ts water-erp/apps/api/src/notification/notification.gateway.spec.ts water-erp/apps/api/src/bid/bid.gateway.ts water-erp/apps/api/src/bid/bid.gateway.spec.ts water-erp/apps/api/src/chat/chat.gateway.ts water-erp/apps/api/src/chat/chat.gateway.spec.ts water-erp/apps/api/src/notification/channels/sms.channel.ts water-erp/apps/api/src/notification/channels/sms.channel.spec.ts water-erp/apps/api/src/verification/sms-provider.ts water-erp/apps/api/src/verification/sms-provider.spec.ts
git commit -m "feat(logging): WS 握手日志带连接号与姓名，短信控制台行的手机号随明文开关" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 9: OperationLog 加 meta 列并落库

**Files:**
- Modify: `api/prisma/schema.prisma`（`model OperationLog`，`error` 那行之后）
- Create: `api/prisma/migrations/<时间戳>_operation_log_meta/migration.sql`
- Modify: `api/src/operation-log/operation-log.service.ts`（`create`），Test: `api/src/operation-log/operation-log.service.spec.ts`（第一个 `describe` 里加 1 个）

**Interfaces:**
- Consumes: 任务 7 的 `OperationLogEntry.meta`。
- Produces: `OperationLog.meta Json?`（Prisma 客户端重新生成后 `create` 可写该列）。

- [ ] **Step 1: 写失败的测试**

```ts
it('create 带 meta 时落 meta 列；不带时没有这个键', async () => {
  prisma.operationLog.create.mockResolvedValue({});
  const meta = { requestId: '4be10a77', handler: 'AuthController.me', route: '/api/auth/me', action: '获取当前用户信息' };
  await service.create({ ...sampleEntry, meta });
  expect(prisma.operationLog.create.mock.calls[0][0].data.meta).toEqual(meta);
  await service.create(sampleEntry);
  expect('meta' in prisma.operationLog.create.mock.calls[1][0].data).toBe(false);
});
```

- [ ] **Step 2: 跑，确认 RED**

Run: `cd "$API" && ./node_modules/.bin/jest src/operation-log/operation-log.service.spec.ts`
Expected: 新用例失败在 `expected undefined to equal {…}`。

- [ ] **Step 3: 加列、写迁移、重新生成客户端**

`schema.prisma` 的 `error String?` 之后加一行 `meta Json?`。迁移目录名用当时的时间戳，须排在 `prisma/migrations` 现有最新一条之后（下文以 `20261126180000_operation_log_meta` 为例），`migration.sql`:

```sql
-- 操作日志加 meta（2026-11-26 后端日志完善）：请求号、处理器、路由模式、中文动作、来源。
-- 本表是按月 RANGE 分区的法定留存表：只许手写 ADD COLUMN，禁止用 migrate diff 重生成；父表加列自动下发到各月分区。
ALTER TABLE "OperationLog" ADD COLUMN IF NOT EXISTS "meta" JSONB;
```

```bash
cd "$API" && ./node_modules/.bin/prisma validate && ./node_modules/.bin/prisma generate
find "$WT"/water-erp/node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client -type f -links +1 | wc -l
```

Expected: `The schema at prisma/schema.prisma is valid`、`Generated Prisma Client`、最后一行 `0`（生成结果只落在 worktree 的副本里）。若任务 0 走了软链兜底，生成之前必须确认主工作区与其他 worktree 的 `schema.prisma` 都没有未提交改动。

- [ ] **Step 4: 实现**

`create` 的 `data` 里追加 `...(entry.meta ? { meta: entry.meta as Prisma.InputJsonValue } : {})`。

- [ ] **Step 5: 跑，确认 GREEN 后提交**

Run: 同 Step 2（Expected 全过），再 `./node_modules/.bin/tsc --noEmit`（Expected 无输出——它同时证明生成的客户端带上了 `meta`）。

```bash
cd "$WT" && git add water-erp/apps/api/prisma/schema.prisma water-erp/apps/api/prisma/migrations/20261126180000_operation_log_meta water-erp/apps/api/src/operation-log/operation-log.service.ts water-erp/apps/api/src/operation-log/operation-log.service.spec.ts
git commit -m "feat(logging): 操作日志加 meta 列（请求号、处理器、路由、中文动作、来源）" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

后续任务里若类型检查报 `meta` 不存在，说明共用的 Prisma 客户端被别人重新生成过：先确认各方 `schema.prisma` 干净，再重做本任务的生成。

---

### Task 10: 查询接口扩展与按角色打码

**Files:**
- Modify: `api/src/operation-log/operation-log.types.ts`（`OperationLogQuery`）
- Modify: `api/src/operation-log/operation-log.service.ts`，Test: `api/src/operation-log/operation-log.service.spec.ts`（加 4 个）
- Modify: `api/src/operation-log/operation-log.controller.ts`

**Interfaces:**
- Consumes: 任务 5 的 `maskPiiForReader`、`sensitiveKeysFor`。
- Produces:

  ```ts
  // operation-log.types.ts
  export interface OperationLogQuery { /* 既有字段 */ ip?: string; failed?: boolean; writesOnly?: boolean }
  // operation-log.service.ts
  findAll(q: OperationLogQuery, viewerRole: string | null | undefined)
  findMine(userId: string, q: OperationLogQuery, viewerRole: string | null | undefined)
  // operation-log.controller.ts
  toBool(v: unknown): boolean | undefined   // true、'true'、'1' 为 true；其余 undefined
  ```

- [ ] **Step 1: 写失败的测试**（`operation-log.service.spec.ts` 第一个 `describe` 里）

```ts
it('ip / failed / writesOnly 进 where', async () => {
  prisma.operationLog.findMany.mockResolvedValue([]);
  prisma.operationLog.count.mockResolvedValue(0);
  await service.findAll({ ip: '10.60.3.17', failed: true, writesOnly: true }, 'admin');
  expect(prisma.operationLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: expect.objectContaining({ ipAddress: '10.60.3.17', statusCode: { gte: 400 }, method: { in: ['POST', 'PUT', 'PATCH', 'DELETE'] } }),
  }));
});

it('只看失败优先于状态分类', async () => {
  prisma.operationLog.findMany.mockResolvedValue([]);
  prisma.operationLog.count.mockResolvedValue(0);
  await service.findAll({ failed: true, statusClass: 'success' }, 'admin');
  expect(prisma.operationLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ statusCode: { gte: 400 } }) }));
});

it('非 admin 读到的请求体重新打码；admin 原样', async () => {
  prisma.operationLog.findMany.mockResolvedValue([
    { id: '1', method: 'POST', path: '/api/x', body: { phone: '13812341234', note: 'a' } },
    { id: '2', method: 'POST', path: '/api/verification/check-registration-code', meta: null, body: { _truncated: true, preview: '{"phone":"13812341234","code":"654321"}' } },
  ]);
  prisma.operationLog.count.mockResolvedValue(2);
  expect((await service.findAll({}, 'admin')).items[0].body.phone).toBe('13812341234');
  const asHost = await service.findAll({}, 'bid_host');
  expect(asHost.items[0].body.phone).toBe('138****1234');
  expect(asHost.items[1].body.preview).toBe('{"phone":"138****1234","code":"***"}');
});

it('我的日志同样按角色打码', async () => {
  prisma.operationLog.findMany.mockResolvedValue([{ id: '1', method: 'POST', path: '/api/x', body: { email: 'zhangsan@example.com' } }]);
  prisma.operationLog.count.mockResolvedValue(1);
  expect((await service.findMine('u1', {}, 'staff')).items[0].body.email).toBe('z***@example.com');
});
```

- [ ] **Step 2: 跑，确认 RED**

Run: `cd "$API" && ./node_modules/.bin/jest src/operation-log/operation-log.service.spec.ts`
Expected: 前两条 `Test suite failed to run`（`findAll` 只收一个参数，TS2554）；要看到后两条的失败用只转译运行。

- [ ] **Step 3: 实现**

`buildWhere`：`ip` 精确匹配；`writesOnly` 为真加 `method: { in: ['POST', 'PUT', 'PATCH', 'DELETE'] }`；`failed` 为真加 `statusCode: { gte: 400 }` 并跳过 `statusClass` 与 `statusCode`。`findAll`、`findMine` 出结果前，`viewerRole` 不是 `admin` 就逐行把 `body` 换成 `maskPiiForReader(body, sensitiveKeysFor(row.method, row.meta?.route ?? row.path).body)`，`body` 为空的行不动。控制器把 `@CurrentUser()` 的角色传进去，`normalize` 里用 `toBool` 转两个开关。

- [ ] **Step 4: 跑，确认 GREEN**

Run: 同 Step 2。Expected: 全过。

- [ ] **Step 5: 类型检查与提交**

Run: `cd "$API" && ./node_modules/.bin/tsc --noEmit`（Expected 无输出）

```bash
cd "$WT" && git add water-erp/apps/api/src/operation-log/operation-log.types.ts water-erp/apps/api/src/operation-log/operation-log.service.ts water-erp/apps/api/src/operation-log/operation-log.service.spec.ts water-erp/apps/api/src/operation-log/operation-log.controller.ts
git commit -m "feat(logging): 操作日志查询加 IP、只看失败、只看写操作三个筛选，非 admin 读取时重新打码" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 11: 操作日志页面改造

动页面前先加载 `water-erp:cgzxui` 技能。纯逻辑进 `lib` 并配单测；组件没有单测，到任务 12 在浏览器里核对。

**Files:**
- Create: `web/src/lib/operation-log-view.ts`，Test: `web/src/lib/operation-log-view.test.ts`
- Modify: `web/src/lib/api/operation-log.ts`
- Modify: `web/src/lib/history-export.ts`，Test: `web/src/lib/history-export.test.ts`（新建）
- Modify: `web/src/components/copy-icon-button.tsx`
- Create: `web/src/components/admin/health/operation-log-row.tsx`
- Modify: `web/src/components/admin/health/operation-log-tab.tsx`
- Modify: `web/src/components/profile/tab-basic-info.tsx`（第 87 行）

**Interfaces:**
- Produces:

  ```ts
  // lib/api/operation-log.ts
  export type OperationLogMeta = { requestId?: string; handler?: string; route?: string; action?: string; source?: string } | null;
  export type OperationLogRow = { /* 既有字段 */ meta?: OperationLogMeta };
  // lib/operation-log-view.ts（纯函数，不引 React）
  export type OperationLogFilters = { portal: string; role: string; method: string; statusClass: string; username: string; keyword: string; ip: string; failed: boolean; writesOnly: boolean; startTime: string; endTime: string };
  export const EMPTY_OPERATION_LOG_FILTERS: OperationLogFilters;
  export const PORTAL_OPTIONS: ReadonlyArray<readonly [string, string]>;   // web 采购管理端、bid 开评标端、supplier 供应商门户、expert 专家门户、public 信息门户、assistant 水叮当助手
  export const OPERATION_LOG_COLUMNS = 7;                                   // 展开箭头加六列
  export function buildOperationLogParams(f: OperationLogFilters, limit: number, offset: number): URLSearchParams;
  export function roleLabelOf(role: string | null | undefined): string;     // ROLE_LABELS 优先；anonymous 与空值显示「匿名」；其余原样
  export function portalNameOf(row: Pick<OperationLogRow, 'portal' | 'meta'>): string | null;
  export function operationLabelOf(row: Pick<OperationLogRow, 'meta'>): string | null;   // meta.action，没有为 null
  export function handlerLabelOf(row: Pick<OperationLogRow, 'meta'>): string | null;      // meta.handler，没有为 null
  // components/admin/health/operation-log-row.tsx
  export function OperationLogTableRow(props: { row: OperationLogRow; expanded: boolean; onToggle: () => void })
  // components/copy-icon-button.tsx
  successHint?: string   // 成功提示追加在「已复制」之后，前面加逗号
  // lib/history-export.ts
  export interface OperationLogExportEntry { /* 既有字段 */ action?: string | null; requestId?: string | null }
  ```

- Consumes: `lib/role-labels.ts` 的 `ROLE_LABELS`。

- [ ] **Step 1: 写失败的测试** `web/src/lib/operation-log-view.test.ts`

```ts
import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error Node 原生 --test 的 ESM 解析需要显式 .ts 扩展；tsc（bundler 分辨）不接受——压此行
import { EMPTY_OPERATION_LOG_FILTERS, PORTAL_OPTIONS, buildOperationLogParams, handlerLabelOf, operationLabelOf, portalNameOf, roleLabelOf } from "./operation-log-view.ts";

test("查询参数：IP、只看失败、只看写操作进查询串，时间转 ISO", () => {
  const p = buildOperationLogParams({ ...EMPTY_OPERATION_LOG_FILTERS, ip: " 10.60.3.17 ", failed: true, writesOnly: true, startTime: "2026-11-26T00:00" }, 20, 40);
  assert.equal(p.get("ip"), "10.60.3.17");
  assert.equal(p.get("failed"), "true");
  assert.equal(p.get("writesOnly"), "true");
  assert.equal(p.get("limit"), "20");
  assert.equal(p.get("offset"), "40");
  assert.equal(new Date(p.get("startTime")!).toISOString(), new Date("2026-11-26T00:00").toISOString());
  assert.equal(p.has("portal"), false);
});

test("查询参数：开关关着、输入为空时不带对应参数", () => {
  const p = buildOperationLogParams(EMPTY_OPERATION_LOG_FILTERS, 50, 0);
  for (const k of ["ip", "failed", "writesOnly", "startTime", "username", "keyword"]) assert.equal(p.has(k), false, k);
});

test("门户：中文；移动驾驶舱靠来源识别；未收录原样；没有为 null；下拉不含采购商城", () => {
  assert.equal(portalNameOf({ portal: "web", meta: null }), "采购管理端");
  assert.equal(portalNameOf({ portal: "web", meta: { source: "mobile-3011" } }), "移动驾驶舱");
  assert.equal(portalNameOf({ portal: "mall", meta: null }), "mall");
  assert.equal(portalNameOf({ portal: null, meta: null }), null);
  assert.equal(PORTAL_OPTIONS.some(([v]) => v === "mall"), false);
});

test("操作与处理位置：有中文动作取动作，否则为 null；处理位置取控制器.方法", () => {
  assert.equal(operationLabelOf({ meta: { action: "用户登录", handler: "AuthController.login" } }), "用户登录");
  assert.equal(operationLabelOf({ meta: { handler: "AuthController.me" } }), null);
  assert.equal(operationLabelOf({ meta: null }), null);
  assert.equal(handlerLabelOf({ meta: { handler: "AuthController.me" } }), "AuthController.me");
  assert.equal(handlerLabelOf({ meta: undefined }), null);
});

test("角色：沿用 ROLE_LABELS，匿名兜底，未收录原样", () => {
  assert.equal(roleLabelOf("bid_host"), "开标主持");
  assert.equal(roleLabelOf("anonymous"), "匿名");
  assert.equal(roleLabelOf(null), "匿名");
  assert.equal(roleLabelOf("mall"), "mall");
});
```

`web/src/lib/history-export.test.ts`（新建）:

```ts
import test from "node:test";
import assert from "node:assert/strict";

// @ts-expect-error Node 原生 --test 的 ESM 解析需要显式 .ts 扩展；tsc（bundler 分辨）不接受——压此行
import { buildOperationLogTxt } from "./history-export.ts";

const row = {
  at: "2026-11-26T02:29:43.000Z", operator: "彭强", role: "员工", portal: "web",
  method: "GET", path: "/api/auth/me", statusCode: 200, durationMs: 3, ip: "10.60.3.17",
  action: "获取当前用户信息", requestId: "4be10a77",
};

test("系统操作日志导出：每条带动作名与请求号", () => {
  const out = buildOperationLogTxt("全部记录（无筛选）", [row]);
  assert.match(out, /彭强 · 员工 · 采购管理端/);
  assert.match(out, /获取当前用户信息/);
  assert.match(out, /GET \/api\/auth\/me → 200（3ms） · 10\.60\.3\.17/);
  assert.match(out, /请求号：4be10a77/);
});

test("旧行没有动作名与请求号时不输出这两段", () => {
  const out = buildOperationLogTxt("全部记录（无筛选）", [{ ...row, action: null, requestId: null }]);
  assert.doesNotMatch(out, /获取当前用户信息|请求号/);
});
```

- [ ] **Step 2: 跑，确认 RED**

Run: `cd "$WEB" && ./node_modules/.bin/tsx --test src/lib/operation-log-view.test.ts src/lib/history-export.test.ts`
Expected: 第一个报找不到 `./operation-log-view.ts`；第二个「每条带动作名与请求号」失败。

- [ ] **Step 3: 实现**

`lib`：`operation-log-view.ts` 照接口写（`buildOperationLogParams` 沿用现有 `buildParams` 的字段，多出 `ip` 去空格、两个开关为真才带）。`history-export.ts`：条目类型加两个字段；门户表与设计稿附录 A 对齐（去掉采购商城，助手改「水叮当助手」）；每条在原两行之后加一行缩进的动作名，再在请求行下加一行 `请求号：…`，两者没有就不输出：

```
[11-26 10:29:43] 彭强 · 员工 · 采购管理端
    获取当前用户信息
    GET /api/auth/me → 200（3ms） · 10.60.3.17
    请求号：4be10a77
```

`copy-icon-button.tsx`：加可选的 `successHint`，成功提示变成 `${label}已复制${successHint ? `，${successHint}` : ''}`（原有的「本次查看明文已记录」接在后面）。

`operation-log-row.tsx`：渲染主行与展开详情行。主行六格——
- 操作：第一行 `operationLabelOf`，没有就显示 `handlerLabelOf`（灰色），都没有只有第二行；第二行方法徽标（细边框小标签，`rounded-md border` 加等宽小字，不引入新类、不加内联阴影）加路径（`max-w-[280px] truncate`，悬停显示完整路径与查询串）。
- 用户：第一行 `displayName || username || '匿名'`；第二行 `账号 · 角色中文`，没有账号就省略。
- 来源：第一行 `portalNameOf`（没有显示 `—`）；第二行 IP。
- 状态：状态码（着色函数原样搬过来）；第二行请求号加 `CopyIconButton`（`label="请求号"`、`successHint="可到控制台按此号搜索"`），没有请求号显示 `—`。
- 耗时、时间：原样。

展开行 `colSpan={OPERATION_LOG_COLUMNS}`：左栏查询串、处理位置（`控制器.方法` 加路由模式）、请求号、Referer、User-Agent、错误；右栏参数，标签改为「参数（密码、令牌、验证码已隐藏）」。

`operation-log-tab.tsx`：筛选状态换成 `OperationLogFilters`，「有筛选」判断改为非空串或为真；工具栏加「IP（精确）」输入框和两个开关按钮「只看失败」「只看写操作」（`neu-btn-xs` 加 `aria-pressed`，按下时加 `is-primary`）；角色下拉显示中文并去掉 `mall`，门户下拉用 `PORTAL_OPTIONS`；表头七列，骨架屏、空态、错误态的列数用 `OPERATION_LOG_COLUMNS`；行渲染交给 `OperationLogTableRow`；导出映射补 `action` 与 `requestId`（取自 `r.meta`），导出范围说明里的门户用 `portalNameOf`。页内原来的 `PORTAL_OPTIONS`、`ROLE_OPTIONS`、`ROLE_CN`、`buildParams` 删掉。

`tab-basic-info.tsx` 第 87 行的地址补 `&statusClass=success`。

- [ ] **Step 4: 跑，确认 GREEN，过闸**

```bash
cd "$WEB" && ./node_modules/.bin/tsx --test "src/**/*.test.ts" && ./node_modules/.bin/tsc --noEmit
cd "$WEB" && ./node_modules/.bin/eslint src/lib/operation-log-view.ts src/lib/operation-log-view.test.ts src/lib/history-export.ts src/lib/history-export.test.ts src/lib/api/operation-log.ts src/components/admin/health/operation-log-tab.tsx src/components/admin/health/operation-log-row.tsx src/components/copy-icon-button.tsx src/components/profile/tab-basic-info.tsx
cd "$WT/water-erp" && bash scripts/copy-lint.sh --ci && bash scripts/check-cgzxui-redcards.sh --ci
```

Expected: 测试全过、`tsc` 无输出、`eslint` 无输出、两个闸退出码 0。

- [ ] **Step 5: 提交**

```bash
cd "$WT" && git add water-erp/apps/web/src/lib/operation-log-view.ts water-erp/apps/web/src/lib/operation-log-view.test.ts water-erp/apps/web/src/lib/api/operation-log.ts water-erp/apps/web/src/lib/history-export.ts water-erp/apps/web/src/lib/history-export.test.ts water-erp/apps/web/src/components/copy-icon-button.tsx water-erp/apps/web/src/components/admin/health/operation-log-row.tsx water-erp/apps/web/src/components/admin/health/operation-log-tab.tsx water-erp/apps/web/src/components/profile/tab-basic-info.tsx
git commit -m "feat(logging): 操作日志页面六列布局、中文角色与动作、请求号复制、三个新筛选" -m "Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

### Task 12: 隔离 e2e 与私有栈实走（主会话执行）

**Files:**
- Modify: `api/test/operation-log.e2e-spec.ts`
- 临时脚本与材料放 `/tmp/logging-upgrade/`（下文记作 `$H`），不入库

私有栈是一套只属于本次工作的隔离资源：库 `water_erp_e2e_log`（docker `water-erp-postgres`，PostgreSQL 16）、Redis 容器 `water-erp-redis-e2e-log`（`:6392`）、桶 `water-erp-e2e-log`、三个密钥库目录。与开发库（金仓 `:54321`）、共享的 e2e 栈（`water_erp_e2e`、`:6390`）互不相干。

- [ ] **Step 1: 写失败的 e2e**（`operation-log.e2e-spec.ts`）

追加导入：`Logger`（`@nestjs/common`）、`currentLogContext`（`../src/logging/request-context.storage`）、`ACTION_LABEL_OVERRIDES`、`normalizeRoutePattern`（`../src/logging/action-labels`）、`SENSITIVE_ROUTE_RULES`（`../src/operation-log/sensitive-routes`）。

把「已认证请求被记录、body 已脱敏」换成：

```ts
it('已认证请求被记录：带请求号、处理器与中文动作', async () => {
  const res = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', expertCookie).set('X-Portal', 'expert').expect(200);
  await new Promise((r) => setTimeout(r, 300));
  const found = await prisma.operationLog.findFirst({ where: { path: '/api/auth/me', method: 'GET' }, orderBy: { createdAt: 'desc' } });
  expect(found).toMatchObject({ role: 'bid_expert', portal: 'expert', statusCode: 200 });
  expect(found!.meta).toEqual({ requestId: res.headers['x-request-id'], handler: 'AuthController.me', route: '/api/auth/me', action: '获取当前用户信息' });
});
```

「受保护路由无 token → 401 并被补记」里的 `expect(row!.durationMs).toBe(0)` 改为 `toBeGreaterThanOrEqual(0)`。文件末尾追加七条：

```ts
it('X-Request-Id 响应头：业务请求、404、非 API 路径都有 8 位十六进制请求号', async () => {
  for (const url of ['/api/time', '/api/nope/zzz', '/']) {
    const res = await request(app.getHttpServer()).get(url);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{8}$/);
  }
});

it('请求完成行带请求号，与响应头一致', async () => {
  const lines: Array<{ message: string; requestId?: string }> = [];
  const previous = process.env.HTTP_ACCESS_LOG;
  process.env.HTTP_ACCESS_LOG = 'on';
  const log = jest.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
    lines.push({ message: String(message), requestId: currentLogContext()?.requestId });
  });
  try {
    const res = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', expertCookie).set('X-Portal', 'expert').expect(200);
    const line = lines.find((l) => l.message.startsWith('→ 获取当前用户信息 GET /api/auth/me 200'));
    expect(line).toBeDefined();
    expect(line!.requestId).toBe(res.headers['x-request-id']);
  } finally {
    log.mockRestore();
    if (previous === undefined) delete process.env.HTTP_ACCESS_LOG; else process.env.HTTP_ACCESS_LOG = previous;
  }
});

it('手机号默认明文，LOG_PII_MASK=true 时掩码；短信验证码恒为 ***', async () => {
  const call = () => request(app.getHttpServer()).post('/api/verification/check-registration-code').set('X-Portal', 'public').send({ phone: '13800001234', code: '654321' });
  const last = async () => (await prisma.operationLog.findMany({ where: { path: '/api/verification/check-registration-code', method: 'POST' }, orderBy: { createdAt: 'desc' }, take: 1 }))[0];
  await call();
  await new Promise((r) => setTimeout(r, 300));
  expect((await last())!.body).toEqual({ phone: '13800001234', code: '***' });
  const previous = process.env.LOG_PII_MASK;
  try {
    process.env.LOG_PII_MASK = 'true';
    await call();
    await request(app.getHttpServer()).post('/api/auth/login').set('X-Portal', 'web').send({ username: 'Swhi-CGZX-05', password: 'wrong-password' });
    await new Promise((r) => setTimeout(r, 300));
  } finally { if (previous === undefined) delete process.env.LOG_PII_MASK; else process.env.LOG_PII_MASK = previous; }
  expect((await last())!.body).toEqual({ phone: '138****1234', code: '***' });
  const login = await prisma.operationLog.findFirst({ where: { path: '/api/auth/login', method: 'POST' }, orderBy: { createdAt: 'desc' } });
  expect(login!.body).toEqual({ username: 'Swhi-CGZX-05', password: '***' });
});

it('回执令牌在查询串里是 ***', async () => {
  await request(app.getHttpServer()).get('/api/supplier/rsvp/verify?t=secret-token-123').set('X-Portal', 'public');
  await new Promise((r) => setTimeout(r, 300));
  const row = await prisma.operationLog.findFirst({ where: { path: '/api/supplier/rsvp/verify' }, orderBy: { createdAt: 'desc' } });
  expect(row!.query).toBe('t=***');
  expect(JSON.stringify(row!.meta)).not.toContain('secret-token-123');
});

it('被顶下线的 401 行三列带身份，error 存 [错误码] 中文原因', async () => {
  const first = await loginAs(app, 'Swhi-CGZX-05', 'Swhi-CGZX-05@2026', 'web');
  await loginAs(app, 'Swhi-CGZX-05', 'Swhi-CGZX-05@2026', 'web');
  await request(app.getHttpServer()).get('/api/user-settings').set('Cookie', first).set('X-Portal', 'web').expect(401);
  await new Promise((r) => setTimeout(r, 300));
  const row = await prisma.operationLog.findFirst({ where: { path: '/api/user-settings', method: 'GET', statusCode: 401 }, orderBy: { createdAt: 'desc' } });
  expect(row).toMatchObject({ userId: expect.any(String), username: 'Swhi-CGZX-05', role: 'staff' });
  expect(row!.error).toBe('[SESSION_REPLACED] 该账号已在其他设备登录，请重新登录');
});

it('admin 读到明文，bid_host 读到掩码', async () => {
  await request(app.getHttpServer()).post('/api/verification/check-registration-code').set('X-Portal', 'public').send({ phone: '13800001234', code: '654321' });
  await new Promise((r) => setTimeout(r, 300));
  const url = '/api/operation-log?path=/api/verification/check-registration-code&limit=1';
  const admin = await loginAs(app, 'Swhi-CGZX-admin', 'Swhi-CGZX-admin@2026', 'web');
  const asAdmin = await request(app.getHttpServer()).get(url).set('Cookie', admin).set('X-Portal', 'web').expect(200);
  expect(asAdmin.body.items[0].body.phone).toBe('13800001234');
  const host = await loginAs(app, '陈源远', '陈源远@2026', 'bid');
  const asHost = await request(app.getHttpServer()).get(url).set('Cookie', host).set('X-Portal', 'bid').expect(200);
  expect(asHost.body.items[0].body).toEqual({ phone: '138****1234', code: '***' });
});

it('纠偏表与敏感键登记表里的路由都真实存在', () => {
  const routes = new Set<string>();
  for (const layer of (app.getHttpAdapter().getInstance() as any).router.stack) {
    if (!layer.route) continue;
    for (const m of Object.keys(layer.route.methods)) {
      for (const p of Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path]) {
        const path = normalizeRoutePattern(p);
        if (path) routes.add(`${m.toUpperCase()} ${path}`);
      }
    }
  }
  for (const key of [...Object.keys(ACTION_LABEL_OVERRIDES), ...SENSITIVE_ROUTE_RULES.map((r) => `${r.method} ${r.path}`)]) {
    expect(routes.has(key)).toBe(true);
  }
});
```

说明：

- 预检接口限流 3 次/分钟。上面几条用例合起来会超过，超出的那次被 429 拒绝——拒绝同样落库，断言不受影响。
- 请求号那一条不含 `/socket.io/`。已实测：socket.io 的轮询握手不经过 Express 中间件（engine.io 挂载时接管了 `/socket.io/` 路径的请求，这些响应连 helmet 的头都没有），所以这类请求没有请求号，也不进请求上下文。WS 行靠网关握手时打的连接号（任务 8）。

- [ ] **Step 2: 搭私有栈**

```bash
H=/tmp/logging-upgrade; mkdir -p "$H"
ss -tlnH '( sport = :6392 )'                                   # 须无输出；被占就换端口并同步改下面的 env 与脚本
docker exec water-erp-postgres psql -U water_erp -d postgres -c "CREATE DATABASE water_erp_e2e_log"
docker run -d --name water-erp-redis-e2e-log -p 6392:6379 redis:7-alpine
sed -e 's/water_erp_e2e/water_erp_e2e_log/g' -e 's/localhost:6390/localhost:6392/' -e 's/water-erp-e2e/water-erp-e2e-log/g' -e 's#/tmp/e2e-harness#/tmp/logging-upgrade#g' /tmp/e2e-harness/env.e2e > "$H/env.e2e"
chmod 600 "$H/env.e2e"
/usr/bin/grep -E '^(DATABASE_URL|DIRECT_URL|REDIS_URL|MINIO_BUCKET|ADMIN_KEYSTORE_DIR|SUPERVISION_KEYSTORE_DIR|TRUSTED_CA_DIR|SMS_PROVIDER)=' "$H/env.e2e"
```

Expected: 七项都指向私有资源（库名带 `_log`、Redis `:6392`、桶带 `-log`、三个目录在 `/tmp/logging-upgrade/`），`SMS_PROVIDER=console`。这个文件有密钥值，别再整份打印。

四个脚本（都要用 `bash` 跑；`sh` 会在 `pipefail` 上报错）。`$H/ns.sh`：

```bash
#!/usr/bin/env bash
# 隔离包装：私有挂载命名空间里，用私有 e2e env 覆盖 worktree 与主工作区两处 apps/api/.env，再到 worktree 的 apps/api 下执行命令。
# 盖主工作区那一份是为了防手滑（任务 0 若走软链兜底，Prisma 客户端读的就是那一份）；命名空间外的一切进程不受影响。
set -euo pipefail
H=/tmp/logging-upgrade
API=/home/asus/桌面/ERP/.worktrees/logging-upgrade/water-erp/apps/api
MAIN_ENV=/home/asus/桌面/ERP/water-erp/apps/api/.env
ENV_FILE=$H/env.e2e
fail() { echo "GUARD FAIL: $*" >&2; exit 1; }
[ -f "$ENV_FILE" ] && [ -f "$API/.env" ] && [ -f "$MAIN_ENV" ] || fail "missing env files"
/usr/bin/grep -qE '^DATABASE_URL=postgresql://[^@]+@localhost:5432/water_erp_e2e_log$' "$ENV_FILE" || fail "DATABASE_URL must target water_erp_e2e_log"
/usr/bin/grep -qE '^DIRECT_URL=postgresql://[^@]+@localhost:5432/water_erp_e2e_log$' "$ENV_FILE" || fail "DIRECT_URL must target water_erp_e2e_log"
/usr/bin/grep -qE '^REDIS_URL=redis://localhost:6392$' "$ENV_FILE" || fail "REDIS_URL must be redis://localhost:6392"
/usr/bin/grep -qE '^MINIO_BUCKET=water-erp-e2e-log$' "$ENV_FILE" || fail "MINIO_BUCKET must be water-erp-e2e-log"
! /usr/bin/grep -qE '54321|6432|6380|6390|kingbase|water_erp_e2e$|water-erp-e2e$|/tmp/e2e-harness' "$ENV_FILE" || fail "env file references a live, dev or shared resource"
mkdir -p "$H/admin-keystore" "$H/supervision-keystore" "$H/trusted-ca"
exec unshare -Urm bash -c 'set -e; mount --bind "$1" "$2"; mount --bind "$1" "$3"; cd "$4"; shift 4; exec "$@"' _ "$ENV_FILE" "$API/.env" "$MAIN_ENV" "$API" "$@"
```

`$H/fresh.sh`（重灌种子）：

```bash
#!/usr/bin/env bash
set -euo pipefail
H=/tmp/logging-upgrade
API=/home/asus/桌面/ERP/.worktrees/logging-upgrade/water-erp/apps/api
URL1="postgresql://water_erp:water_erp_dev@localhost:5432/water_erp_e2e_log?connection_limit=1"
cd "$API"
DBNAME=$(bash "$H/ns.sh" ./node_modules/.bin/tsx --env-file=.env -e 'import { PrismaClient } from "@prisma/client"; const p = new PrismaClient(); p.$queryRawUnsafe("SELECT current_database() AS db").then((r: any) => { console.log("PRECHECK " + r[0].db); }).finally(() => p.$disconnect());' 2>&1 | /usr/bin/grep -E '^PRECHECK' | head -n 1)
[ "$DBNAME" = "PRECHECK water_erp_e2e_log" ] || { echo "REFUSE: current_database() is not water_erp_e2e_log (${DBNAME:-nothing})"; exit 1; }
docker exec water-erp-redis-e2e-log redis-cli flushall >/dev/null
DATABASE_URL="$URL1" DIRECT_URL="$URL1" bash "$H/ns.sh" ./node_modules/.bin/tsx --env-file=.env prisma/seed.ts > "$H/seed-last.log" 2>&1 || true
/usr/bin/grep -q 'Seed 完成' "$H/seed-last.log" && echo "fresh: seeded $(date '+%T')" || { echo "fresh: SEED FAILED — see $H/seed-last.log"; exit 1; }
```

`$H/rebuild.sh`（从空库重建：先做负对照，再按 worktree 自己的 schema 迁移）：

```bash
#!/usr/bin/env bash
set -uo pipefail
H=/tmp/logging-upgrade
API=/home/asus/桌面/ERP/.worktrees/logging-upgrade/water-erp/apps/api
URL="postgresql://water_erp:water_erp_dev@localhost:5432/water_erp_e2e_log"
fail() { echo "REBUILD FAILED: $*"; exit 1; }
echo "rebuilt from $(git -C "$API" rev-parse --short HEAD)"
docker exec water-erp-postgres psql -U water_erp -d postgres -c "DROP DATABASE IF EXISTS water_erp_e2e_log WITH (FORCE)" -c "CREATE DATABASE water_erp_e2e_log" > /dev/null 2>&1 || fail "drop/create"
T=$H/prisma-cli; rm -rf "$T"; mkdir -p "$T/prisma"
cp "$API/prisma/schema.prisma" "$T/prisma/schema.prisma"; ln -s "$API/prisma/migrations" "$T/prisma/migrations"
cd "$T"
DATABASE_URL="$URL" DIRECT_URL="$URL" "$API/node_modules/.bin/prisma" migrate status --schema prisma/schema.prisma > "$H/rebuild-status-before.log" 2>&1
/usr/bin/grep -q 'have not yet been applied' "$H/rebuild-status-before.log" || fail "negative control: empty db did not report pending migrations"
DATABASE_URL="$URL" DIRECT_URL="$URL" "$API/node_modules/.bin/prisma" migrate deploy --schema prisma/schema.prisma > "$H/rebuild-deploy.log" 2>&1 || { tail -n 5 "$H/rebuild-deploy.log"; fail "migrate deploy"; }
/usr/bin/grep -q 'All migrations have been successfully applied' "$H/rebuild-deploy.log" || fail "deploy did not finish cleanly"
echo "migrated: $(docker exec water-erp-postgres psql -U water_erp -d water_erp_e2e_log -At -c "select count(*) from \"_prisma_migrations\" where finished_at is not null") applied"
bash "$H/fresh.sh"
```

`$H/run.sh`（在私有栈里跑 e2e，输出摘要与失败清单）：

```bash
#!/usr/bin/env bash
set -uo pipefail
H=/tmp/logging-upgrade
API=/home/asus/桌面/ERP/.worktrees/logging-upgrade/water-erp/apps/api
TAG=$(echo "$*" | tr -c 'A-Za-z0-9._-' '_' | cut -c1-80); LOG="$H/run-$TAG-$(date +%H%M%S).log"
cd "$API" && bash "$H/ns.sh" ./node_modules/.bin/jest --config test/jest-e2e.json --forceExit "$@" > "$LOG" 2>&1; RC=$?
sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g' "$LOG" > "$LOG.clean"
echo "jest exit=$RC  $(/usr/bin/grep -E '^Test Suites:|^Tests:' "$LOG.clean" | tr '\n' ' ')  log=$LOG"
/usr/bin/grep -E '^\s+● ' "$LOG.clean" | sed -E 's/^\s+//' | sort -u | /usr/bin/grep -v '^● Console' | cut -c1-200
exit $RC
```

- [ ] **Step 3: 重建私有库**

Run: `bash "$H/rebuild.sh"`
Expected: 负对照通过、`All migrations have been successfully applied`、`fresh: seeded`。新建的 `meta` 迁移在 PostgreSQL 16 上重放成功。

```bash
docker exec water-erp-postgres psql -U water_erp -d water_erp_e2e_log -At -c "select count(*) from pg_tables where tablename like 'OperationLog%'; select count(*) from information_schema.columns where table_name like 'OperationLog%' and column_name='meta';"
```

Expected: 两个数字相等（父表与各月分区都有这一列）。

- [ ] **Step 4: 跑 e2e**

Run: `bash "$H/run.sh" test/operation-log.e2e-spec.ts`
Expected: `Tests: 12 passed`。登记表那条若报某条路由不存在，是表里的路径或参数名写错——对照控制器改表，不改测试。

Run: `bash "$H/run.sh" --testPathIgnorePatterns=announcement-tender-source-key`
Expected: 除被排除的那一套外全绿，失败清单为空。被排除的那一套会真实发布公告，发布前护栏只认共享库名，私有栈上到共享栈空闲时单独补跑。

Run: `TZ=UTC bash "$H/run.sh" --testPathIgnorePatterns=announcement-tender-source-key`
Expected: 同上。

全量突然大面积失败、报某列不存在：先按任务 9 末尾的判别查 Prisma 客户端，再查别的。

- [ ] **Step 5: 私有栈实走（控制台）**

起私有 API（端口 4011，输出落文件）。按工作目录认进程，别用 `pkill -f "node dist/main.js"`——会误杀主工作区正在跑的开发 API。`wt_pids` 的定义每个命令块开头都带上（工具里的 shell 状态不跨命令保留）。

```bash
H=/tmp/logging-upgrade; API=/home/asus/桌面/ERP/.worktrees/logging-upgrade/water-erp/apps/api
wt_pids() { for p in $(pgrep -f 'dist/(main|ai-bid-analysis-worker)\.js'); do [ "$(cat /proc/$p/comm 2>/dev/null)" = node ] && [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$API" ] && echo "$p"; done; }
start_api() { (cd "$API" && PORT=4011 nohup setsid bash "$H/ns.sh" node "$API/dist/main.js" > "$H/api.log" 2>&1 &); }
cd "$API" && ./node_modules/.bin/nest build && start_api
sleep 10; curl --noproxy '*' -s -o /dev/null -D - http://127.0.0.1:4011/api/time | /usr/bin/grep -iE '^HTTP|x-request-id'
head -n 5 "$H/api.log"
```

Expected: `HTTP/1.1 200 OK`、`X-Request-Id: <8 位十六进制>`；日志头几行都是「时间 级别 api [模块] 消息」的形状，没有旧的 `[Nest] 1 - …` 前缀。

抓样本：

```bash
H=/tmp/logging-upgrade; API=/home/asus/桌面/ERP/.worktrees/logging-upgrade/water-erp/apps/api
B=http://127.0.0.1:4011; J='Content-Type: application/json'; C="curl --noproxy '*' -s -o /dev/null"
# ① 匿名 429（同一来源连打 4 次预检，限流 3 次/分钟）
for i in 1 2 3 4; do $C -X POST $B/api/verification/check-registration-code -H "$J" -H 'X-Portal: public' -H 'X-Forwarded-For: 10.60.3.17' --data '{"phone":"13800001234","code":"000000"}'; done
/usr/bin/grep -m1 'TOO_MANY_REQUESTS' "$H/api.log"
# ② 登录失败
$C -X POST $B/api/auth/login -H "$J" -H 'X-Portal: web' --data '{"username":"Swhi-CGZX-05","password":"wrong-password"}'
/usr/bin/grep -m1 '/api/auth/login 401' "$H/api.log"
# ③ 被顶下线，与随后的正常请求
curl --noproxy '*' -s -c "$H/a.jar" -X POST $B/api/auth/login -H "$J" -H 'X-Portal: web' --data '{"username":"Swhi-CGZX-05","password":"Swhi-CGZX-05@2026"}' -o /dev/null
curl --noproxy '*' -s -c "$H/b.jar" -X POST $B/api/auth/login -H "$J" -H 'X-Portal: web' --data '{"username":"Swhi-CGZX-05","password":"Swhi-CGZX-05@2026"}' -o /dev/null
$C -b "$H/a.jar" $B/api/user-settings -H 'X-Portal: web'
$C -b "$H/b.jar" $B/api/user-settings -H 'X-Portal: web'
/usr/bin/grep '/api/user-settings' "$H/api.log" | tail -n 2
# ④ 同一请求号串起请求内的业务日志（控制台短信桩，不发真实短信）
RID=$(curl --noproxy '*' -s -D - -o /dev/null -X POST $B/api/auth/mobile/send-code -H "$J" -H 'X-Portal: web' --data '{"phone":"13368360619"}' | /usr/bin/grep -i '^x-request-id' | awk '{print $2}' | tr -d '\r')
/usr/bin/grep "$RID" "$H/api.log"
# ⑤ WS 握手行
cat > "$H/ws-probe.cjs" <<'EOF'
const { io } = require('socket.io-client');
const s = io('http://127.0.0.1:4011', { extraHeaders: { Cookie: process.argv[2], 'X-Portal': 'web' }, transports: ['websocket'] });
setTimeout(() => { s.close(); }, 2000);
EOF
COOKIE=$(awk '$6=="token_web"{print "token_web="$7}' "$H/b.jar" | tail -n 1)
NODE_PATH="$API/node_modules" node "$H/ws-probe.cjs" "$COOKIE"
/usr/bin/grep 'ws=' "$H/api.log" | tail -n 1
# ⑥ 不经 Logger 的裸 console 输出（私有栈没配 LLM，生成今日安排会失败）
$C -b "$H/b.jar" --max-time 90 -X POST $B/api/work-arrangements/daily-plan/refresh -H 'X-Portal: web'
/usr/bin/grep 'req=' "$H/api.log" | /usr/bin/grep 'AI daily plan generation failed' | tail -n 1
# ⑦ 一次成功的写操作；改密申请成功、失败各一次（给页面「上次修改密码时间」备料）
$C -b "$H/b.jar" -X PATCH $B/api/user-settings -H "$J" -H 'X-Portal: web' --data '{"theme":"dark"}'
$C -b "$H/b.jar" -X POST $B/api/auth/password-change-requests -H "$J" -H 'X-Portal: web' --data '{"currentPassword":"Swhi-CGZX-05@2026","newPassword":"Swhi-CGZX-05@2027a"}'
sleep $(( 62 - 10#$(date +%S) ))      # 等到下一分钟：页面按分钟显示时间
$C -b "$H/b.jar" -X POST $B/api/auth/password-change-requests -H "$J" -H 'X-Portal: web' --data '{"currentPassword":"wrong-password","newPassword":"Swhi-CGZX-05@2027a"}'
/usr/bin/grep -E '保存个人设置|password-change-requests' "$H/api.log" | tail -n 3
```

Expected（时间与请求号取实际值）：

- ① `…  WARN api [req=xxxxxxxx] 匿名@信息门户 10.60.3.17 → POST /api/verification/check-registration-code 429 Nms [TOO_MANY_REQUESTS] 操作过于频繁，请稍候片刻再试 参数={"phone":"13800001234","code":"***"}`
- ② `…  WARN api [req=xxxxxxxx] 匿名@采购管理端 127.0.0.1 → 用户登录 POST /api/auth/login 401 Nms [UNAUTHORIZED] 用户名或密码错误 参数={"username":"Swhi-CGZX-05","password":"***"}`
- ③ 第一行 `…  WARN api [req=xxxxxxxx] 彭强(Swhi-CGZX-05·员工)@采购管理端 127.0.0.1 → 读取个人设置 GET /api/user-settings 401 Nms [SESSION_REPLACED] 该账号已在其他设备登录，请重新登录`；第二行同一个人、`INFO`、`200`。
- ④ 同一个请求号两行：先是 `…  WARN api [req=xxxxxxxx] 匿名@采购管理端 127.0.0.1 [ConsoleSmsProvider] [SMS-STUB] 验证码: <六位数> → 13368360619（场景: mobile_login）`，后跟 `… INFO api [req=xxxxxxxx] 匿名@采购管理端 127.0.0.1 → :3011 发送移动驾驶舱登录短信验证码（仅白名单手机号） POST /api/auth/mobile/send-code 200 Nms`。`[SMS-STUB]` 这行是既有的开发桩（仅非生产可用），照旧打出验证码，本次不改。该端点没打出发码行时，换任意一个会在请求里打业务日志的接口，看同一个请求号是否串起两行以上。
- ⑤ `… DEBUG api [ws=xxxxxxxx] 彭强(Swhi-CGZX-05·员工)@采购管理端 127.0.0.1 [NotificationGateway] WS 通知连接 <连接号>`
- ⑥ `… ERROR api [req=xxxxxxxx] 彭强(Swhi-CGZX-05·员工)@采购管理端 127.0.0.1 AI daily plan generation failed: …`（这一行没有模块名方括号，因为来源是裸 `console`）。
- ⑦ 三行：`… INFO api [req=…] 彭强(…)@采购管理端 127.0.0.1 → 保存个人设置 PATCH /api/user-settings 200 Nms`；`… INFO api … → 提交修改密码申请（管理员审批后生效） POST /api/auth/password-change-requests 2xx Nms`；`… WARN api … → 提交修改密码申请（管理员审批后生效） POST /api/auth/password-change-requests 401 Nms [CURRENT_PASSWORD_WRONG] 当前密码不正确 参数={"currentPassword":"***","newPassword":"***"}`。

worker 的行带进程名，最后把私有 API 与 worker 一起停掉：

```bash
H=/tmp/logging-upgrade; API=/home/asus/桌面/ERP/.worktrees/logging-upgrade/water-erp/apps/api
wt_pids() { for p in $(pgrep -f 'dist/(main|ai-bid-analysis-worker)\.js'); do [ "$(cat /proc/$p/comm 2>/dev/null)" = node ] && [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$API" ] && echo "$p"; done; }
(cd "$API" && nohup setsid bash "$H/ns.sh" node "$API/dist/ai-bid-analysis-worker.js" > "$H/worker.log" 2>&1 &)
sleep 8; head -n 3 "$H/worker.log"
kill $(wt_pids | tr '\n' ' ') 2>/dev/null
```

Expected: `… INFO  ai-worker [AiBidAnalysisWorker] AI 投标分析 worker 已启动（消费 tender/bidder 队列）`。

生产默认级别的样子（可选，一分钟）：`LOG_LEVELS=log,warn,error,fatal start_api` 重启私有 API，打几个请求，`/usr/bin/grep -c ' DEBUG ' "$H/api.log"` 为 0；不带前缀重启则大于 0。看完照上面停掉。

- [ ] **Step 6: 私有栈实走（页面）**

```bash
H=/tmp/logging-upgrade; API=/home/asus/桌面/ERP/.worktrees/logging-upgrade/water-erp/apps/api; WEB=/home/asus/桌面/ERP/.worktrees/logging-upgrade/water-erp/apps/web
wt_pids() { for p in $(pgrep -f 'dist/(main|ai-bid-analysis-worker)\.js'); do [ "$(cat /proc/$p/comm 2>/dev/null)" = node ] && [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$API" ] && echo "$p"; done; }
web_pids() { for p in $(pgrep -f 'next dev -p 3015|next-server'); do [ "$p" != "$$" ] && [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$WEB" ] && echo "$p"; done; }
start_api() { (cd "$API" && PORT=4011 nohup setsid bash "$H/ns.sh" node "$API/dist/main.js" > "$H/api.log" 2>&1 &); }
start_api; sleep 10          # 私有 API 重新起起来，这次走完再停
(cd "$WEB" && API_ORIGIN=http://127.0.0.1:4011 nohup setsid ./node_modules/.bin/next dev -p 3015 > "$H/web.log" 2>&1 &)
sleep 15; curl --noproxy '*' -s -o /dev/null -w '%{http_code}\n' http://localhost:3015/login
```

Expected: `200`。Turbopack 在 worktree 里起不来（符号链接越出根目录一类报错）说明任务 0 的硬链接复制没生效，回任务 0 Step 5。

无头浏览器用一次性的浏览器 profile（地址用 `localhost`，带 `--no-proxy-server`，配方见记忆 `headless-chrome-hydration-dead`）。页面会把管理员往 :3007 引，登录后不用理会，直接开要看的地址。逐项核对：

1. 以 `Swhi-CGZX-admin` 在 `http://localhost:3015/login` 登录，打开 `http://localhost:3015/admin/health?tab=log`。
2. 表头六列：操作、用户、来源、状态、耗时、时间。
3. 用户列显示「彭强」与 `Swhi-CGZX-05 · 员工`；来源列「采购管理端」与 `127.0.0.1`。
4. 被 401 拒绝的那一行同样显示是谁；展开后错误是 `[SESSION_REPLACED] 该账号已在其他设备登录，请重新登录`，处理位置是 `UserSettingsController.getSettings` 加路由模式。
5. 操作列第一行是中文动作（如「读取个人设置」「保存个人设置」）；没有摘要的行显示灰色的 `控制器.方法`。
6. 点请求号，出现提示「请求号已复制，可到控制台按此号搜索」。
7. 三个新筛选各自生效：IP 填 `127.0.0.1`、打开「只看失败」（只剩 401、429 的行）、打开「只看写操作」（只剩 POST、PATCH）；「重置」清空。
8. 角色下拉是中文，门户下拉没有「采购商城」。
9. 展开「预检」那一行，参数里手机号是明文、`code` 是 `***`；改密申请那一行两个密码都是 `***`。
10. 导出 txt，文件里有动作名与「请求号：…」。
11. 浏览器控制台没有报错。
12. 改用 `Swhi-CGZX-05` 登录，打开 `http://localhost:3015/profile`：「上次修改密码时间」是 ⑦ 里成功那一次的时间（按分钟），不是一分钟后的失败那次。

`bid_host` 在页面上看不到这页（系统管理是管理员专属菜单），他读到的掩码由 e2e 与任务 13 第 6 步在接口上验证。

```bash
H=/tmp/logging-upgrade; API=/home/asus/桌面/ERP/.worktrees/logging-upgrade/water-erp/apps/api; WEB=/home/asus/桌面/ERP/.worktrees/logging-upgrade/water-erp/apps/web
wt_pids() { for p in $(pgrep -f 'dist/(main|ai-bid-analysis-worker)\.js'); do [ "$(cat /proc/$p/comm 2>/dev/null)" = node ] && [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$API" ] && echo "$p"; done; }
web_pids() { for p in $(pgrep -f 'next dev -p 3015|next-server'); do [ "$p" != "$$" ] && [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "$WEB" ] && echo "$p"; done; }
kill $(wt_pids; web_pids) 2>/dev/null; sleep 1; ss -tlnH '( sport = :4011 or sport = :3015 )'      # 须无输出
```

私有库、Redis 容器、密钥库先留着，任务 13 变基后还要重建复验。

---

### Task 13: 变基复验、开发库迁移、合回与收尾（主会话执行）

**Files:**
- Modify: `/home/asus/桌面/ERP/CLAUDE.md`（加一节，用 Bash 改）
- Modify: 本计划文档（补执行记录）

- [ ] **Step 1: 变基**

主工作区若还留着未提交的本计划文档，先在 main 上单独提交它（`docs(logging): 后端日志完善实施计划`），再变基，否则后面无法快进合回。

```bash
cd "$WT" && git rebase main
```

冲突只可能出在共享高危文件（`schema.prisma`、`app.module.ts`、`bid.gateway.ts`、`prisma/migrations/`）。按块只动自己的行，不回退对方的改动。变基后若 main 新增的迁移时间戳晚于自己的，把自己的迁移目录改成当时的时间戳（改目录名与任务 9 提交里的路径），保证它在迁移链末尾。

```bash
cd "$API" && ./node_modules/.bin/prisma validate && ./node_modules/.bin/prisma generate
bash "$H/rebuild.sh"
```

Expected: schema 有效、客户端生成、私有库按变基后的结构重建成功。改了迁移目录名的话，新建的库同样由 `migrate deploy` 重放通过。

- [ ] **Step 2: 全量复验**

```bash
cd "$API" && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/jest
cd "$API" && ./node_modules/.bin/eslint src/logging src/operation-log src/common/filters src/auth/auth.guard.ts src/auth/auth.guard.spec.ts src/notification src/bid/bid.gateway.ts src/bid/bid.gateway.spec.ts src/chat src/verification/sms-provider.ts src/verification/sms-provider.spec.ts src/app.module.ts src/main.ts src/ai-bid-analysis-worker.ts test/operation-log.e2e-spec.ts test/setup-throttle.ts
cd "$WEB" && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/tsx --test "src/**/*.test.ts"
cd "$WT/water-erp" && bash scripts/copy-lint.sh --ci && bash scripts/check-cgzxui-redcards.sh --ci
bash "$H/run.sh" --testPathIgnorePatterns=announcement-tender-source-key
TZ=UTC bash "$H/run.sh" --testPathIgnorePatterns=announcement-tender-source-key
```

Expected: 全绿。

- [ ] **Step 3: 整体评审**

按所选执行方式的收尾步骤，让全新复核者对整条分支做一次评审（设计稿加本计划一并给它）。发现的问题修完、重跑 Step 2 受影响的部分，再往下走。

- [ ] **Step 4: 开发库迁移（金仓）**

`$H/dev.sh`——让 worktree 的 Prisma 命令连开发库：把主工作区的真实 `apps/api/.env` 盖到 worktree 的占位文件上，只在私有挂载命名空间里可见。

```bash
#!/usr/bin/env bash
set -euo pipefail
API=/home/asus/桌面/ERP/.worktrees/logging-upgrade/water-erp/apps/api
REAL=/home/asus/桌面/ERP/water-erp/apps/api/.env
[ -f "$REAL" ] && /usr/bin/grep -qE '^DATABASE_URL=.*:54321/' "$REAL" && /usr/bin/grep -qE '^DIRECT_URL=.*:54321/' "$REAL" || { echo "DEV WRAPPER REFUSE: main .env does not point at :54321"; exit 1; }
exec unshare -Urm bash -c 'set -e; mount --bind "$1" "$2"; cd "$(dirname "$2")"; exec "$@"' _ "$REAL" "$API/.env" "$@"
```

先让库自报身份，再做负对照：

```bash
cd "$API"
DBID_JS=$(cat <<'EOF'
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
p.$queryRawUnsafe("select current_database() || '@' || inet_server_port() as id").then((r: any) => { console.log('DBID ' + r[0].id); }).finally(() => p.$disconnect());
EOF
)
bash "$H/dev.sh" ./node_modules/.bin/tsx --env-file=.env -e "$DBID_JS" 2>&1 | /usr/bin/grep -E '^DBID'
bash "$H/dev.sh" ./node_modules/.bin/prisma migrate status
```

Expected: `DBID water_erp@54321`；状态里列出 `…_operation_log_meta` 为待应用。若还列了别人未应用的迁移，停下向用户报告，不要顺手应用。

应用并核对（`<迁移目录名>` 换成实际名字）：

```bash
M=<迁移目录名>
bash "$H/dev.sh" ./node_modules/.bin/prisma db execute --schema prisma/schema.prisma --file "prisma/migrations/$M/migration.sql"
bash "$H/dev.sh" ./node_modules/.bin/prisma migrate resolve --applied "$M"
bash "$H/dev.sh" ./node_modules/.bin/prisma migrate status
docker exec kingbase-pg-kingbase-1 ksql -U system -d water_erp -c '\d "OperationLog"' | /usr/bin/grep meta
docker exec kingbase-pg-kingbase-1 ksql -U system -d water_erp -At -c "select count(*) from pg_tables where tablename like 'OperationLog%'; select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relname like 'OperationLog%' and attname='meta';"
```

Expected: `Database schema is up to date`；`\d` 输出里有 `meta | jsonb`；两个计数相等（父表与各月分区都有这一列）。不相等就对每个缺列的子分区执行同一条 `ADD COLUMN`，并把这件事记进执行记录。

回滚材料：`ALTER TABLE "OperationLog" DROP COLUMN IF EXISTS "meta";`（只加了一列，旧行全是空值，旧代码忽略它）。

- [ ] **Step 5: 合回 main 并让开发链换上新代码**

```bash
git -C /home/asus/桌面/ERP status --short | /usr/bin/grep -v '^??'      # 须无输出（主工作区没有别人的未提交改动）
git -C /home/asus/桌面/ERP merge --ff-only feat/logging-upgrade
cd /home/asus/桌面/ERP/water-erp/apps/api && ./node_modules/.bin/prisma generate   # 之前确认各 worktree 的 schema.prisma 没有未提交改动
touch src/main.ts                                                        # 让 watch 重新编译并重启
sleep 25; curl --noproxy '*' -s -o /dev/null -D - http://127.0.0.1:4001/api/time | /usr/bin/grep -iE '^HTTP|x-request-id'
```

Expected: 快进合并成功；开发 API 重启后响应头带 `X-Request-Id`。迁移先于新代码启动——Step 4 必须在 Step 5 之前完成，否则新代码写 `meta` 列时报 P2022。

合并落盘后开发链的 watch 两秒左右就会重编译重启，可能抢在 `prisma generate` 之前。那一小段里新代码配旧客户端，操作日志落库会失败（只告警，不影响请求）；`generate` 完成后再 `touch` 一次让它重启，即恢复。随后的核对：用离线签发的 `admin` 令牌调 `GET /api/operation-log?limit=3`，行里带 `meta`。

- [ ] **Step 6: 真实链路走查（只读为主，不顶任何人的会话）**

令牌用离线签发：读本地 `JWT_SECRET` 签 2 小时、不带会话编号的令牌，走 `X-Web-Token` 头（做法见记忆 `audit-offline-jwt-readonly-probe`）。不登录、不轮换任何账号的会话；令牌只存 `$H`，用完删除，不打印。

1. 被顶下线的形状：签一枚 `sid` 随便填的 `staff` 令牌（`Swhi-CGZX-05`），`GET /api/user-settings`（带 `X-Portal: web`）得 401。查开发库最新一行：三列带 `Swhi-CGZX-05`，`error` 为 `[SESSION_REPLACED] …`（该账号当时有活动会话是「该账号已在其他设备登录，请重新登录」，没有则是「登录已失效，请重新登录」，两种都对），`meta` 四项齐。
2. `admin` 令牌调 `GET /api/operation-log?limit=5`（`X-Portal: web`）：每行带 `meta`。
3. `bid_host` 令牌调同一接口（`X-Portal: bid`）：请求体里的手机号是掩码。
4. 页面：无头浏览器（一次性 profile）打开 `http://localhost:3005/login`，在该标签页执行 `sessionStorage.setItem('webToken', '<admin 令牌>')`，再开 `/admin/health?tab=log`，按任务 12 Step 6 的第 2–11 项在真实数据上核对一遍（第 12 项要登录，不做）。页面若被弹回登录页（闸口看的是 cookie），在同一个标签页再执行一次 `document.cookie = 'token_web=<admin 令牌>; path=/'`。
5. `ai-worker` 不带 watch，要重启 dev 链才换上新日志器。dev 链是用户终端里的前台进程——请用户执行 `pnpm dev:kill && pnpm dev`，重启后看终端里 worker 的行是否以 `ai-worker` 开头。
6. 控制台行格式：开发链的控制台在用户终端里，本会话读不到。把任务 12 在私有栈抓到的样例行贴给用户，并请用户在终端里对照设计稿 6.1 抽看一眼。

- [ ] **Step 7: 注记与收尾**

`CLAUDE.md`：在「操作日志法定留存」一节之后、`## CI 流水线` 之前插入下面一节。ARS 守卫会拦 Edit 与 Write，用 Bash 插入；单独一个提交。

```markdown
## 后端日志口径（2026-11-26）

- **控制台行格式**：`<时间> <级别> <进程>[@节点] <请求上下文> [模块] <消息>`，进程本地时区；请求上下文 `[req=请求号] 姓名(账号·角色)@门户 [IP]`（WS 为 `[ws=连接号]`），只在请求或握手内出现。实现：`apps/api/src/logging/`（`AppLogger extends ConsoleLogger` + `AsyncLocalStorage` 请求上下文），两个进程入口（`main.ts`、ai-bid-analysis-worker.ts）统一接入并接管全局 `console.*`。**写日志一律用 `this.logger`**——存量裸 `console` 调用由入口接管兜底，新代码别再加。WS 各消息处理函数里的日志不带连接上下文（只有握手阶段带）；socket.io 轮询握手不经过 Express 中间件，没有请求号、不进上下文。
- **请求完成行**：每个请求结束打一行 `→ <中文动作> <方法> <路径> <状态> <耗时>ms [<错误码>] <原因>[ 参数=…]`（2xx INFO、4xx WARN、5xx ERROR 加堆栈）。打印点是操作日志拦截器与异常过滤器，靠 `__oplogRecorded` 标志互斥；排除表路由成功静默、失败打一行不带参数。`HTTP_ACCESS_LOG=off` 关闭；e2e 默认关（`test/setup-throttle.ts`）。
- **身份**：`AuthGuard` 验签成功即记日志身份，并写进 `userId/username/role` 三列——被冻结、被顶下线、改过密码、临时账号失效的 401 行自此带账号。三列的含义是「请求所持令牌对应的账号」，不是「已认证成功」；**读这三列的读端要结合 `statusCode` 判成败**。
- **明文开关**：`LOG_PII_MASK=true` 才对手机号、身份证、银行卡、邮箱打码，**默认明文**（用户裁定；等保或密评测评前置 true）。服从开关的出口只有三处：写库请求体、参数摘要、短信控制台行。`NotificationDeliveryLog.phoneMasked` 与返回前端的 `maskedPhone` 恒掩码。只有 `admin` 读到明文，其余角色读 `/operation-log` 时服务端重新打码。
- **凭证恒 `***`**：全局凭证键之外另有**按路由登记的敏感键**（`operation-log/sensitive-routes.ts`：短信验证码 `code`、评标室口令 `code`、回执令牌 `t`、邀请码 `code`）。**新增承载验证码、口令、令牌的请求字段，不论键名叫什么，都要在这份登记里加一行**——e2e 会校验登记的路由真实存在。同理，没有中文摘要的高频接口在 `logging/action-labels.ts` 纠偏表补中文名。
- **级别与表**：`LOG_LEVELS` 逗号分隔（log/warn/error/fatal/debug/verbose），生产默认 `log,warn,error,fatal`，其余六级全开；`LOG_NODE` 带节点名。`OperationLog.meta`（Json）存请求号、处理器、路由模式、中文动作、来源；该表只许手写 `ADD COLUMN` 迁移。
```

本计划文档末尾补「执行记录」：整体评审结论、两处实走的结论、迁移在金仓上的核对结果、没做的事。单独一个提交。

收尾：

```bash
git -C /home/asus/桌面/ERP worktree remove --force .worktrees/logging-upgrade && git -C /home/asus/桌面/ERP branch -d feat/logging-upgrade
docker exec water-erp-postgres psql -U water_erp -d postgres -c "DROP DATABASE IF EXISTS water_erp_e2e_log WITH (FORCE)"
docker rm -f water-erp-redis-e2e-log
```

桶 `water-erp-e2e-log` 里只有 e2e 上传的少量对象，留在开发 MinIO 里无害；要清就在 MinIO 控制台（`localhost:9001`）里删掉。最后删掉 `$H`（里面有密钥库副本与 env 文件）。删 worktree 只是减硬链接计数，不动主工作区的文件。

**不推送。**收尾时告诉用户三件事：main 领先远端多少个提交（等用户说了再推）；生产部署时新迁移随 `migrate deploy` 一并应用、`api` 与 `ai-worker` 两个镜像要一并重建（都换了日志器），可选加 `LOG_NODE`；设计稿第 9 节建议的日志轮转由用户在部署侧决定。

