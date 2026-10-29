# 系统健康页重设计 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 :3005 `/admin/health` 从「浅探活 + 无行动出口」改造成「巡检信号 + 排查工作台」：全量请求计数指标层、worker 心跳、组件实质指标、错误/慢接口 Top 榜（可下钻）、失败任务重试/清除。

**Architecture:** 新增全局 MetricsInterceptor（Redis 计数，与 OperationLog 并存补全量口径）+ worker 进程 Redis 心跳键；`system-config` 模块新增 `HealthAggregateService` 聚合读侧并挂三个新端点；前端整页重写（5 探活瓷片 + 手写 SVG 趋势图 + 两张排查表卡）。

**Tech Stack:** NestJS 11 + ioredis + BullMQ + Prisma（raw SQL）/ Next.js 16 + React 19（手写 SVG，零图表库依赖）。

**Spec:** `docs/superpowers/specs/2026-10-28-system-health-redesign-design.md`

## Global Constraints

- 界面文案遵守 2026-10-28 裁定：**禁英文/黑话/AI 感**（不出现 BullMQ、worker、INFO、hash 等）；组件产品名（PostgreSQL/Redis/MinIO）与指标标准名（P95，须带中文解释）保留。
- 指标写入一律 fire-and-forget（`.catch` 吞错），**绝不影响业务响应**。
- 无 Prisma 迁移；新增 Redis 键族：`sys:metrics:24h`、`sys:metrics:routes*`、`sys:aiworker:hb:*`。
- Redis 客户端注入令牌 `'REDIS_CLIENT'`（ioredis `Redis` 实例，`@Global` RedisModule 提供，app.module 已引入）。
- 读侧权限：`GET` 类 admin/leader；写操作（重试/清除）**仅 admin**。
- 本仓库 jest：单测 `*.spec.ts` 与源码同目录；e2e 在 `apps/api/test/`（`pnpm --filter api test -- <pattern>` / `pnpm --filter api test:e2e -- <pattern>`）。
- **并行会话在 `apps/web/src/app/(main)/admin/health/page.tsx` 有未提交的 12 行文案 diff**——Task 7 重写会覆盖之（用户已知情批准）；提交照例只 add 自己的文件。
- 新路由必须标注 `@Roles`/`@Public`/`@AnyRole` 之一（RolesGuard 默认拒绝铁律）。
- API 端口 4001，全局前缀 `api`；curl 调试须带 `X-Portal: web` 头。

---

### Task 1: 全量请求指标拦截器（MetricsInterceptor）

**Files:**
- Create: `apps/api/src/metrics/metrics-keys.util.ts`
- Create: `apps/api/src/metrics/metrics.interceptor.ts`
- Create: `apps/api/src/metrics/metrics.module.ts`
- Create: `apps/api/src/metrics/metrics-keys.util.spec.ts`
- Create: `apps/api/src/metrics/metrics.interceptor.spec.ts`
- Modify: `apps/api/src/app.module.ts`（imports 加 `MetricsModule`，紧挨 `OperationLogModule`）

**Interfaces:**
- Consumes: `'REDIS_CLIENT'`（ioredis，全局已有）
- Produces: `METRICS_KEYS`（含 `minutesHash`/`routesDay(day)`/`routesErrDay(day)`/`routesLastDay(day)`）、`minuteKey(d?)`、`dayKey(d?)`——Task 4 读侧直接 import；Redis 字段格式 `t:<yyyyMMddHHmm>` / `e:<yyyyMMddHHmm>` / `"METHOD /routePattern"`。

- [ ] **Step 1: 写键工具失败测试**

```ts
// apps/api/src/metrics/metrics-keys.util.spec.ts
import { dayKey, minuteKey } from './metrics-keys.util';

describe('metrics-keys', () => {
  it('minuteKey 补零到分钟（本地时间）', () => {
    expect(minuteKey(new Date(2026, 9, 28, 8, 5))).toBe('202610280805');
  });
  it('dayKey 是 minuteKey 前 8 位', () => {
    const d = new Date(2026, 9, 28, 8, 5);
    expect(dayKey(d)).toBe(minuteKey(d).slice(0, 8));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- metrics-keys`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现键工具**

```ts
// apps/api/src/metrics/metrics-keys.util.ts
/** 全量请求指标 Redis 键族（拦截器写侧 / health 读侧共用，键格式单一源） */
const pad = (n: number) => String(n).padStart(2, '0');

/** 本地时间 yyyyMMddHHmm（分钟桶字段名；写读两侧同函数，避免时区错位） */
export function minuteKey(d: Date = new Date()): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** 本地时间 yyyyMMdd（接口聚合按日滚动 key 用） */
export function dayKey(d: Date = new Date()): string {
  return minuteKey(d).slice(0, 8);
}

export const METRICS_KEYS = {
  minutesHash: 'sys:metrics:24h',                                    // field t:<min>/e:<min> → count
  routesDay: (day: string) => `sys:metrics:routes:${day}`,           // field "METHOD /path" → count
  routesErrDay: (day: string) => `sys:metrics:routes:err:${day}`,
  routesLastDay: (day: string) => `sys:metrics:routes:last:${day}`,  // field route → ISO（最近一次错误）
} as const;
```

- [ ] **Step 4: 跑键工具测试通过**

Run: `pnpm --filter api test -- metrics-keys`
Expected: PASS 2 项

- [ ] **Step 5: 写拦截器失败测试**

```ts
// apps/api/src/metrics/metrics.interceptor.spec.ts
import { of, throwError } from 'rxjs';
import { BadRequestException } from '@nestjs/common';
import { MetricsInterceptor } from './metrics.interceptor';
import { METRICS_KEYS, dayKey, minuteKey } from './metrics-keys.util';

/** 最小 redis mock：记录 hincrby/hset/expire 调用 */
function mkRedis() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const rec = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
    return Promise.resolve(1);
  };
  return {
    calls,
    hincrby: rec('hincrby'), hset: rec('hset'), expire: rec('expire'),
  } as any;
}

/** 最小 ExecutionContext mock */
function mkCtx(method: string, path: string, routePath?: string, statusCode = 200) {
  const req: any = { method, path, url: path, route: routePath ? { path: routePath } : undefined };
  const res = { statusCode };
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as any;
}

describe('MetricsInterceptor', () => {
  it('2xx 请求：分钟桶 + 当日接口计数，无错误族写入', (done) => {
    const redis = mkRedis();
    const i = new MetricsInterceptor(redis);
    i.intercept(mkCtx('GET', '/api/foo'), { handle: () => of('ok') }).subscribe({
      complete: () => {
        const inc = redis.calls.filter(c => c.op === 'hincrby');
        expect(inc.some(c => c.args[0] === METRICS_KEYS.minutesHash && String(c.args[1]).startsWith('t:'))).toBe(true);
        expect(inc.some(c => c.args[0] === METRICS_KEYS.routesDay(dayKey()) && c.args[1] === 'GET /api/foo')).toBe(true);
        expect(inc.some(c => String(c.args[1]).startsWith('e:'))).toBe(false);
        expect(redis.calls.some(c => c.op === 'hset')).toBe(false);
        done();
      },
    });
  });

  it('异常响应（HttpException）：错误分钟桶 + 错误接口计数 + 最近错误时间', (done) => {
    const redis = mkRedis();
    const i = new MetricsInterceptor(redis);
    const err = new BadRequestException('x');
    i.intercept(mkCtx('POST', '/api/bar'), { handle: () => throwError(() => err) }).subscribe({
      error: () => {
        const inc = redis.calls.filter(c => c.op === 'hincrby');
        expect(inc.some(c => c.args[0] === METRICS_KEYS.minutesHash && String(c.args[1]).startsWith('e:'))).toBe(true);
        expect(inc.some(c => c.args[0] === METRICS_KEYS.routesErrDay(dayKey()) && c.args[1] === 'POST /api/bar')).toBe(true);
        expect(redis.calls.some(c => c.op === 'hset' && c.args[0] === METRICS_KEYS.routesLastDay(dayKey()))).toBe(true);
        done();
      },
    });
  });

  it('路由归一：有 Express 路由模式时用模式而非原始路径（防 id 爆基数）', (done) => {
    const redis = mkRedis();
    const i = new MetricsInterceptor(redis);
    i.intercept(mkCtx('GET', '/api/announcements/clxxx123', '/api/announcements/:id'), { handle: () => of(1) }).subscribe({
      complete: () => {
        expect(redis.calls.some(c => c.op === 'hincrby' && c.args[1] === 'GET /api/announcements/:id')).toBe(true);
        done();
      },
    });
  });

  it('redis 写入失败被吞掉，不影响响应', (done) => {
    const redis: any = {
      hincrby: () => Promise.reject(new Error('down')),
      hset: () => Promise.reject(new Error('down')),
      expire: () => Promise.reject(new Error('down')),
    };
    const i = new MetricsInterceptor(redis);
    i.intercept(mkCtx('GET', '/api/foo'), { handle: () => of('ok') }).subscribe({
      complete: () => done(), // 能正常 complete 即未影响响应
      error: (e) => done(e as Error),
    });
  });
});
```

