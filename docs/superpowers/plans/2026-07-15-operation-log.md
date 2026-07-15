# 全系统操作日志（OperationLog）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一个后端全局拦截器自动记录全系统每一次 API 操作（含脱敏 body、状态码、耗时、IP/UA/门户），并提供查询 API。

**Architecture:** 新增 `OperationLog` Prisma 模型 + `OperationLogModule`（`@Global`，注册 `APP_INTERCEPTOR`）。拦截器在 `tap`/`catchError` 中以 fire-and-forget 方式调 `OperationLogService.create()` 落库；请求体经 `sanitize.util.ts` 脱敏（凭证全屏蔽、个人信息部分掩码）；`operation-log.filter.ts` 白名单排除 Swagger/socket.io/健康检查及可配置的轮询端点。查询 API 放开 `admin`+`bid_host`，`/my` 任意登录用户。

**Tech Stack:** NestJS 11、Prisma、RxJS（拦截器）、`@nestjs/schedule`（`@Cron` 清理）、jest（单测）、supertest（e2e）。

## Global Constraints

- 工作目录 `water-erp/`，API 在 `apps/api`。所有命令在 `water-erp/` 下执行；Prisma/migrate 命令用 `pnpm --filter api exec prisma ...`。
- 非交互 Prisma 迁移：设 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1`（CLAUDE.md Prisma Migration Notes）。
- `AuthenticatedUser = { sub: string; username: string; role: string; name?: string }`，已由全局 `AuthGuard` 挂到 `req.user`（`apps/api/src/auth/auth.types.ts`）。
- TS 无 `esModuleInterop`（仅 `allowSyntheticDefaultImports`）；CJS 函数导出包用 `import x = require('pkg')`。本计划不引入此类依赖。
- 现有「看全部活动」仅 `admin`（`auth-scope.ts:11`），但 `admin` 无种子用户 → 本计划查询 API 放开 `admin` + `bid_host`。
- `OperationLogModule` 必须自带 `JwtModule.register(...)`（全局 `AuthGuard` 守卫 controller 时注入 `JwtService`，与 `audit.module.ts` 同理——这是已验证的非死代码）。
- 每个任务结束提交；commit message 中文，结尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- 关联 spec：`docs/superpowers/specs/2026-07-15-operation-log-design.md`。

---

## File Structure

**新建：**
| 文件 | 职责 |
|------|------|
| `apps/api/src/common/client-ip.util.ts` | 从 `auth.controller.ts` 提取的 `getClientIp`+`normalizeIp`（DRY） |
| `apps/api/src/common/client-ip.util.spec.ts` | 单测 |
| `apps/api/src/operation-log/operation-log.types.ts` | `OperationLogEntry` / `OperationLogQuery` 类型 |
| `apps/api/src/operation-log/sanitize.util.ts` | 递归脱敏 + 部分掩码 + 截断（`sanitizeBody`/`sanitizeValue`/`truncateString`） |
| `apps/api/src/operation-log/sanitize.util.spec.ts` | 单测 |
| `apps/api/src/operation-log/operation-log.filter.ts` | 白名单排除（`DEFAULT_EXCLUDE_PATHS`/`parseExcludePaths`/`shouldExclude`） |
| `apps/api/src/operation-log/operation-log.filter.spec.ts` | 单测 |
| `apps/api/src/operation-log/operation-log.service.ts` | `create` / `findAll` / `findMine` / `@Cron scheduledCleanup` |
| `apps/api/src/operation-log/operation-log.service.spec.ts` | 单测（mock PrismaService） |
| `apps/api/src/operation-log/operation-log.interceptor.ts` | 全局拦截器 + 纯函数 `buildLogEntry` |
| `apps/api/src/operation-log/operation-log.interceptor.spec.ts` | `buildLogEntry` 单测 |
| `apps/api/src/operation-log/operation-log.controller.ts` | `GET /operation-log` + `GET /operation-log/my` |
| `apps/api/src/operation-log/operation-log.module.ts` | `@Global`，注册 `APP_INTERCEPTOR` + `JwtModule` |
| `apps/api/test/operation-log.e2e-spec.ts` | e2e |

**修改：**
| 文件 | 改动 |
|------|------|
| `apps/api/prisma/schema.prisma` | 新增 `OperationLog` 模型 |
| `apps/api/src/auth/auth.controller.ts` | 删除私有 `getClientIp`/`normalizeIp`，改 import 自 `common/client-ip.util` |
| `apps/api/src/app.module.ts` | `imports` 加 `OperationLogModule` |
| `apps/api/.env` | 补 4 个配置项 |

---

### Task 1: Prisma `OperationLog` 模型 + 迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma`（在 `AuditLog` 模型之后插入）

**Interfaces:**
- Produces: `prisma.operationLog`（Prisma client，供 Task 5 的 `OperationLogService` 使用）

- [ ] **Step 1: 在 schema 末尾追加模型**

打开 `apps/api/prisma/schema.prisma`，定位 `model AuditLog { ... }`（约 1149-1164 行），在其后插入：

