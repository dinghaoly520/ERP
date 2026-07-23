import { CallHandler, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { Request } from 'express';
import { OperationLogService } from './operation-log.service';
import { buildLogEntry } from './log-entry.util';
import { DEFAULT_EXCLUDE_PATHS, parseExcludePaths, shouldExclude, type ExcludePattern } from './operation-log.filter';

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
    if (shouldExclude(req.method, req.path, this.exclude)) return next.handle();

    const start = Date.now();
    const record = (statusCode: number, error: unknown | null) => {
      const entry = buildLogEntry(req, statusCode, Date.now() - start, error, this.bodyMaxBytes);
      this.service.create(entry).catch((e) => this.logger.warn(`OperationLog 记录失败: ${e?.message ?? e}`));
      (req as any).__oplogRecorded = true;
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