- [ ] **Step 6: 运行确认失败**

Run: `pnpm --filter api test -- metrics.interceptor`
Expected: FAIL（MetricsInterceptor 不存在）

- [ ] **Step 7: 实现拦截器 + 模块 + 注册**

```ts
// apps/api/src/metrics/metrics.interceptor.ts
import { CallHandler, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { catchError, Observable, tap, throwError } from 'rxjs';
import { Request } from 'express';
import Redis from 'ioredis';
import { dayKey, METRICS_KEYS, minuteKey } from './metrics-keys.util';

/** 全量请求指标拦截器：计数进 Redis，fire-and-forget，绝不阻塞/影响响应。
 *  与 OperationLog 拦截器并存——本层**无排除表**（轮询也计入），供「真实总量/错误趋势」；
 *  OperationLog 继续承担审计明细（含耗时，供 P95/慢接口）。 */
@Injectable()
export class MetricsInterceptor {
  private readonly logger = new Logger(MetricsInterceptor.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  /** 路由归一：优先 Express 路由模式（/api/x/:id），防参数爆基数；无路由回退 pathname */
  private routeField(req: Request): string {
    const routePath = (req as unknown as { route?: { path?: string } }).route?.path;
    const p = typeof routePath === 'string' && routePath ? routePath : (req.path || req.url).split('?')[0];
    return `${req.method} ${p}`;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType<string>() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<{ statusCode: number }>();

    const record = (statusCode: number) => {
      try {
        const now = new Date();
        const min = minuteKey(now);
        const day = dayKey(now);
        const route = this.routeField(req);
        const sw = (op: Promise<unknown>) => op.catch((e) => this.logger.warn(`metrics 写入失败: ${e?.message ?? e}`));
        sw(this.redis.hincrby(METRICS_KEYS.minutesHash, `t:${min}`, 1));
        sw(this.redis.hincrby(METRICS_KEYS.routesDay(day), route, 1));
        sw(this.redis.expire(METRICS_KEYS.minutesHash, 48 * 3600));
        sw(this.redis.expire(METRICS_KEYS.routesDay(day), 25 * 3600));
        if (statusCode >= 400) {
          sw(this.redis.hincrby(METRICS_KEYS.minutesHash, `e:${min}`, 1));
          sw(this.redis.hincrby(METRICS_KEYS.routesErrDay(day), route, 1));
          sw(this.redis.hset(METRICS_KEYS.routesLastDay(day), route, now.toISOString()));
          sw(this.redis.expire(METRICS_KEYS.routesErrDay(day), 25 * 3600));
          sw(this.redis.expire(METRICS_KEYS.routesLastDay(day), 25 * 3600));
        }
      } catch { /* 指标失败绝不影响响应 */ }
    };

    return next.handle().pipe(
      tap(() => record(res.statusCode)),
      catchError((err) => {
        record(typeof err?.getStatus === 'function' ? err.getStatus() : 500);
        return throwError(() => err);
      }),
    );
  }
}
```

```ts
// apps/api/src/metrics/metrics.module.ts
import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsInterceptor } from './metrics.interceptor';

/** 'REDIS_CLIENT' 由 @Global RedisModule（app.module 已引）提供，此处无需重复 import */
@Global()
@Module({
  providers: [{ provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
})
export class MetricsModule {}
```

`app.module.ts`：imports 数组中 `OperationLogModule,` 后加一行 `MetricsModule,`，顶部加 `import { MetricsModule } from './metrics/metrics.module';`。

- [ ] **Step 8: 跑全部 metrics 测试通过**

Run: `pnpm --filter api test -- metrics`
Expected: PASS（keys 2 + interceptor 4）

- [ ] **Step 9: 冒烟——dev API 自动重启后 Redis 出现计数**

Run: `sleep 3 && curl -s -o /dev/null -w '%{http_code}' -H 'X-Portal: web' http://localhost:4001/api/system-config/health; redis-cli -p 6380 keys 'sys:metrics*' | head -5`
Expected: 401/403（未登录正常）且 `sys:metrics:24h`、`sys:metrics:routes:*` 键出现（计数器已在工作；401/403 响应本身也被计入）。

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/metrics apps/api/src/app.module.ts
git commit -m "feat(metrics): 全量请求指标拦截器——Redis 分钟桶+按日接口计数，无排除表补 OperationLog 口径缺口"
```

---

### Task 2: worker 心跳（写侧 + 读侧工具）

**Files:**
- Modify: `apps/api/src/ai-bid-analysis-worker.ts`
- Create: `apps/api/src/metrics/worker-heartbeat.util.ts`
- Create: `apps/api/src/metrics/worker-heartbeat.util.spec.ts`

**Interfaces:**
- Consumes: `'REDIS_CLIENT'`（`AiBidAnalysisWorkerModule` 已 import RedisModule，可用 `app.get('REDIS_CLIENT', { strict: false })` 取）
- Produces: `WORKER_HB_PREFIX = 'sys:aiworker:hb:'`、`readWorkerHeartbeat(redis): Promise<{ alive: boolean; count: number; lastBeatAgoSec: number | null }>`——Task 4 消费。

- [ ] **Step 1: 写读侧失败测试**

```ts
// apps/api/src/metrics/worker-heartbeat.util.spec.ts
import { readWorkerHeartbeat } from './worker-heartbeat.util';

