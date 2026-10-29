import { of, throwError } from 'rxjs';
import { BadRequestException } from '@nestjs/common';
import { MetricsInterceptor } from './metrics.interceptor';
import { METRICS_KEYS, dayKey } from './metrics-keys.util';

/** 最小 redis mock：直连与 pipeline 命令都记入同一 calls（pipeline 各方法共享记录器） */
function mkRedis() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const rec = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
    return Promise.resolve(1);
  };
  const mkPipe = () => {
    const p: Record<string, unknown> = { exec: async () => [] };
    for (const op of ['hincrby', 'hset', 'expire']) p[op] = rec(op);
    return p;
  };
  return {
    calls,
    hincrby: rec('hincrby'), hset: rec('hset'), expire: rec('expire'),
    pipeline: mkPipe,
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
      pipeline: () => ({ hincrby: () => {}, hset: () => {}, expire: () => {}, exec: () => Promise.reject(new Error('down')) }),
    };
    const i = new MetricsInterceptor(redis);
    i.intercept(mkCtx('GET', '/api/foo'), { handle: () => of('ok') }).subscribe({
      complete: () => done(), // 能正常 complete 即未影响响应
      error: (e) => done(e as Error),
    });
  });

  it('命令走单次 pipeline；EXPIRE 每键仅首次发送（不随请求反复刷新）', (done) => {
    const redis = mkRedis();
    const i = new MetricsInterceptor(redis);
    i.intercept(mkCtx('GET', '/api/a'), { handle: () => of(1) }).subscribe({
      complete: () => {
        i.intercept(mkCtx('GET', '/api/b'), { handle: () => of(1) }).subscribe({
          complete: () => {
            const tIncs = redis.calls.filter(c => c.op === 'hincrby' && String(c.args[1]).startsWith('t:'));
            expect(tIncs).toHaveLength(2); // 两次请求各计一次
            const ttlMin = redis.calls.filter(c => c.op === 'expire' && c.args[0] === METRICS_KEYS.minutesHash);
            expect(ttlMin).toHaveLength(1); // TTL 只发一次
            done();
          },
        });
      },
    });
  });
});