```prisma
// ── 全系统操作日志（拦截器自动落库，与手动埋点的 AuditLog 并行）──

model OperationLog {
  id         String   @id @default(cuid())
  userId     String?
  username   String?
  role       String?
  portal     String?
  method     String
  path       String
  query      String?
  body       Json?
  statusCode Int
  durationMs Int
  ipAddress  String?
  userAgent  String?
  referer    String?
  error      String?
  createdAt  DateTime @default(now())

  @@index([userId, createdAt])
  @@index([createdAt])
  @@index([role, createdAt])
  @@index([portal, createdAt])
  @@index([path, createdAt])
  @@index([statusCode, createdAt])
}
```

- [ ] **Step 2: 迁移 + 生成 client**

Run（在 `water-erp/`）:
```bash
PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=1 pnpm --filter api exec prisma migrate dev --name add_operation_log
pnpm --filter api exec prisma generate
```
Expected: `Applied changes` + 生成 `apps/api/prisma/migrations/<ts>_add_operation_log/migration.sql`；`generate` 输出 `✔ Generated Prisma Client`。

- [ ] **Step 3: 验证 client 可用**

Run:
```bash
grep -c "operationLog" apps/api/node_modules/.prisma/client/index.d.ts
```
Expected: 输出 `≥ 1`（client 已含 `operationLog` delegate）。

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): 新增 OperationLog 操作日志模型

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: 提取 `getClientIp` 到共享工具（DRY）

把 `auth.controller.ts` 私有的 `getClientIp` + `normalizeIp` 原样提到 `common/client-ip.util.ts`，`OperationLogInterceptor`（Task 6）与 `auth.controller` 共用。

**Files:**
- Create: `apps/api/src/common/client-ip.util.ts`
- Create: `apps/api/src/common/client-ip.util.spec.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`（删私有函数 + 加 import）

**Interfaces:**
- Produces: `getClientIp(req: Request): string | null`

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/common/client-ip.util.spec.ts`：

```ts
import { getClientIp } from './client-ip.util';

const makeReq = (headers: Record<string, string | undefined> = {}, ip?: string, remote?: string) =>
  ({ headers, ip, socket: { remoteAddress: remote } } as any);