describe('readWorkerHeartbeat', () => {
  it('无键 → 未运行', async () => {
    const redis: any = { scan: async () => ['0', []], mget: async () => [] };
    expect(await readWorkerHeartbeat(redis)).toEqual({ alive: false, count: 0, lastBeatAgoSec: null });
  });
  it('两副本 → alive、count=2、lastBeatAgoSec 取最新心跳', async () => {
    const t1 = new Date(Date.now() - 70_000).toISOString(); // 70s 前
    const t2 = new Date(Date.now() - 10_000).toISOString(); // 10s 前（最新）
    let first = true;
    const redis: any = {
      scan: async () => (first ? ((first = false), ['9', ['hb:1', 'hb:2']]) : ['0', []]),
      mget: async (...keys: string[]) => (keys.length === 2 ? [t1, t2] : []),
    };
    const r = await readWorkerHeartbeat(redis);
    expect(r.alive).toBe(true);
    expect(r.count).toBe(2);
    expect(r.lastBeatAgoSec).toBeGreaterThanOrEqual(9);
    expect(r.lastBeatAgoSec).toBeLessThanOrEqual(12);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- worker-heartbeat`
Expected: FAIL

- [ ] **Step 3: 实现读侧工具**

```ts
// apps/api/src/metrics/worker-heartbeat.util.ts
import Redis from 'ioredis';

export const WORKER_HB_PREFIX = 'sys:aiworker:hb:';

export type WorkerHeartbeat = { alive: boolean; count: number; lastBeatAgoSec: number | null };

/** SCAN 心跳键（TTL 90s，过期自动消失）→ 存活副本数 + 最新心跳距今秒数 */
export async function readWorkerHeartbeat(redis: Redis): Promise<WorkerHeartbeat> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${WORKER_HB_PREFIX}*`, 'COUNT', 100);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  if (keys.length === 0) return { alive: false, count: 0, lastBeatAgoSec: null };
  const values = await redis.mget(...keys);
  let newest = 0;
  for (const v of values) {
    const t = v ? Date.parse(v) : NaN;
    if (!Number.isNaN(t) && t > newest) newest = t;
  }
  return {
    alive: newest > 0,
    count: keys.length,
    lastBeatAgoSec: newest > 0 ? Math.max(0, Math.round((Date.now() - newest) / 1000)) : null,
  };
}
```

- [ ] **Step 4: 跑测试通过**

Run: `pnpm --filter api test -- worker-heartbeat`
Expected: PASS 2 项

- [ ] **Step 5: worker 入口写心跳**

`apps/api/src/ai-bid-analysis-worker.ts` 的 `bootstrap()` 内，`logger.log('AI 投标分析 worker 已启动…')` 之后插入；两个 shutdown handler 里 `await app.close();` 之前各加清理行。改动后的关键片段：

```ts
import Redis from 'ioredis'; // ← 顶部新增

  // …… app 创建之后：
  logger.log('AI 投标分析 worker 已启动（消费 tender/bidder 队列）');

  // 心跳（30s，TTL 90s）：health 端点读 sys:aiworker:hb:* 判「分析服务运行中」
  const redis = app.get('REDIS_CLIENT', { strict: false }) as Redis;
  const HB_KEY = `sys:aiworker:hb:${process.pid}`;
  const beat = () => redis.set(HB_KEY, new Date().toISOString(), 'EX', 90).catch(() => undefined);
  void beat();
  const hbTimer = setInterval(beat, 30_000);
  hbTimer.unref?.();
  const shutdown = async (sig: string) => {
    logger.log(`${sig} received, closing worker...`);
    clearInterval(hbTimer);
    await redis.del(HB_KEY).catch(() => undefined);
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  //（原两个独立 process.on 块删除，替换为以上统一 shutdown）
```

- [ ] **Step 6: tsc 通过**

Run: `cd apps/api && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/metrics/worker-heartbeat.util.ts apps/api/src/metrics/worker-heartbeat.util.spec.ts apps/api/src/ai-bid-analysis-worker.ts
git commit -m "feat(metrics): AI 分析 worker 心跳——30s Redis 键（TTL 90s）+ 读侧解析工具"
```

---

### Task 3: OcrService 逐副本探活

**Files:**
- Modify: `apps/api/src/local-ai/ocr.service.ts`（`isAvailable()` 方法后新增 `probeReplicas()`）
- Create: `apps/api/src/local-ai/ocr.service.probe.spec.ts`

**Interfaces:**
- Produces: `OcrService.probeReplicas(): Promise<Array<{ url: string; ok: boolean; latencyMs: number }>>`——Task 4 消费。

- [ ] **Step 1: 写失败测试**

```ts
// apps/api/src/local-ai/ocr.service.probe.spec.ts
import { OcrService } from './ocr.service';

function mkService(urls: string) {
  return new OcrService({ get: () => urls } as any);
}

describe('OcrService.probeReplicas', () => {
  it('逐副本返回可用性与延迟；失败副本 ok=false', async () => {
    const svc = mkService('http://a:8100,http://b:8100');
    const spy = jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).startsWith('http://a')) return { ok: true } as any;
      throw new Error('down');
    });
    const r = await svc.probeReplicas();
    spy.mockRestore();
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ url: 'http://a:8100', ok: true });
    expect(r[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(r[1]).toMatchObject({ url: 'http://b:8100', ok: false });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- ocr.service.probe`
Expected: FAIL（probeReplicas 不存在）

- [ ] **Step 3: 实现（ocr.service.ts 的 isAvailable 后）**

```ts
  /** 逐副本 healthz 探活（系统健康页用）：每副本可用性与延迟 */
  async probeReplicas(): Promise<Array<{ url: string; ok: boolean; latencyMs: number }>> {
    return Promise.all(this.baseUrls.map(async (base) => {
      const t0 = Date.now();
      try {
        const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
        return { url: base, ok: res.ok, latencyMs: Date.now() - t0 };
      } catch {
        return { url: base, ok: false, latencyMs: Date.now() - t0 };
      }
    }));
  }
```

- [ ] **Step 4: 跑测试通过**

Run: `pnpm --filter api test -- ocr.service.probe`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/local-ai/ocr.service.ts apps/api/src/local-ai/ocr.service.probe.spec.ts
git commit -m "feat(ocr): OcrService 逐副本探活 probeReplicas——系统健康页多副本状态"
```

---

### Task 4: HealthAggregateService + health 端点扩展

**Files:**
- Create: `apps/api/src/system-config/health-aggregate.service.ts`
- Create: `apps/api/src/system-config/health-aggregate.service.spec.ts`
- Modify: `apps/api/src/system-config/system-config.controller.ts`（health() 改为委托；队列 @InjectQueue 移入 service；新增三个端点见 Task 5）
- Modify: `apps/api/src/system-config/system-config.module.ts`（providers 加 HealthAggregateService）

**Interfaces:**
- Consumes: `PrismaService`、`StorageService.ensureBucket()`、`OcrService.probeReplicas()`、`'REDIS_CLIENT'`、`@InjectQueue(QUEUE_NAMES.TENDER_PROCESSING/BIDDER_PROCESSING)`、`readWorkerHeartbeat`（Task 2）、`METRICS_KEYS/minuteKey`（Task 1）
- Produces: `HealthAggregateService.read(): Promise<HealthReport>`；类型 `HealthReport`/`QueueSnapshot`（导出，前端 Task 7 镜像）。`HealthReport` 形状见 spec 与下方实现。

- [ ] **Step 1: 写聚合服务失败测试**

```ts
// apps/api/src/system-config/health-aggregate.service.spec.ts
import { HealthAggregateService } from './health-aggregate.service';
import { METRICS_KEYS, minuteKey } from '../metrics/metrics-keys.util';

function minuteField(d: Date, kind: 't' | 'e') { return `${kind}:${minuteKey(d)}`; }

/** 构造 24h 内外的分钟字段混合，验证窗口过滤与小时聚合 */
function mkMinutesHash() {
  const now = new Date();
  const h1 = new Date(now.getTime() - 60 * 60 * 1000);
  const h2 = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const stale = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 窗口外，应忽略
  return {
    [minuteField(now, 't')]: '5', [minuteField(now, 'e')]: '1',
    [minuteField(h1, 't')]: '10', [minuteField(h2, 't')]: '20', [minuteField(h2, 'e')]: '2',
    [minuteField(stale, 't')]: '999',
  };
}

/** 聚合服务工厂：六个依赖位均可覆盖（Task 5 的队列/日志操作测试复用） */
function mkSvc(over: { prisma?: any; redis?: any; storage?: any; ocr?: any; tender?: any; bidder?: any } = {}) {
  const prisma: any = over.prisma ?? {
    $queryRaw: jest.fn().mockResolvedValue([
      { activeConns: 3, maxConns: 200, sizeBytes: 1234567890n },
    ]),
    operationLog: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const redis: any = over.redis ?? {
    ping: async () => 'PONG',
    info: async () => '# Memory\r\nused_memory:1048576\r\n# Clients\r\nconnected_clients:8\r\n# Server\r\nuptime_in_seconds:3600\r\n',
    hgetall: jest.fn().mockImplementation(async (key: string) => {
      if (key === METRICS_KEYS.minutesHash) return mkMinutesHash();
      if (key.startsWith('sys:metrics:routes:err:')) return { 'GET /api/x': '7', 'POST /api/y': '3' };
      if (key.startsWith('sys:metrics:routes:last:')) return { 'GET /api/x': new Date().toISOString() };
      return {};
    }),
    scan: async () => ['0', []],
    mget: async () => [],
  };
  const storage: any = over.storage ?? { ensureBucket: async () => undefined };
  const ocr: any = over.ocr ?? { probeReplicas: async () => [{ url: 'http://localhost:8100', ok: true, latencyMs: 2 }] };
  const mkQueue = () => ({
    getJobCounts: async () => ({ waiting: 1, active: 0, failed: 2 }),
    getJobs: jest.fn().mockImplementation(async (type: string) =>
      type === 'completed' ? [{ finishedOn: Date.now() - 5000 }]
        : [{ id: 'j1', name: 'tender:1', failedReason: 'LLM 超时'.repeat(80), finishedOn: Date.now() - 1000, attemptsMade: 2 }]),
  });
  return new HealthAggregateService(prisma, redis, storage, ocr, over.tender ?? mkQueue(), over.bidder ?? mkQueue());
}

describe('HealthAggregateService.read', () => {
  it('聚合形状：组件实质指标 + 全量口径 api24h（窗口过滤）+ 小时序列 + Top 榜 + 队列快照 + worker', async () => {
    const r = await mkSvc().read();
    expect(r.components.db).toMatchObject({ activeConns: 3, maxConns: 200 });
    expect(r.components.redis).toMatchObject({ usedMemoryBytes: 1048576, clients: 8, uptimeSec: 3600 });
    expect(r.components.ocr).toMatchObject({ upCount: 1, total: 1 });
    // 窗口外 999 被忽略：total = 5+10+20 = 35，errors = 1+2 = 3
    expect(r.api24h.total).toBe(35);
    expect(r.api24h.errors).toBe(3);
    expect(r.api24h.series).toHaveLength(24);           // 恒 24 个小时点（含补零）
    expect(r.topErrors[0]).toMatchObject({ method: 'GET', route: '/api/x', count: 7 });
    expect(r.topErrors[0].lastAt).toBeTruthy();
    expect(r.queues.tenderProcessing).toMatchObject({ waiting: 1, failed: 2 });
    expect(r.queues.tenderProcessing!.failedJobs[0].failedReason.length).toBeLessThanOrEqual(300);
    expect(r.queues.tenderProcessing!.lastFinishedAt).toBeTruthy();
    expect(r.worker).toEqual({ alive: false, count: 0, lastBeatAgoSec: null });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- health-aggregate`
Expected: FAIL

- [ ] **Step 3: 实现聚合服务**

```ts
// apps/api/src/system-config/health-aggregate.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OcrService } from '../local-ai/ocr.service';
import { QUEUE_NAMES } from '../ai-bid-analysis/queues/queue.module';
import { dayKey, METRICS_KEYS, minuteKey } from '../metrics/metrics-keys.util';
import { readWorkerHeartbeat } from '../metrics/worker-heartbeat.util';

export type QueueSnapshot = {
  waiting: number; active: number; failed: number;
  lastFinishedAt: string | null;
  failedJobs: Array<{ id: string; name: string; failedReason: string; failedAt: string | null; attempts: number }>;
};

export type HealthReport = {
  checkedAt: string;
  components: {
    db: { ok: boolean; latencyMs: number; error?: string; activeConns: number; maxConns: number; sizeBytes: number };
    redis: { ok: boolean; latencyMs: number; error?: string; usedMemoryBytes: number; clients: number; uptimeSec: number };
    minio: { ok: boolean; latencyMs: number; error?: string };
    ocr: { ok: boolean; upCount: number; total: number; replicas: Array<{ url: string; ok: boolean; latencyMs: number }> };
  };
  api24h: { total: number; errors: number; errorRate: number; p95ms: number; series: Array<{ hour: string; total: number; errors: number }> };
  topErrors: Array<{ method: string; route: string; count: number; lastAt: string | null }>;
  topSlow: Array<{ method: string; path: string; count: number; p95ms: number; maxMs: number }>;
  queues: { tenderProcessing: QueueSnapshot | null; bidderProcessing: QueueSnapshot | null };
  worker: { alive: boolean; count: number; lastBeatAgoSec: number | null };
};

const pad = (n: number) => String(n).padStart(2, '0');

@Injectable()
export class HealthAggregateService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
    @InjectQueue(QUEUE_NAMES.TENDER_PROCESSING) private readonly tenderQueue: Queue,
    @InjectQueue(QUEUE_NAMES.BIDDER_PROCESSING) private readonly bidderQueue: Queue,
  ) {}

  private async timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; latencyMs: number; error?: string; value?: T }> {
    const t0 = Date.now();
    try { const value = await fn(); return { ok: true, latencyMs: Date.now() - t0, value }; }
    catch (e) { return { ok: false, latencyMs: Date.now() - t0, error: (e as Error).message }; }
  }

  /** Redis INFO 文本 → 行解析 */
  private static infoLine(info: string, key: string): number {
    const m = info.match(new RegExp(`^${key}:(.*)$`, 'm'));
    return m ? Number(m[1].trim()) || 0 : 0;
  }

  private async apiMetrics() {
    const hash = await this.redis.hgetall(METRICS_KEYS.minutesHash).catch(() => ({} as Record<string, string>));
    const windowStart = minuteKey(new Date(Date.now() - 24 * 3600 * 1000));
    let total = 0, errors = 0;
    const perHour = new Map<string, { total: number; errors: number }>();
    for (const [field, count] of Object.entries(hash)) {
      const kind = field.slice(0, 1);            // 't' | 'e'
      const min = field.slice(2);                // yyyyMMddHHmm
      if (min < windowStart) continue;           // 窗口外忽略（同长数字串字典序=时间序）
      const n = Number(count) || 0;
      if (kind === 't') total += n; else errors += n;
      const hour = min.slice(0, 10);             // yyyyMMddHH
      const bucket = perHour.get(hour) ?? { total: 0, errors: 0 };
      if (kind === 't') bucket.total += n; else bucket.errors += n;
      perHour.set(hour, bucket);
    }
    // 补齐最近 24 个小时点（含零值小时），旧→新
    const series: HealthReport['api24h']['series'] = [];
    const now = new Date();
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600 * 1000);
      const hour = minuteKey(d).slice(0, 10);
      const b = perHour.get(hour) ?? { total: 0, errors: 0 };
      series.push({ hour: `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`, total: b.total, errors: b.errors });
    }
    // P95：OperationLog 口径（排除高频轮询，如实标注）
    const p95 = await this.prisma.$queryRaw<Array<{ p95ms: number>>`
      SELECT COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs"), 0)::int AS "p95ms"
      FROM "OperationLog" WHERE "createdAt" > now() - interval '24 hours'`.catch(() => [{ p95ms: 0 }]);
    return { total, errors, errorRate: total > 0 ? Math.round((errors / total) * 10000) / 100 : 0, p95ms: p95[0]?.p95ms ?? 0, series };
  }

  private async topErrors() {
    const day = dayKey();
    const [errCounts, lastAt] = await Promise.all([
      this.redis.hgetall(METRICS_KEYS.routesErrDay(day)).catch(() => ({} as Record<string, string>)),
      this.redis.hgetall(METRICS_KEYS.routesLastDay(day)).catch(() => ({} as Record<string, string>)),
    ]);
    return Object.entries(errCounts)
      .map(([field, count]) => {
        const sp = field.indexOf(' ');
        return { method: field.slice(0, sp), route: field.slice(sp + 1), count: Number(count) || 0, lastAt: lastAt[field] ?? null };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }

  private async topSlow() {
    return this.prisma.$queryRaw<HealthReport['topSlow']>`
      SELECT "method", "path", COUNT(*)::int AS "count",
             COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs"), 0)::int AS "p95ms",
             MAX("durationMs")::int AS "maxMs"
      FROM "OperationLog" WHERE "createdAt" > now() - interval '24 hours'
      GROUP BY "method", "path" ORDER BY "p95ms" DESC LIMIT 8`.catch(() => []);
  }

  private async queueSnapshot(q: Queue): Promise<QueueSnapshot | null> {
    try {
      const counts = await q.getJobCounts('waiting', 'active', 'failed');
      const completed = await q.getJobs('completed', 0, 4);
      const failed = await q.getJobs('failed', 0, 9);
      const lastFinishedMs = Math.max(0, ...completed.map((j) => j.finishedOn ?? 0));
      return {
        waiting: counts.waiting ?? 0, active: counts.active ?? 0, failed: counts.failed ?? 0,
        lastFinishedAt: lastFinishedMs > 0 ? new Date(lastFinishedMs).toISOString() : null,
        failedJobs: failed.map((j) => ({
          id: String(j.id), name: j.name ?? '',
          failedReason: (j.failedReason ?? '').slice(0, 300),
          failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
          attempts: j.attemptsMade ?? 0,
        })),
      };
    } catch { return null; }
  }

  async read(): Promise<HealthReport> {
    const [dbP, redisP, minioP, replicas, api, errs, slow, tender, bidder, worker] = await Promise.all([
      this.timed(() => this.prisma.$queryRaw<Array<{ activeConns: number; maxConns: number; sizeBytes: bigint }>>`
        SELECT (SELECT numbackends::int FROM pg_stat_database WHERE datname = current_database()) AS "activeConns",
               (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS "maxConns",
               pg_database_size(current_database())::bigint AS "sizeBytes"`),
      this.timed(() => this.redis.ping().then(() => this.redis.info())),
      this.timed(() => this.storage.ensureBucket()),
      this.ocr.probeReplicas().catch(() => [] as Array<{ url: string; ok: boolean; latencyMs: number }>),
      this.apiMetrics(), this.topErrors(), this.topSlow(),
      this.queueSnapshot(this.tenderQueue), this.queueSnapshot(this.bidderQueue),
      readWorkerHeartbeat(this.redis).catch(() => ({ alive: false, count: 0, lastBeatAgoSec: null })),
    ]);
    const dbStats = dbP.value?.[0];
    const info = redisP.value ?? '';
    return {
      checkedAt: new Date().toISOString(),
      components: {
        db: {
          ok: dbP.ok, latencyMs: dbP.latencyMs, error: dbP.error,
          activeConns: dbStats?.activeConns ?? 0, maxConns: dbStats?.maxConns ?? 0,
          sizeBytes: Number(dbStats?.sizeBytes ?? 0),
        },
        redis: {
          ok: redisP.ok, latencyMs: redisP.latencyMs, error: redisP.error,
          usedMemoryBytes: HealthAggregateService.infoLine(info, 'used_memory'),
          clients: HealthAggregateService.infoLine(info, 'connected_clients'),
          uptimeSec: HealthAggregateService.infoLine(info, 'uptime_in_seconds'),
        },
        minio: { ok: minioP.ok, latencyMs: minioP.latencyMs, error: minioP.error },
        ocr: {
          ok: replicas.some((r) => r.ok), upCount: replicas.filter((r) => r.ok).length,
          total: replicas.length, replicas,
        },
      },
      api24h: api,
      topErrors: errs,
      topSlow: slow,
      queues: { tenderProcessing: tender, bidderProcessing: bidder },
      worker,
    };
  }
}
```

- [ ] **Step 4: 跑聚合测试通过**

Run: `pnpm --filter api test -- health-aggregate`
Expected: PASS（注意 spec 中 mkSvc 的 hgetall mock 须按实现的真实键序匹配——若实现先查 errDay 再查 lastDay，mock 已覆盖两种前缀）

- [ ] **Step 5: 接线 controller + module**

`system-config.module.ts` providers 改为 `[SystemConfigService, HealthAggregateService]`。
`system-config.controller.ts`：构造函数注入 `private readonly healthService: HealthAggregateService`，删除原 `health()` 方法体与 `@InjectQueue`/`Queue`/`PrismaService`/`StorageService`/`OcrService` 相关 import（它们移入 service；PrismaService 若其他方法还用则保留 import），`health()` 变为：

```ts
  /** 系统健康：组件实质指标 + 全量 24h 接口口径 + Top 榜 + 队列快照 + 分析服务心跳 */
  @Get('health')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '系统健康聚合读' })
  async health() {
    return this.healthService.read();
  }
```

- [ ] **Step 6: tsc + 全模块单测**

Run: `cd apps/api && npx tsc --noEmit && cd .. && pnpm --filter api test -- system-config`
Expected: 通过（system-config 相关既有测试不回归）

- [ ] **Step 7: 冒烟**

Run: `curl -s -H 'X-Portal: web' -H "Cookie: $(curl -s -c - -H 'X-Portal: web' -H 'Content-Type: application/json' -d '{"username":"Swhi-CGZX-admin","password":"Swhi-CGZX-admin@2026"}' http://localhost:4001/api/auth/login | grep token_web | awk '{print $6"="$7}')" http://localhost:4001/api/system-config/health | head -c 600`
Expected: JSON 含 `"components":{"db":{..."activeConns"`、`"series":[`、`"worker":{`

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/system-config
git commit -m "feat(system-config): health 端点聚合升级——组件实质指标/全量24h口径/Top榜/队列快照/心跳"
```

---

### Task 5: 队列操作端点 + 最近错误端点

**Files:**
- Modify: `apps/api/src/system-config/health-aggregate.service.ts`（追加三个方法）
- Modify: `apps/api/src/system-config/health-aggregate.service.spec.ts`（追加用例）
- Modify: `apps/api/src/system-config/system-config.controller.ts`（追加三个路由）

**Interfaces:**
- Produces: `GET /api/system-config/recent-errors?limit=`（admin/leader）、`POST /api/system-config/queue/:name/retry-failed`（admin）、`POST /api/system-config/queue/:name/clear-failed`（admin）；`:name` ∈ `tender` | `bidder`。

- [ ] **Step 1: 写失败测试（追加到 spec）**

```ts
  it('retryFailed：单次至多 500、逐 job retry、失败计入 skipped；未知队列名抛 400', async () => {
    const retried: string[] = [];
    const queue: any = {
      getJobs: async () =>
        Array.from({ length: 3 }, (_, i) => ({ id: `j${i}`, retry: async () => { retried.push(`j${i}`); } })),
    };
    const svc = mkSvc({ tender: queue });
    const r = await svc.retryFailed('tender');
    expect(r).toEqual({ retried: 3, skipped: 0 });
    await expect(svc.retryFailed('nope')).rejects.toThrow();
  });

  it('clearFailed：clean 全部 failed 并返回数量', async () => {
    const queue: any = { clean: async () => ['a', 'b', 'c'] };
    const svc = mkSvc({ tender: queue });
    expect(await svc.clearFailed('tender')).toEqual({ cleaned: 3 });
  });

  it('recentErrors：只取 ≥400、按时间倒序、limit 钳制 1..100', async () => {
    const rows = [{ method: 'GET', path: '/api/x', statusCode: 500, durationMs: 10, createdAt: new Date() }];
    const prisma: any = { operationLog: { findMany: jest.fn().mockResolvedValue(rows) }, $queryRaw: jest.fn().mockResolvedValue([]) };
    const svc = mkSvc({ prisma });
    const r = await svc.recentErrors(500);
    expect(r).toEqual(rows);
    const arg = (prisma.operationLog.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.take).toBe(100);
    expect(arg.where.statusCode.gte).toBe(400);
  });
```

（直接复用 Task 4 的 `mkSvc(over)` 工厂——六个依赖位均可覆盖。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter api test -- health-aggregate`
Expected: 新增 3 用例 FAIL

- [ ] **Step 3: 实现（service 追加）**

```ts
  /** 队列名白名单（防任意队列名注入） */
  private queueByName(name: string): Queue {
    if (name === 'tender') return this.tenderQueue;
    if (name === 'bidder') return this.bidderQueue;
    throw new BadRequestException({ error: '未知队列', code: 'UNKNOWN_QUEUE' });
  }

  /** 重试失败任务：单次至多最新 500 个；重试失败计入 skipped */
  async retryFailed(name: string): Promise<{ retried: number; skipped: number }> {
    const q = this.queueByName(name);
    const jobs = await q.getJobs('failed', 0, 499);
    let retried = 0, skipped = 0;
    for (const j of jobs) {
      try { await j.retry(); retried++; } catch { skipped++; }
    }
    return { retried, skipped };
  }

  /** 清除失败记录（不可恢复——前端确认弹窗警示） */
  async clearFailed(name: string): Promise<{ cleaned: number }> {
    const q = this.queueByName(name);
    const cleaned = await q.clean(0, 10_000, 'failed');
    return { cleaned: cleaned.length };
  }

  /** 最近错误样例（OperationLog ≥400，倒序） */
  async recentErrors(limit = 20) {
    const take = Math.min(100, Math.max(1, limit));
    return this.prisma.operationLog.findMany({
      where: { statusCode: { gte: 400 }, createdAt: { gt: new Date(Date.now() - 24 * 3600 * 1000) } },
      orderBy: { createdAt: 'desc' },
      take,
      select: { method: true, path: true, statusCode: true, durationMs: true, createdAt: true, ipAddress: true },
    });
  }
```

（`BadRequestException` 从 `@nestjs/common` 补 import。）

- [ ] **Step 4: controller 追加路由**

```ts
  @Get('recent-errors')
  @Roles('admin', 'leader')
  @ApiOperation({ summary: '最近 24h 错误样例（下钻）' })
  async recentErrors(@Query('limit') limit?: string) {
    return this.healthService.recentErrors(limit ? Number(limit) : 20);
  }

  @Post('queue/:name/retry-failed')
  @Roles('admin')
  @ApiOperation({ summary: '重试失败的分析任务（≤500）' })
  async retryFailed(@Param('name') name: string) {
    return this.healthService.retryFailed(name);
  }

  @Post('queue/:name/clear-failed')
  @Roles('admin')
  @ApiOperation({ summary: '清除失败记录（不可恢复）' })
  async clearFailed(@Param('name') name: string) {
    return this.healthService.clearFailed(name);
  }
```

（`Post`/`Query`/`Param` 补 import。）

- [ ] **Step 5: 全部聚合测试通过 + tsc**

Run: `pnpm --filter api test -- health-aggregate && cd apps/api && npx tsc --noEmit`
Expected: PASS / 无错误

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/system-config
git commit -m "feat(system-config): 队列重试/清除（admin）+ 最近错误样例端点——健康页排查行动出口"
```

---

### Task 6: e2e 契约测试

**Files:**
- Create: `apps/api/test/system-health.e2e-spec.ts`

- [ ] **Step 1: 写 e2e**

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';

async function loginAs(app: INestApplication, username: string, password: string, portal: string): Promise<string[]> {
  const res = await request(app.getHttpServer()).post('/api/auth/login').set('X-Portal', portal).send({ username, password });
  const cookie = res.headers['set-cookie'];
  return Array.isArray(cookie) ? cookie : cookie ? [cookie] : [];
}

describe('System Health (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string[];
  let leaderCookie: string[];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    adminCookie = await loginAs(app, 'Swhi-CGZX-admin', 'Swhi-CGZX-admin@2026', 'web');
    leaderCookie = await loginAs(app, 'Swhi-CGZX-01', 'Swhi-CGZX-01@2026', 'web');
  });

  afterAll(async () => { await app.close(); });

  it('admin 读 health：返回形状契约（组件实质指标/全量口径/Top 榜/队列快照/心跳）', async () => {
    const res = await request(app.getHttpServer()).get('/api/system-config/health').set('X-Portal', 'web').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.components.db).toEqual(expect.objectContaining({ activeConns: expect.any(Number), maxConns: expect.any(Number), sizeBytes: expect.any(Number) }));
    expect(res.body.components.redis.usedMemoryBytes).toEqual(expect.any(Number));
    expect(Array.isArray(res.body.api24h.series)).toBe(true);
    expect(res.body.api24h.series).toHaveLength(24);
    expect(Array.isArray(res.body.topErrors)).toBe(true);
    expect(Array.isArray(res.body.topSlow)).toBe(true);
    expect(res.body.queues).toHaveProperty('tenderProcessing');
    expect(res.body.worker).toEqual(expect.objectContaining({ alive: expect.any(Boolean) }));
  });

  it('指标层在计数：两次 health 调用后 total 至少 +1（health 路由自身被计入全量）', async () => {
    const t1 = (await request(app.getHttpServer()).get('/api/system-config/health').set('X-Portal', 'web').set('Cookie', adminCookie)).body.api24h.total;
    const t2 = (await request(app.getHttpServer()).get('/api/system-config/health').set('X-Portal', 'web').set('Cookie', adminCookie)).body.api24h.total;
    expect(t2).toBeGreaterThanOrEqual(t1 + 1);
  });

  it('leader 可读 health 与 recent-errors，但写操作 403', async () => {
    const h = await request(app.getHttpServer()).get('/api/system-config/health').set('X-Portal', 'web').set('Cookie', leaderCookie);
    expect(h.status).toBe(200);
    const re = await request(app.getHttpServer()).get('/api/system-config/recent-errors').set('X-Portal', 'web').set('Cookie', leaderCookie);
    expect(re.status).toBe(200);
    const retry = await request(app.getHttpServer()).post('/api/system-config/queue/tender/retry-failed').set('X-Portal', 'web').set('Cookie', leaderCookie);
    expect(retry.status).toBe(403);
  });

  it('未知队列名 400', async () => {
    const res = await request(app.getHttpServer()).post('/api/system-config/queue/nope/retry-failed').set('X-Portal', 'web').set('Cookie', adminCookie);
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 运行 e2e**

Run: `pnpm --filter api test:e2e -- system-health`
Expected: 4 项 PASS（注意 e2e 需基础设施 PG/Redis/MinIO 在跑，与既有 e2e 同前置）

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/system-health.e2e-spec.ts
git commit -m "test(e2e): 系统健康契约——形状/计数自增/leader 只读 403/未知队列 400"
```

---

### Task 7: 前端页面重写

**Files:**
- Modify: `apps/web/src/app/(main)/admin/health/page.tsx`（整页重写，覆盖并行会话 12 行文案 diff——措辞意图已吸收）

**Interfaces:**
- Consumes: `GET /api/system-config/health`（`HealthReport` 形状，Task 4）、`GET /api/system-config/recent-errors?limit=20`、`POST /api/system-config/queue/{tender|bidder}/{retry-failed|clear-failed}`、`fetchCurrentUser()`（`apps/web/src/lib/api/auth.ts:180`）、`Modal`/`TableSkeleton`/`AlertBanner`（`@/components/workbench`）
- 执行本任务前 **REQUIRED SUB-SKILL: 调用 `dataviz` skill**（趋势图属图表代码，先读再写）。

**文案约束（2026-10-28 裁定）**：中文口语化——「分析服务」（不写 worker）、「任务队列」（不写 BullMQ）、「内存占用/连接数」（不写 INFO/hash）。P95 保留但带解释。

- [ ] **Step 1: 重写页面**

完整代码（一处不落）：

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Cpu, Database, HardDrive, RefreshCw, ScanText, Server } from 'lucide-react';
import { apiFetch } from '@/lib/api/api-fetch';
import { fetchCurrentUser } from '@/lib/api/auth';
import { Modal, TableSkeleton } from '@/components/workbench';

/* ═══════════════════════════════════════════════════════════════
   系统健康——巡检 + 排查工作台（2026-10-28 重设计）
   上：组件实质指标 + 分析服务心跳；中：24 小时请求/错误趋势；
   下：错误与慢接口榜（可下钻样例）、分析任务队列（失败可操作）
   ═══════════════════════════════════════════════════════════════ */

type Probe = { ok: boolean; latencyMs: number; error?: string };
type HealthReport = {
  checkedAt: string;
  components: {
    db: Probe & { activeConns: number; maxConns: number; sizeBytes: number };
    redis: Probe & { usedMemoryBytes: number; clients: number; uptimeSec: number };
    minio: Probe;
    ocr: { ok: boolean; upCount: number; total: number; replicas: Array<{ url: string; ok: boolean; latencyMs: number }> };
  };
  api24h: { total: number; errors: number; errorRate: number; p95ms: number; series: Array<{ hour: string; total: number; errors: number }> };
  topErrors: Array<{ method: string; route: string; count: number; lastAt: string | null }>;
  topSlow: Array<{ method: string; path: string; count: number; p95ms: number; maxMs: number }>;
  queues: Record<'tenderProcessing' | 'bidderProcessing', {
    waiting: number; active: number; failed: number; lastFinishedAt: string | null;
    failedJobs: Array<{ id: string; name: string; failedReason: string; failedAt: string | null; attempts: number }>;
  } | null>;
  worker: { alive: boolean; count: number; lastBeatAgoSec: number | null };
};
type RecentError = { method: string; path: string; statusCode: number; durationMs: number; createdAt: string; ipAddress: string | null };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/system-config${path}`, {
    ...init, credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Portal': 'web', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `请求失败（${res.status}）`);
  }
  return res.json();
}

const fmtBytes = (n: number): string =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(0)} MB` : `${(n / 1024).toFixed(0)} KB`;
const fmtAgo = (iso: string | null): string =>
  !iso ? '—' : `${Math.round((Date.now() - Date.parse(iso)) / 60000)} 分钟前`;

/** 探活瓷片：label + 状态徽标 + 实质指标副行 */
function ProbeTile({ icon, name, probe, sub }: { icon: React.ReactNode; name: string; probe?: { ok: boolean; latencyMs: number; error?: string }; sub?: string }) {
  return (
    <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
          {icon} {name}
        </span>
        {probe && (
          <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${probe.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
            <span className={`h-1 w-1 rounded-full ${probe.ok ? 'bg-[var(--success)]' : 'bg-[var(--danger)]'}`} />
            {probe.ok ? `${probe.latencyMs}ms` : '异常'}
          </span>
        )}
      </div>
      <span className="text-xs font-medium text-[var(--foreground)]">{probe?.ok ? (sub ?? '运行正常') : (probe?.error ?? '检测中…')}</span>
    </div>
  );
}

/** 24 小时趋势：请求量面积线 + 错误柱（手写 SVG，零图表库） */
function TrendChart({ series }: { series: HealthReport['api24h']['series'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 150, PAD_B = 18;
  const maxTotal = Math.max(1, ...series.map((s) => s.total));
  const maxErr = Math.max(1, ...series.map((s) => s.errors));
  const x = (i: number) => (i / Math.max(1, series.length - 1)) * W;
  const yTotal = (v: number) => H - PAD_B - (v / maxTotal) * (H - PAD_B - 6);
  const areaPath = `M0,${H - PAD_B} ` + series.map((s, i) => `L${x(i).toFixed(1)},${yTotal(s.total).toFixed(1)}`).join(' ') + ` L${W},${H - PAD_B} Z`;
  const linePath = series.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${yTotal(s.total).toFixed(1)}`).join(' ');
  const barW = W / series.length * 0.55;
  const h = hover != null ? series[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[150px] w-full" role="img" aria-label="近 24 小时请求量与错误趋势">
        <path d={areaPath} fill="var(--brand)" opacity="0.12" />
        <path d={linePath} fill="none" stroke="var(--brand)" strokeWidth="1.8" />
        {series.map((s, i) => s.errors > 0 && (
          <rect key={i} x={x(i) - barW / 2} y={H - PAD_B - (s.errors / maxErr) * (H - PAD_B - 6) * 0.8}
            width={barW} height={(s.errors / maxErr) * (H - PAD_B - 6) * 0.8} fill="var(--danger)" opacity="0.55" rx="1.5" />
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={H - PAD_B} stroke="var(--brand)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />}
        {series.map((s, i) => (
          <rect key={`hit-${i}`} x={x(i) - W / series.length / 2} y="0" width={W / series.length} height={H} fill="transparent"
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-1 rounded-[10px] bg-[oklch(1_0_0_/_0.96)] px-2.5 py-1.5 text-[11px] shadow-[inset_0_1px_0_oklch(1_0_0_/_0.8),2px_2px_6px_oklch(0.55_0.03_258_/_0.14)]"
          style={{ left: `${(hover! / Math.max(1, series.length - 1)) * 100}%`, transform: 'translateX(-50%)' }}>
          <div className="font-semibold text-[var(--foreground)]">{h.hour}</div>
          <div className="text-[var(--brand)]">请求 {h.total}</div>
          <div className={h.errors > 0 ? 'text-[var(--danger)]' : 'text-[var(--muted-foreground)]'}>错误 {h.errors}</div>
        </div>
      )}
      <div className="mt-1 flex justify-between text-[10px] text-[var(--muted-foreground)]">
        <span>{series[0]?.hour}</span><span>现在</span>
      </div>
    </div>
  );
}

export default function HealthPage() {
  const [data, setData] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errDetail, setErrDetail] = useState<{ open: boolean; rows: RecentError[]; loading: boolean; route?: string }>({ open: false, rows: [], loading: false });
  const [confirmAct, setConfirmAct] = useState<null | { kind: 'retry' | 'clear'; queue: 'tender' | 'bidder'; failed: number }>(null);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await api<HealthReport>('/health')); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { fetchCurrentUser().then((u) => setIsAdmin(u.role === 'admin')).catch(() => {}); }, []);

  const openErrDetail = async (route?: string) => {
    setErrDetail({ open: true, rows: [], loading: true, route });
    try { setErrDetail({ open: true, rows: await api<RecentError[]>('/recent-errors?limit=20'), loading: false, route }); }
    catch (e) { setError((e as Error).message); setErrDetail((s) => ({ ...s, loading: false })); }
  };

  const runQueueAction = async (kind: 'retry' | 'clear', queue: 'tender' | 'bidder') => {
    setBusy(true);
    try {
      const r = await api<{ retried?: number; skipped?: number; cleaned?: number }>(`/queue/${queue}/${kind === 'retry' ? 'retry-failed' : 'clear-failed'}`, { method: 'POST' });
      setConfirmAct(null);
      void reload();
      window.alert(kind === 'retry' ? `已重新排队 ${r.retried ?? 0} 个任务${r.skipped ? `，${r.skipped} 个未能重试` : ''}` : `已清除 ${r.cleaned ?? 0} 条失败记录`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const probes = useMemo(() => data
    ? [data.components.db, data.components.redis, data.components.minio, data.components.ocr]
    : [], [data]);
  const failCount = probes.filter((p) => p && !p.ok).length;
  const queues = useMemo(() => [
    { key: 'tender' as const, name: '招标文件解析', q: data?.queues.tenderProcessing },
    { key: 'bidder' as const, name: '投标书逐项分析', q: data?.queues.bidderProcessing },
  ], [data]);

  return (
    <div className="space-y-5">
      {/* ═══ page-hero ═══ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Activity size={17} strokeWidth={1.9} /></div>
            <div>
              <div className="page-hero__title">系统健康</div>
              <div className="page-hero__sub">各服务组件运行状态、近 24 小时接口表现与分析任务积压情况</div>
            </div>
          </div>
          <div className="page-hero__right">
            {data && (failCount > 0
              ? <span className="page-hero__stat page-hero__stat--warn"><span className="h-1.5 w-1.5 rounded-full shrink-0 bg-[var(--danger)]" />组件异常 {failCount}</span>
              : <span className="page-hero__stat page-hero__stat--info">组件 {probes.length - failCount}/{probes.length} 正常</span>)}
            {data && <span className={`page-hero__stat ${data.worker.alive ? 'page-hero__stat--info' : 'page-hero__stat--warn'}`}>
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${data.worker.alive ? 'bg-[var(--success)]' : 'bg-[var(--danger)]'}`} />
              {data.worker.alive ? `分析服务运行中（${data.worker.count} 个）` : '分析服务未运行'}
            </span>}
            <button onClick={() => void reload()} disabled={loading} className="neu-btn-xs" aria-label="刷新">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
        <div className="page-hero__divider" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <ProbeTile icon={<Database size={11} />} name="PostgreSQL" probe={data?.components.db}
            sub={data ? `连接 ${data.components.db.activeConns}/${data.components.db.maxConns} · 数据 ${fmtBytes(data.components.db.sizeBytes)}` : undefined} />
          <ProbeTile icon={<Server size={11} />} name="Redis" probe={data?.components.redis}
            sub={data ? `内存 ${fmtBytes(data.components.redis.usedMemoryBytes)} · 连接 ${data.components.redis.clients}` : undefined} />
          <ProbeTile icon={<HardDrive size={11} />} name="MinIO 对象存储" probe={data?.components.minio} />
          <ProbeTile icon={<ScanText size={11} />} name="OCR 识别服务" probe={data ? { ok: data.components.ocr.ok, latencyMs: data.components.ocr.replicas[0]?.latencyMs ?? 0 } : undefined}
            sub={data ? `副本 ${data.components.ocr.upCount}/${data.components.ocr.total} 可用` : undefined} />
          <ProbeTile icon={<Cpu size={11} />} name="分析服务" probe={data ? { ok: data.worker.alive, latencyMs: 0 } : undefined}
            sub={data?.worker.alive
              ? `心跳 ${data.worker.lastBeatAgoSec ?? 0} 秒前 · ${data.worker.count} 个`
              : data ? `最后心跳 ${data.worker.lastBeatAgoSec != null ? `${Math.round(data.worker.lastBeatAgoSec / 60)} 分钟前` : '无记录'}` : undefined} />
        </div>
      </div>

      {error && (
        <div className="flex flex-col items-center gap-3 py-10">
          <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><AlertTriangle size={22} className="text-[var(--danger)]" /></div>
          <p className="text-sm font-semibold text-[var(--danger)]">{error}</p>
          <button onClick={() => void reload()} className="neu-btn-soft"><RefreshCw size={15} />重试</button>
        </div>
      )}

      {!error && (
        <>
          {/* ═══ 24h 趋势 ═══ */}
          <div className="wb-panel p-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold tracking-wide">近 24 小时请求与错误趋势</span>
              {data && (
                <span className="text-xs text-[var(--muted-foreground)]">
                  共 {data.api24h.total.toLocaleString()} 次 · 错误 {data.api24h.errors} 次（{data.api24h.errorRate}%） · P95 耗时 {data.api24h.p95ms} ms（95% 的请求耗时低于此值，操作日志口径）
                </span>
              )}
            </div>
            {loading ? <TableSkeleton cols={6} rows={2} /> : (
              data && data.api24h.total === 0
                ? <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">全量计数自功能上线起累积，暂无数据</p>
                : <TrendChart series={data!.api24h.series} />
            )}
          </div>

          {/* ═══ 接口表现：错误榜 + 慢接口榜 ═══ */}
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="neu-table-card">
              <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-semibold tracking-wide">今日错误最多的接口</span>
                <button onClick={() => void openErrDetail()} className="neu-btn-xs" disabled={loading}>查看最近错误</button>
              </div>
              <div className="overflow-x-auto">
                <table className="neu-table w-full min-w-[480px]">
                  <thead><tr><th>接口</th><th>错误次数</th><th>最近发生</th></tr></thead>
                  <tbody>
                    {loading ? <TableSkeleton cols={3} rows={4} /> : (data?.topErrors ?? []).length === 0 ? (
                      <tr><td colSpan={3} className="py-8 text-center text-xs text-[var(--muted-foreground)]">今日暂无错误</td></tr>
                    ) : (data?.topErrors ?? []).map((e) => (
                      <tr key={`${e.method}-${e.route}`} className="row-clickable" onClick={() => void openErrDetail(`${e.method} ${e.route}`)}>
                        <td className="max-w-[280px] truncate text-left font-mono text-xs" title={`${e.method} ${e.route}`}>{e.method} {e.route}</td>
                        <td className="font-mono tabular-nums text-[var(--danger)]">{e.count}</td>
                        <td className="text-xs text-[var(--muted-foreground)]">{fmtAgo(e.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="neu-table-card">
              <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm font-semibold tracking-wide">耗时最长的接口</span>
                <span className="text-xs text-[var(--muted-foreground)]">近 24 小时 · 操作日志口径</span>
              </div>
              <div className="overflow-x-auto">
                <table className="neu-table w-full min-w-[480px]">
                  <thead><tr><th>接口</th><th>95% 请求耗时</th><th>最慢</th><th>次数</th></tr></thead>
                  <tbody>
                    {loading ? <TableSkeleton cols={4} rows={4} /> : (data?.topSlow ?? []).length === 0 ? (
                      <tr><td colSpan={4} className="py-8 text-center text-xs text-[var(--muted-foreground)]">暂无数据</td></tr>
                    ) : (data?.topSlow ?? []).map((s) => (
                      <tr key={`${s.method}-${s.path}`}>
                        <td className="max-w-[280px] truncate text-left font-mono text-xs" title={`${s.method} ${s.path}`}>{s.method} {s.path}</td>
                        <td className="font-mono tabular-nums">{s.p95ms} ms</td>
                        <td className="font-mono tabular-nums text-[var(--muted-foreground)]">{s.maxMs} ms</td>
                        <td className="font-mono tabular-nums">{s.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ═══ 分析任务队列 ═══ */}
          <div className="neu-table-card">
            <div className="neu-table-card-header flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-semibold tracking-wide">AI 分析任务队列</span>
              {data && !data.worker.alive && (data.queues.tenderProcessing?.waiting ?? 0) + (data.queues.bidderProcessing?.waiting ?? 0) > 0 && (
                <span className="wb-alert wb-alert--warning px-3 py-1.5 text-xs">分析服务未运行，{（data.queues.tenderProcessing?.waiting ?? 0) + (data.queues.bidderProcessing?.waiting ?? 0)} 个任务正在等待</span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="neu-table w-full min-w-[860px]">
                <thead><tr><th>队列</th><th>等待中</th><th>执行中</th><th>失败</th><th>最近完成</th><th>操作</th></tr></thead>
                <tbody>
                  {loading ? <TableSkeleton cols={6} rows={2} /> : queues.map(({ key, name, q }) => q == null ? (
                    <tr key={key}><td colSpan={6} className="py-6 text-center text-xs text-[var(--muted-foreground)]">{name}：队列数据不可用</td></tr>
                  ) : (
                    <Fragment key={key}>
                      <tr className="row-clickable">
                        <td className="font-medium">{name}</td>
                        <td className={`font-mono tabular-nums ${q.waiting > 0 && !data?.worker.alive ? 'text-[var(--warning)]' : ''}`}>{q.waiting}</td>
                        <td className="font-mono tabular-nums">{q.active}</td>
                        <td className={`font-mono tabular-nums ${q.failed > 0 ? 'text-[var(--danger)]' : ''}`}>{q.failed}</td>
                        <td className="text-xs text-[var(--muted-foreground)]">{fmtAgo(q.lastFinishedAt)}</td>
                        <td>
                          {isAdmin && q.failed > 0 && (
                            <div className="flex justify-center gap-1.5">
                              <button onClick={() => setConfirmAct({ kind: 'retry', queue: key, failed: q.failed })} className="neu-btn-xs is-warning" disabled={busy}>重试失败</button>
                              <button onClick={() => setConfirmAct({ kind: 'clear', queue: key, failed: q.failed })} className="neu-btn-xs is-danger" disabled={busy}>清除失败记录</button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {q.failedJobs.map((j) => (
                        <tr key={j.id}>
                          <td colSpan={6} className="py-2 text-left text-xs text-[var(--muted-foreground)]">
                            <span className="font-mono">{j.name ?? j.id}</span>
                            <span className="mx-2">·</span>尝试 {j.attempts} 次
                            <span className="mx-2">·</span>{fmtAgo(j.failedAt)}
                            <span className="mx-2">·</span><span className="text-[var(--danger)]">{j.failedReason || '无失败原因'}</span>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* 错误样例弹层 */}
      <Modal open={errDetail.open} onClose={() => setErrDetail((s) => ({ ...s, open: false }))} title="最近错误明细（近 24 小时）">
        {errDetail.route && <p className="mb-2 text-xs text-[var(--muted-foreground)]">高亮行与所点接口匹配：{errDetail.route}</p>}
        {errDetail.loading ? <TableSkeleton cols={4} rows={4} /> : errDetail.rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">暂无错误记录</p>
        ) : (
          <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
            {errDetail.rows.map((r, i) => {
              const hit = errDetail.route === `${r.method} ${r.path}`;
              return (
                <div key={i} className={`rounded-[10px] px-3 py-2 text-xs ${hit ? 'bg-[color-mix(in_oklch,var(--warning)_10%,transparent)]' : ''}`}>
                  <span className={`font-mono font-semibold ${r.statusCode >= 500 ? 'text-[var(--danger)]' : 'text-[var(--warning)]'}`}>{r.statusCode}</span>
                  <span className="mx-2 font-mono">{r.method} {r.path}</span>
                  <span className="text-[var(--muted-foreground)]">{new Date(r.createdAt).toLocaleString('zh-CN', { hour12: false })} · {r.durationMs}ms{r.ipAddress ? ` · ${r.ipAddress}` : ''}</span>
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* 队列操作确认 */}
      <Modal open={confirmAct != null} onClose={() => setConfirmAct(null)} title={confirmAct?.kind === 'retry' ? '重试失败任务' : '清除失败记录'}>
        {confirmAct && (
          <div className="space-y-3">
            <p className="text-sm">
              {confirmAct.kind === 'retry'
                ? <>将把「{queues.find((qq) => qq.key === confirmAct.queue)?.name}」队列中最近 500 个以内的 {confirmAct.failed} 个失败任务重新排队执行。</>
                : <>将清除该队列 {confirmAct.failed} 条失败记录。<strong className="text-[var(--danger)]">清除后不可恢复</strong>，仅在确认这些失败不再需要处理时使用。</>}
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmAct(null)} className="neu-btn-soft !h-9 !text-xs" disabled={busy}>取消</button>
              <button onClick={() => void runQueueAction(confirmAct.kind, confirmAct.queue)}
                className={`neu-btn-soft !h-9 !text-xs ${confirmAct.kind === 'retry' ? 'is-warning' : 'is-danger'}`} disabled={busy}>
                {confirmAct.kind === 'retry' ? '确认重试' : '确认清除'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
```

实现注意：
- 顶部补 `import { Fragment } from 'react';`（与现有 hooks import 合并）。
- `wb-alert--warning` 变体名以 `apps/web/src/app/globals.css` 实际为准（先 grep `wb-alert` 确认四变体名，不存在则用现成变体或内联 `wb-note`）。
- `Modal` 组件 props（`open/onClose/title`）以 `apps/web/src/components/workbench/modal.tsx` 实际签名为准，不匹配则按其真实 API 调整调用。
- 探活瓷片 `分析服务` 的 probe 借用 `{ ok: worker.alive, latencyMs: 0 }` 结构以复用组件；「异常」态文案由 sub 提供。

- [ ] **Step 2: tsc + lint**

Run: `cd apps/web && npx tsc --noEmit && npx eslint 'src/app/(main)/admin/health/page.tsx'`
Expected: 无错误

- [ ] **Step 3: 手工验证**

浏览器 :3005 `/admin/health`（admin 登录）：五瓷片实质指标、趋势图有形（若无历史显示「自功能上线起累积」）、错误/慢接口榜、失败任务明细与重试/清除按钮可见可操作；leader 登录操作按钮不出现。

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(main\)/admin/health/page.tsx
git commit -m "feat(web): 系统健康页重写——巡检瓷片+趋势图+错误/慢接口榜+失败任务可操作（覆盖并行会话文案 diff，意图已吸收）"
```

---

### Task 8: 收尾——文档与全量验证

**Files:**
- Modify: `CLAUDE.md`（API 模块表加 Metrics 一行）

- [ ] **Step 1: CLAUDE.md 模块表补行**

在 `| LocalAi |` 行后插入：

```markdown
| `Metrics` | **Global** 全量请求指标拦截器（Redis 分钟桶+按日接口计数，无排除表）+ worker 心跳读侧；供系统健康页真实总量/趋势/Top 榜（system-config health 端点聚合） |
```

- [ ] **Step 2: 全量验证**

Run:
```bash
pnpm --filter api test -- metrics system-config ocr.service.probe
pnpm --filter api test:e2e -- system-health
cd apps/web && npx tsc --noEmit
```
Expected: 全绿。

- [ ] **Step 3: worker 心跳冒烟（可选但推荐）**

Run: `pnpm --filter api dev:worker:ai-bid-analysis` 起一个 worker，30 秒后 `redis-cli -p 6380 keys 'sys:aiworker:hb:*'`；停止 worker 后 90 秒内键消失。
Expected: 键出现/消失符合 TTL 语义。

- [ ] **Step 4: Commit**

```bash
git add ../CLAUDE.md
git commit -m "docs(claude): 模块表收录 Metrics（全量指标拦截器 + worker 心跳）"
```
