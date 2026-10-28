import { CallHandler, ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import { catchError, Observable, tap, throwError } from 'rxjs';
import { Request } from 'express';
import Redis from 'ioredis';
import { dayKey, METRICS_KEYS, minuteKey } from './metrics-keys.util';

/** 全量请求指标拦截器：计数进 Redis，fire-and-forget，绝不阻塞/影响响应。
 *  与 OperationLog 拦截器并存——本层**无排除表**（轮询也计入），供「真实总量/错误趋势」；
 *  OperationLog 继续承担审计明细（含耗时，供 P95/慢接口）。
 *  口径边界（2026-10-28 实测）：Nest 生命周期守卫先于拦截器——未登录/无权限的 401/403
 *  守卫拒绝**不经本层**（总量与错误均不含）；过守卫后的业务 4xx/5xx 全计。 */
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