describe('getClientIp', () => {
  it('X-Forwarded-For 取第一个（最左）', () => {
    expect(getClientIp(makeReq({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe('1.2.3.4');
  });

  it('回退到 X-Real-IP', () => {
    expect(getClientIp(makeReq({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
  });

  it('回退到 req.ip', () => {
    expect(getClientIp(makeReq({}, '203.0.113.1'))).toBe('203.0.113.1');
  });

  it('IPv6 回环 ::1 标准化为 127.0.0.1', () => {
    expect(getClientIp(makeReq({ 'x-forwarded-for': '::1' }))).toBe('127.0.0.1');
  });

  it('去除 ::ffff: 前缀', () => {
    expect(getClientIp(makeReq({ 'x-forwarded-for': '::ffff:192.168.1.1' }))).toBe('192.168.1.1');
  });

  it('无任何来源返回 null', () => {
    expect(getClientIp(makeReq())).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter api test -- client-ip.util.spec`
Expected: FAIL（`Cannot find module './client-ip.util'`）。

- [ ] **Step 3: 创建实现**

创建 `apps/api/src/common/client-ip.util.ts`：

```ts
import { Request } from 'express';

/**
 * 从请求中提取真实客户端 IP。
 * 优先 X-Forwarded-For → X-Real-IP → req.ip → socket.remoteAddress，
 * IPv6 回环标准化为 127.0.0.1，去除 ::ffff: 前缀。
 */
export function getClientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'] as string | undefined;
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return normalizeIp(first);
  }
  const realIp = req.headers['x-real-ip'] as string | undefined;
  if (realIp) return normalizeIp(realIp);
  if (req.ip) return normalizeIp(req.ip);
  const remote = req.socket?.remoteAddress;
  return remote ? normalizeIp(remote) : null;
}

/** 标准化 IP：IPv6-mapped IPv4 去前缀；IPv6 回环 → 127.0.0.1 */
function normalizeIp(ip: string): string {
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return '127.0.0.1';
  return ip;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter api test -- client-ip.util.spec`
Expected: PASS（6 个用例全绿）。

- [ ] **Step 5: 修改 auth.controller.ts 复用**

打开 `apps/api/src/auth/auth.controller.ts`：
1. 删除文件内私有函数 `getClientIp`（约 19-34 行）和 `normalizeIp`（约 40-44 行，含其上方注释）。
2. 在顶部 import 区（已有 `import { ... } from './portal-cookie';` 一行附近）新增：

```ts
import { getClientIp } from '../common/client-ip.util';
```

- [ ] **Step 6: 验证 auth 流程未破坏**

Run: `pnpm --filter api test -- auth`
Expected: 既有 auth 相关单测仍 PASS（行为不变，仅提取）。

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/common/client-ip.util.ts apps/api/src/common/client-ip.util.spec.ts apps/api/src/auth/auth.controller.ts
git commit -m "refactor(api): 提取 getClientIp 到 common/client-ip.util（DRY）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 脱敏工具 `sanitize.util.ts`

递归脱敏请求体：凭证类 → `***`；手机/身份证/银行卡 → 部分掩码；超限 → `{ _truncated, preview }`。

**Files:**
- Create: `apps/api/src/operation-log/sanitize.util.ts`
- Create: `apps/api/src/operation-log/sanitize.util.spec.ts`

**Interfaces:**
- Produces: `sanitizeBody(body, maxBytes?): unknown`、`truncateString(s, max): string`

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/operation-log/sanitize.util.spec.ts`：

```ts
import { sanitizeBody, truncateString } from './sanitize.util';

describe('sanitizeBody', () => {
  it('凭证类字段 → ***（password/token/secret/key 等）', () => {
    expect(sanitizeBody({ password: 'abc', token: 'xyz', apiKey: 'k', kmsSecret: 'm' })).toEqual({
      password: '***', token: '***', apiKey: '***', kmsSecret: '***',
    });
  });

  it('手机号 → 前3后4 掩码', () => {
    expect(sanitizeBody({ phone: '13812341234', mobile: '15800001111' })).toEqual({
      phone: '138****1234', mobile: '158****1111',
    });
  });

  it('身份证 → 前6后4 掩码', () => {
    expect(sanitizeBody({ idCard: '510102199001011234' })).toEqual({
      idCard: '510102********1234',
    });
  });

  it('银行卡 → 前4后4 掩码', () => {
    expect(sanitizeBody({ bankCard: '6222020200012345678' })).toEqual({
      bankCard: '6222****5678',
    });
  });

  it('长度不足掩码时回退 ***', () => {
    expect(sanitizeBody({ phone: '123' })).toEqual({ phone: '***' });
  });

  it('递归脱敏嵌套对象与数组', () => {
    const out = sanitizeBody({ user: { password: 'p', contact: { mobile: '13812341234' } }, list: [{ token: 't' }] });
    expect(out).toEqual({
      user: { password: '***', contact: { mobile: '138****1234' } },
      list: [{ token: '***' }],
    });
  });

  it('非敏感字段原样保留', () => {
    expect(sanitizeBody({ name: '张三', score: 90 })).toEqual({ name: '张三', score: 90 });
  });

  it('超 maxBytes → { _truncated, preview }', () => {
    const big = { data: 'x'.repeat(5000) };
    const out = sanitizeBody(big, 1024) as any;
    expect(out._truncated).toBe(true);
    expect(typeof out.preview).toBe('string');
    expect(out.preview.length).toBeLessThanOrEqual(1024);
  });

  it('null/undefined → null', () => {
    expect(sanitizeBody(null)).toBeNull();
    expect(sanitizeBody(undefined)).toBeNull();
  });
});

describe('truncateString', () => {
  it('未超长原样返回', () => {
    expect(truncateString('abc', 10)).toBe('abc');
  });
  it('超长截断并加标记', () => {
    expect(truncateString('abcdefghij', 5)).toBe('abcde…[截断]');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter api test -- sanitize.util.spec`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 创建实现**

创建 `apps/api/src/operation-log/sanitize.util.ts`：

```ts
/** 凭证类字段 —— 值整体替换为 ***（绝不入库明文） */
const CREDENTIAL_KEYS = [
  'password', 'pwd', 'token', 'secret', 'apikey', 'api_key', 'authorization',
  'kmssecret', 'kms', 'privatekey', 'captcha', 'verificationcode', 'smscode',
];

/** 个人信息类字段 —— 部分掩码（保留可识别性） */
const PHONE_KEYS = ['phone', 'mobile', 'telephone'];
const IDCARD_KEYS = ['idcard', 'idnumber'];
const BANK_KEYS = ['bankcard', 'cardno', 'bankaccount'];

const includesAny = (key: string, words: string[]): boolean => {
  const k = key.toLowerCase();
  return words.some((w) => k.includes(w));
};

function maskPhone(value: unknown): string {
  const d = String(value).replace(/\D/g, '');
  if (d.length < 7) return '***';
  return `${d.slice(0, 3)}****${d.slice(-4)}`;
}

function maskIdCard(value: unknown): string {
  const s = String(value);
  if (s.length < 10) return '***';
  return `${s.slice(0, 6)}${'*'.repeat(Math.max(s.length - 10, 4))}${s.slice(-4)}`;
}

function maskBank(value: unknown): string {
  const d = String(value).replace(/\D/g, '');
  if (d.length < 8) return '***';
  return `${d.slice(0, 4)}****${d.slice(-4)}`;
}

/** 按字段名对单个值脱敏（不递归；嵌套由 sanitizeObject 处理） */
export function sanitizeValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (includesAny(key, CREDENTIAL_KEYS)) return '***';
  if (includesAny(key, PHONE_KEYS)) return maskPhone(value);
  if (includesAny(key, IDCARD_KEYS)) return maskIdCard(value);
  if (includesAny(key, BANK_KEYS)) return maskBank(value);
  if (typeof value === 'object') return sanitizeObject(value);
  return value;
}

/** 递归脱敏对象/数组 */
export function sanitizeObject(input: unknown): unknown {
  if (Array.isArray(input)) return input.map((v) => (typeof v === 'object' && v !== null ? sanitizeObject(v) : v));
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) out[k] = sanitizeValue(k, v);
    return out;
  }
  return input;
}

export function truncateString(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…[截断]` : s;
}

/**
 * 脱敏请求体并截断：先递归脱敏 → JSON.stringify → 超 maxBytes 则存 { _truncated, preview }。
 * 不可序列化（循环引用等）返回 null。
 */
export function sanitizeBody(body: unknown, maxBytes = 4096): unknown {
  if (body === null || body === undefined) return null;
  const sanitized = sanitizeObject(body);
  let serialized: string;
  try {
    serialized = JSON.stringify(sanitized);
  } catch {
    return null;
  }
  if (serialized.length <= maxBytes) return sanitized;
  return { _truncated: true, preview: serialized.slice(0, maxBytes) };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter api test -- sanitize.util.spec`
Expected: PASS（全部用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/operation-log/sanitize.util.ts apps/api/src/operation-log/sanitize.util.spec.ts
git commit -m "feat(operation-log): 请求体脱敏工具（凭证全屏蔽+个人信息掩码+截断）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: 白名单过滤 `operation-log.filter.ts`

**Files:**
- Create: `apps/api/src/operation-log/operation-log.filter.ts`
- Create: `apps/api/src/operation-log/operation-log.filter.spec.ts`

**Interfaces:**
- Produces: `DEFAULT_EXCLUDE_PATHS`、`parseExcludePaths(raw?: string): ExcludePattern[]`、`shouldExclude(path, exclude[]): boolean`、类型 `ExcludePattern`

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/operation-log/operation-log.filter.spec.ts`：

```ts
import { DEFAULT_EXCLUDE_PATHS, parseExcludePaths, shouldExclude } from './operation-log.filter';

describe('shouldExclude', () => {
  it('非 /api 前缀（静态资源）排除', () => {
    expect(shouldExclude('/_next/static/app.js', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  });

  it('Swagger /api/docs 排除', () => {
    expect(shouldExclude('/api/docs', DEFAULT_EXCLUDE_PATHS)).toBe(true);
    expect(shouldExclude('/api/docs-json', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  });

  it('socket.io 排除（正则）', () => {
    expect(shouldExclude('/socket.io/?EIO=4', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  });

  it('健康检查排除', () => {
    expect(shouldExclude('/api/health', DEFAULT_EXCLUDE_PATHS)).toBe(true);
  });

  it('正常业务接口放行', () => {
    expect(shouldExclude('/api/bid/projects', DEFAULT_EXCLUDE_PATHS)).toBe(false);
    expect(shouldExclude('/api/auth/me', DEFAULT_EXCLUDE_PATHS)).toBe(false);
  });
});

describe('parseExcludePaths', () => {
  it('解析逗号分隔字符串前缀', () => {
    const r = parseExcludePaths('/api/bid/open/poll,/api/score/progress');
    expect(r).toEqual(['/api/bid/open/poll', '/api/score/progress']);
  });

  it('识别 /.../ 形式为正则', () => {
    const r = parseExcludePaths('/^\\/api\\/poll\\//');
    expect(r[0]).toBeInstanceOf(RegExp);
    expect((r[0] as RegExp).test('/api/poll/x')).toBe(true);
  });

  it('空/未定义 → []', () => {
    expect(parseExcludePaths(undefined)).toEqual([]);
    expect(parseExcludePaths('')).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter api test -- operation-log.filter.spec`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 创建实现**

创建 `apps/api/src/operation-log/operation-log.filter.ts`：

```ts
export type ExcludePattern = string | RegExp;

/** 确定性噪声：Swagger / socket.io / 健康检查 */
export const DEFAULT_EXCLUDE_PATHS: ExcludePattern[] = [
  '/api/docs',
  '/api/docs-json',
  '/api-json',
  /^\/socket\.io\//,
  '/api/health',
  '/api/healthz',
];

/**
 * 解析 OPERATION_LOG_EXCLUDE 环境变量（逗号分隔）。
 * `/.../flags` 形式识别为正则，其余按字符串前缀匹配。
 */
export function parseExcludePaths(raw?: string): ExcludePattern[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^\/(.+)\/([gimsuy]*)$/);
      if (m) {
        try {
          return new RegExp(m[1], m[2]);
        } catch {
          return part;
        }
      }
      return part;
    });
}

/** 是否应排除记录：非 /api 前缀，或命中任一排除模式 */
export function shouldExclude(path: string, exclude: ExcludePattern[]): boolean {
  if (!path.startsWith('/api')) return true;
  return exclude.some((p) => (typeof p === 'string' ? path.startsWith(p) : p.test(path)));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter api test -- operation-log.filter.spec`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/operation-log/operation-log.filter.ts apps/api/src/operation-log/operation-log.filter.spec.ts
git commit -m "feat(operation-log): 白名单过滤（Swagger/socket.io/健康检查+可配置轮询）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: `OperationLogService` + 类型

**Files:**
- Create: `apps/api/src/operation-log/operation-log.types.ts`
- Create: `apps/api/src/operation-log/operation-log.service.ts`
- Create: `apps/api/src/operation-log/operation-log.service.spec.ts`

**Interfaces:**
- Consumes: `prisma.operationLog`（Task 1）
- Produces: `OperationLogService.create(entry)`、`.findAll(q)`、`.findMine(userId, q)`；类型 `OperationLogEntry`、`OperationLogQuery`（Task 6 依赖）

- [ ] **Step 1: 写类型定义**

创建 `apps/api/src/operation-log/operation-log.types.ts`：

```ts
/** 拦截器构建、service 落库的单条日志载荷 */
export interface OperationLogEntry {
  userId: string | null;
  username: string | null;
  role: string | null;
  portal: string | null;
  method: string;
  path: string;
  query: string | null;
  body: unknown;
  statusCode: number;
  durationMs: number;
  ipAddress: string | null;
  userAgent: string | null;
  referer: string | null;
  error: string | null;
}

/** 查询参数（controller 收到的均为字符串，service 内部转换） */
export interface OperationLogQuery {
  userId?: string;
  username?: string;
  role?: string;
  portal?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  statusClass?: 'success' | 'client' | 'server';
  keyword?: string;
  startTime?: string;
  endTime?: string;
  limit?: number;
  offset?: number;
}
```

- [ ] **Step 2: 写失败测试**

创建 `apps/api/src/operation-log/operation-log.service.spec.ts`：

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { OperationLogService } from './operation-log.service';

describe('OperationLogService', () => {
  let service: OperationLogService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      operationLog: { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), deleteMany: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [OperationLogService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(OperationLogService);
  });

  const sampleEntry = {
    userId: 'u1', username: '张三', role: 'bid_expert', portal: 'expert',
    method: 'POST', path: '/api/bid/score', query: null, body: { a: 1 },
    statusCode: 200, durationMs: 12, ipAddress: '1.2.3.4', userAgent: 'ua', referer: null, error: null,
  };

  it('create 透传给 prisma.operationLog.create', async () => {
    prisma.operationLog.create.mockResolvedValue({});
    await service.create(sampleEntry);
    expect(prisma.operationLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ path: '/api/bid/score', userId: 'u1' }) });
  });

  it('create 失败只 warn 不抛', async () => {
    prisma.operationLog.create.mockRejectedValue(new Error('db down'));
    await expect(service.create(sampleEntry)).resolves.toBeUndefined();
  });

  it('findAll 应用筛选 + 分页 + count', async () => {
    prisma.operationLog.findMany.mockResolvedValue([{ id: '1' }]);
    prisma.operationLog.count.mockResolvedValue(1);
    const r = await service.findAll({ role: 'bid_expert', path: '/score', limit: 10, offset: 5 });
    expect(prisma.operationLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ role: 'bid_expert', path: { contains: '/score' } }),
      take: 10, skip: 5,
    }));
    expect(r).toEqual({ items: [{ id: '1' }], total: 1 });
  });

  it('findMine 强制锁定 userId', async () => {
    prisma.operationLog.findMany.mockResolvedValue([]);
    prisma.operationLog.count.mockResolvedValue(0);
    await service.findMine('u1', { userId: 'hacker' });
    expect(prisma.operationLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'u1' }),
    }));
  });

  it('statusClass=server → statusCode gte 500 lt 600', async () => {
    prisma.operationLog.findMany.mockResolvedValue([]);
    prisma.operationLog.count.mockResolvedValue(0);
    await service.findAll({ statusClass: 'server' });
    expect(prisma.operationLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ statusCode: { gte: 500, lt: 600 } }),
    }));
  });

  it('startTime/endTime → createdAt 范围', async () => {
    prisma.operationLog.findMany.mockResolvedValue([]);
    prisma.operationLog.count.mockResolvedValue(0);
    await service.findAll({ startTime: '2026-01-01T00:00:00Z', endTime: '2026-02-01T00:00:00Z' });
    expect(prisma.operationLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdAt: { gte: new Date('2026-01-01T00:00:00Z'), lte: new Date('2026-02-01T00:00:00Z') } }),
    }));
  });

  it('scheduledCleanup 按 retentionDays 删除旧记录', async () => {
    prisma.operationLog.deleteMany.mockResolvedValue({ count: 3 });
    await service.scheduledCleanup();
    expect(prisma.operationLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) } },
    });
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `pnpm --filter api test -- operation-log.service.spec`
Expected: FAIL（`OperationLogService` 未定义）。

