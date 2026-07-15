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
import { DEFAULT_EXCLUDE_PATHS, parseExcludePaths, shouldExclude, type ExcludePattern } from '../../operation-log/operation-log.filter';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);
  private readonly oplogEnabled: boolean;
  private readonly bodyMaxBytes: number;
  private readonly exclude: ExcludePattern[];

  constructor(private readonly operationLog: OperationLogService) {
    this.oplogEnabled = process.env.OPERATION_LOG_ENABLED !== 'false';
    this.bodyMaxBytes = (Number(process.env.OPERATION_LOG_BODY_MAX_KB) || 4) * 1024;
    this.exclude = [...DEFAULT_EXCLUDE_PATHS, ...parseExcludePaths(process.env.OPERATION_LOG_EXCLUDE)];
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // ── 补记 guard 拒绝的请求：interceptor 未运行（标志未设），filter 兜底记录 ──
    if (this.oplogEnabled && !(request as any).__oplogRecorded && !shouldExclude(request.path, this.exclude)) {
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
