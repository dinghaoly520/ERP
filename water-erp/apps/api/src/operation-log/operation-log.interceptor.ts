import { CallHandler, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { Request } from 'express';
import { OperationLogService } from './operation-log.service';
import type { OperationLogEntry } from './operation-log.types';
import { getClientIp } from '../common/client-ip.util';
import { portalFromRequest } from '../auth/portal-cookie';
import { sanitizeBody, sanitizeQueryString, truncateString } from './sanitize.util';
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