- [ ] **Step 4: 创建实现**

创建 `apps/api/src/operation-log/operation-log.service.ts`：

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { OperationLogEntry, OperationLogQuery } from './operation-log.types';

@Injectable()
export class OperationLogService {
  private readonly logger = new Logger(OperationLogService.name);
  private readonly retentionDays: number;

  constructor(private readonly prisma: PrismaService) {
    const raw = Number(process.env.OPERATION_LOG_RETENTION_DAYS);
    this.retentionDays = Number.isFinite(raw) && raw > 0 ? raw : 180;
  }

  /** fire-and-forget 落库；失败只 warn，绝不影响业务 */
  async create(entry: OperationLogEntry): Promise<void> {
    try {
      await this.prisma.operationLog.create({
        data: {
          userId: entry.userId,
          username: entry.username,
          role: entry.role,
          portal: entry.portal,
          method: entry.method,
          path: entry.path,
          query: entry.query,
          body: entry.body as Prisma.InputJsonValue,
          statusCode: entry.statusCode,
          durationMs: entry.durationMs,
          ipAddress: entry.ipAddress,
          userAgent: entry.userAgent,
          referer: entry.referer,
          error: entry.error,
        },
      });
    } catch (err) {
      this.logger.warn(`OperationLog 写入失败: ${err}`);
    }
  }

  /** 每日 04:00 清理超期记录（错开 AuditLog 的 03:00） */
  @Cron('0 4 * * *')
  async scheduledCleanup(): Promise<void> {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - this.retentionDays);
      const r = await this.prisma.operationLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
      if (r.count > 0) this.logger.log(`OperationLog 清理：删除 ${r.count} 条超过 ${this.retentionDays} 天的记录`);
    } catch (err) {
      this.logger.warn(`OperationLog 清理失败: ${err}`);
    }
  }

  async findAll(q: OperationLogQuery) {
    const limit = Math.min(q.limit ?? 50, 100);
    const offset = q.offset ?? 0;
    const where = this.buildWhere(q);
    const [items, total] = await Promise.all([
      this.prisma.operationLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.operationLog.count({ where }),
    ]);
    return { items, total };
  }

  async findMine(userId: string, q: OperationLogQuery) {
    const limit = Math.min(q.limit ?? 50, 100);
    const offset = q.offset ?? 0;
    const where: Prisma.OperationLogWhereInput = { ...this.buildWhere(q), userId };
    const [items, total] = await Promise.all([
      this.prisma.operationLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.operationLog.count({ where }),
    ]);
    return { items, total };
  }

  private buildWhere(q: OperationLogQuery): Prisma.OperationLogWhereInput {
    const where: Prisma.OperationLogWhereInput = {};
    if (q.userId) where.userId = q.userId;
    if (q.username) where.username = q.username;
    if (q.role) where.role = q.role;
    if (q.portal) where.portal = q.portal;
    if (q.method) where.method = q.method.toUpperCase();
    if (q.path) where.path = { contains: q.path };
    if (q.statusCode) where.statusCode = q.statusCode;
    else if (q.statusClass === 'success') where.statusCode = { gte: 200, lt: 400 };
    else if (q.statusClass === 'client') where.statusCode = { gte: 400, lt: 500 };
    else if (q.statusClass === 'server') where.statusCode = { gte: 500, lt: 600 };

    if (q.startTime || q.endTime) {
      where.createdAt = {};
      if (q.startTime) (where.createdAt as any).gte = new Date(q.startTime);
      if (q.endTime) (where.createdAt as any).lte = new Date(q.endTime);
    }
    if (q.keyword) {
      where.OR = [{ path: { contains: q.keyword } }, { query: { contains: q.keyword } }];
    }
    return where;
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter api test -- operation-log.service.spec`
Expected: PASS（7 个用例）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/operation-log/operation-log.types.ts apps/api/src/operation-log/operation-log.service.ts apps/api/src/operation-log/operation-log.service.spec.ts
git commit -m "feat(operation-log): OperationLogService（create/查询/@Cron 清理）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: `OperationLogInterceptor` + `buildLogEntry`

**Files:**
- Create: `apps/api/src/operation-log/operation-log.interceptor.ts`
- Create: `apps/api/src/operation-log/operation-log.interceptor.spec.ts`

**Interfaces:**
- Consumes: `OperationLogService.create`（Task 5）、`getClientIp`（Task 2）、`portalFromRequest`、`sanitizeBody`（Task 3）、`shouldExclude`（Task 4）
- Produces: 纯函数 `buildLogEntry(req, statusCode, durationMs, error, bodyMaxBytes)`、类 `OperationLogInterceptor`

- [ ] **Step 1: 写失败测试（buildLogEntry 纯函数）**

创建 `apps/api/src/operation-log/operation-log.interceptor.spec.ts`：

```ts
import { buildLogEntry } from './operation-log.interceptor';

const makeReq = (overrides: any = {}) =>
  ({
    method: 'POST',
    originalUrl: '/api/bid/score?x=1',
    path: '/api/bid/score',
    url: '/api/bid/score?x=1',
    headers: { 'user-agent': 'Mozilla/5.0', 'x-portal': 'expert' },
    body: { password: 'secret', score: 90 },
    socket: {},
    ...overrides,
  }) as any;

describe('buildLogEntry', () => {
  it('已登录：取 sub/username/role；body 脱敏', () => {
    const req = makeReq({ user: { sub: 'u1', username: '张三', role: 'bid_expert' } });
    const e = buildLogEntry(req, 200, 15, null, 4096);
    expect(e.userId).toBe('u1');
    expect(e.username).toBe('张三');
    expect(e.role).toBe('bid_expert');
    expect(e.portal).toBe('expert'); // X-Portal 头
    expect(e.method).toBe('POST');
    expect(e.path).toBe('/api/bid/score');
    expect(e.query).toBe('x=1');
    expect(e.body).toEqual({ password: '***', score: 90 });
    expect(e.statusCode).toBe(200);
    expect(e.durationMs).toBe(15);
    expect(e.userAgent).toBe('Mozilla/5.0');
    expect(e.error).toBeNull();
  });

  it('未登录：userId null、role anonymous', () => {
    const e = buildLogEntry(makeReq(), 401, 3, null, 4096);
    expect(e.userId).toBeNull();
    expect(e.role).toBe('anonymous');
    expect(e.statusCode).toBe(401);
  });

  it('异常：error 取 message', () => {
    const e = buildLogEntry(makeReq({ user: { sub: 'u1', username: 'a', role: 'admin' } }), 500, 8, new Error('boom'), 4096);
    expect(e.error).toBe('boom');
    expect(e.statusCode).toBe(500);
  });

  it('无 X-Portal/Referer 时 portal 为 null', () => {
    const req = makeReq({ headers: { 'user-agent': 'ua' }, user: { sub: 'u1', username: 'a', role: 'admin' } });
    expect(buildLogEntry(req, 200, 1, null, 4096).portal).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter api test -- operation-log.interceptor.spec`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 创建实现**

创建 `apps/api/src/operation-log/operation-log.interceptor.ts`：

```ts
import { CallHandler, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { Request } from 'express';
import { OperationLogService } from './operation-log.service';
import type { OperationLogEntry } from './operation-log.types';
import { getClientIp } from '../common/client-ip.util';
import { portalFromRequest } from '../auth/portal-cookie';
import { sanitizeBody, truncateString } from './sanitize.util';
import { DEFAULT_EXCLUDE_PATHS, parseExcludePaths, shouldExclude, type ExcludePattern } from './operation-log.filter';

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
    query: query ? truncateString(query, QUERY_MAX) : null,
    body: sanitizeBody((req as any).body, bodyMaxBytes),
    statusCode,
    durationMs,
    ipAddress: getClientIp(req),
    userAgent: ua ? truncateString(String(ua), UA_MAX) : null,
    referer: referer ? truncateString(String(referer), QUERY_MAX) : null,
    error: error ? truncateString(error instanceof Error ? error.message : String(error), ERROR_MAX) : null,
  };
}

@Injectable()
export class OperationLogInterceptor {
  private readonly logger = new Logger(OperationLogInterceptor.name);
  private readonly enabled: boolean;
  private readonly bodyMaxBytes: number;
  private readonly exclude: ExcludePattern[];

  constructor(private readonly service: OperationLogService) {
    this.enabled = process.env.OPERATION_LOG_ENABLED !== 'false';
    this.bodyMaxBytes = (Number(process.env.OPERATION_LOG_BODY_MAX_KB) || 4) * 1024;
    this.exclude = [...DEFAULT_EXCLUDE_PATHS, ...parseExcludePaths(process.env.OPERATION_LOG_EXCLUDE)];
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled) return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    if (shouldExclude(req.path, this.exclude)) return next.handle();

    const start = Date.now();
    const record = (statusCode: number, error: unknown | null) => {
      const entry = buildLogEntry(req, statusCode, Date.now() - start, error, this.bodyMaxBytes);
      this.service.create(entry).catch((e) => this.logger.warn(`OperationLog 记录失败: ${e?.message ?? e}`));
    };

    return next.handle().pipe(
      tap(() => record(http.getResponse<{ statusCode: number }>().statusCode, null)),
      catchError((err) => {
        const status = typeof err?.getStatus === 'function' ? err.getStatus() : 500;
        record(status, err);
        return throwError(() => err);
      }),
    );
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter api test -- operation-log.interceptor.spec`
Expected: PASS（4 个用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/operation-log/operation-log.interceptor.ts apps/api/src/operation-log/operation-log.interceptor.spec.ts
git commit -m "feat(operation-log): 全局拦截器 + buildLogEntry（fire-and-forget）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Controller + Module + 注册 + .env

**Files:**
- Create: `apps/api/src/operation-log/operation-log.controller.ts`
- Create: `apps/api/src/operation-log/operation-log.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/.env`

**Interfaces:**
- Consumes: `OperationLogService`（Task 5）、`OperationLogInterceptor`（Task 6）

- [ ] **Step 1: 创建 controller**

创建 `apps/api/src/operation-log/operation-log.controller.ts`：

```ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { OperationLogService } from './operation-log.service';
import type { OperationLogQuery } from './operation-log.types';

@ApiTags('操作日志')
@Controller('operation-log')
@UseGuards(AuthGuard)
export class OperationLogController {
  constructor(private readonly service: OperationLogService) {}

  @Get()
  @Roles('admin', 'bid_host')
  @ApiOperation({ summary: '查询全部操作日志（admin/bid_host）' })
  async findAll(@Query() q: OperationLogQuery) {
    return this.service.findAll(this.normalize(q));
  }

  @Get('my')
  @ApiOperation({ summary: '查询当前用户的操作日志' })
  async findMine(@CurrentUser() user: AuthenticatedUser, @Query() q: OperationLogQuery) {
    return this.service.findMine(user.sub, this.normalize(q));
  }

  /** query 参数均为字符串，按需转 number */
  private normalize(q: OperationLogQuery): OperationLogQuery {
    return {
      ...q,
      limit: q.limit !== undefined ? Number(q.limit) : undefined,
      offset: q.offset !== undefined ? Number(q.offset) : undefined,
      statusCode: q.statusCode !== undefined ? Number(q.statusCode) : undefined,
    };
  }
}
```

- [ ] **Step 2: 创建 module**

创建 `apps/api/src/operation-log/operation-log.module.ts`：

```ts
import { Module, Global } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { getJwtSecret } from '../common/jwt-secret.helper';
import { OperationLogService } from './operation-log.service';
import { OperationLogController } from './operation-log.controller';
import { OperationLogInterceptor } from './operation-log.interceptor';

@Global()
@Module({
  // controller 受全局 AuthGuard 守卫，AuthGuard 注入 JwtService（与 audit.module 同理）。
  imports: [JwtModule.register({ secret: getJwtSecret(), signOptions: { expiresIn: '7d' } })],
  controllers: [OperationLogController],
  providers: [OperationLogService, { provide: APP_INTERCEPTOR, useClass: OperationLogInterceptor }],
  exports: [OperationLogService],
})
export class OperationLogModule {}
```

- [ ] **Step 3: 注册到 AppModule**

打开 `apps/api/src/app.module.ts`：
1. 在 import 区（`import { AuditModule } from './audit/audit.module';` 一行附近）新增：

```ts
import { OperationLogModule } from './operation-log/operation-log.module';
```

2. 在 `@Module.imports` 数组里 `AuditModule,` 之后新增一行 `OperationLogModule,`。

- [ ] **Step 4: 补 .env 配置项**

打开 `apps/api/.env`，在末尾追加：

```bash
# ── 操作日志（OperationLog 全局拦截器）──
OPERATION_LOG_ENABLED=true
OPERATION_LOG_EXCLUDE=
OPERATION_LOG_BODY_MAX_KB=4
OPERATION_LOG_RETENTION_DAYS=180
```

- [ ] **Step 5: 构建 + 启动自检**

Run:
```bash
pnpm --filter api exec tsc --noEmit
```
Expected: 无类型错误（`prisma.operationLog`、`Prisma.OperationLogWhereInput`、`Prisma.InputJsonValue` 均可解析）。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/operation-log/operation-log.controller.ts apps/api/src/operation-log/operation-log.module.ts apps/api/src/app.module.ts apps/api/.env
git commit -m "feat(operation-log): 注册全局拦截器 + 查询 API（admin/bid_host）

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: e2e 验证

**Files:**
- Create: `apps/api/test/operation-log.e2e-spec.ts`

- [ ] **Step 1: 写 e2e**

创建 `apps/api/test/operation-log.e2e-spec.ts`（参照 `test/upload.e2e-spec.ts` 的 app 装配与 `loginAs` 模式）：

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

async function loginAs(app: INestApplication, username: string, password: string, portal: string): Promise<string[]> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .set('X-Portal', portal)
    .send({ username, password });
  const cookie = res.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie : cookie ? [cookie] : [];
}

describe('OperationLog (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let expertCookie: string[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    // 动态取一个 bid_expert 账号（口令统一 expert@2026，见 CLAUDE.md 种子表），避免硬编码姓名
    const expert = await prisma.user.findFirst({ where: { role: 'bid_expert', isActive: true } });
    expect(expert).not.toBeNull();
    expertCookie = await loginAs(app, expert!.username, 'expert@2026', 'expert');
  });

  afterAll(async () => {
    await app.close();
  });

  it('已认证请求被记录、body 已脱敏', async () => {
    // 触发一次会落库的请求（/auth/me 带 cookie）
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', expertCookie).set('X-Portal', 'expert').expect(200);

    // 等待 fire-and-forget 落库
    await new Promise((r) => setTimeout(r, 300));

    const found = await prisma.operationLog.findFirst({
      where: { path: '/api/auth/me', method: 'GET' },
      orderBy: { createdAt: 'desc' },
    });
    expect(found).not.toBeNull();
    expect(found!.role).toBe('bid_expert');
    expect(found!.portal).toBe('expert');
    expect(found!.statusCode).toBe(200);
  });

  it('login 请求 password 被脱敏', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('X-Portal', 'expert')
      .send({ username: '刘苡池', password: 'expert@2026' })
      .expect(200);
    await new Promise((r) => setTimeout(r, 300));

    const found = await prisma.operationLog.findFirst({
      where: { path: '/api/auth/login', method: 'POST' },
      orderBy: { createdAt: 'desc' },
    });
    expect(found).not.toBeNull();
    // body 里的 password 必须是 ***
    expect(JSON.stringify(found!.body)).not.toContain('expert@2026');
    expect(JSON.stringify(found!.body)).toContain('***');
    expect(found!.role).toBe('anonymous'); // login 时 req.user 尚不存在
  });

  it('/my 仅返回当前用户记录', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/operation-log/my?limit=5')
      .set('Cookie', expertCookie)
      .set('X-Portal', 'expert')
      .expect(200);
    expect(res.body.items).toBeInstanceOf(Array);
    expect(res.body.items.every((i: any) => i.userId !== null)).toBe(true);
  });

  it('/operation-log 全量接口对非 admin/bid_host 拒绝', async () => {
    await request(app.getHttpServer())
      .get('/api/operation-log?limit=5')
      .set('Cookie', expertCookie)
      .set('X-Portal', 'expert')
      .expect(403);
  });
});
```

- [ ] **Step 2: 运行 e2e**

Run:
```bash
pnpm --filter api test:e2e -- operation-log
```
Expected: 4 个用例 PASS。（`test:e2e` 带 `--forceExit`；需 PostgreSQL/Redis 在跑。）

- [ ] **Step 3: 运行全量单测确认无回归**

Run:
```bash
pnpm --filter api test
```
Expected: 全绿（含新单测 + 既有用例）。

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/operation-log.e2e-spec.ts
git commit -m "test(operation-log): e2e 覆盖落库/脱敏/权限

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## 完成判定

- 全部 8 个任务 checkbox 勾选；`pnpm --filter api test` 与 `pnpm --filter api test:e2e -- operation-log` 均绿。
- 手动验证：启动 `pnpm dev:api`，登录专家端打几个接口，用 `bid_host`（陈主任）调 `GET /api/operation-log?path=/api/auth/me` 能看到带 `body=***`、`role=bid_expert`、`portal=expert` 的记录。
- spec §1–§6 全部章节均有对应任务实现（见下 Self-Review）。
