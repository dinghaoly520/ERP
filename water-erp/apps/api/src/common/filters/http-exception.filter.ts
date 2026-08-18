import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { Prisma } from '@prisma/client';
import { OperationLogService } from '../../operation-log/operation-log.service';
import { buildLogEntry } from '../../operation-log/log-entry.util';
import { DEFAULT_EXCLUDE_PATHS, parseExcludePaths, shouldExclude, type ExcludePattern } from '../../operation-log/operation-log.filter';

/**
 * 把 Prisma 已知错误码转成用户可读的中文提示，避免把原始技术报错（乱码般的英文堆栈）直接抛给前端。
 * 返回 null 表示该错误码无对应文案，走默认"服务器内部错误"。
 */
function prismaErrorToMessage(e: Prisma.PrismaClientKnownRequestError): { status: number; code: string; message: string } | null {
  const meta = (e.meta ?? {}) as Record<string, unknown>;
  switch (e.code) {
    case 'P2025':
      return { status: 404, code: 'RECORD_NOT_FOUND', message: '操作的记录不存在或已被删除，请刷新后重试。' };
    case 'P2002': {
      const target = Array.isArray(meta.target) ? (meta.target as string[]).join('、') : String(meta.target ?? '');
      return { status: 409, code: 'DUPLICATE_RECORD', message: `数据重复，${target ? `「${target}」` : '该记录'}已存在，请勿重复提交。` };
    }
    case 'P2003':
      return { status: 409, code: 'FK_CONSTRAINT', message: '操作失败：存在关联数据依赖，请先处理相关记录。' };
    case 'P2024':
      return { status: 504, code: 'DB_TIMEOUT', message: '数据库响应超时，请稍后重试。' };
    case 'P2028':
      return { status: 500, code: 'TX_ERROR', message: '事务执行失败，请稍后重试。' };
    case 'P1001':
    case 'P1002':
    case 'P1003':
      return { status: 503, code: 'DB_UNAVAILABLE', message: '数据库连接失败，请稍后重试或联系管理员。' };
    default:
      return null;
  }
}

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
    if (this.oplogEnabled && !(request as any).__oplogRecorded && !shouldExclude(request.method, request.path, this.exclude)) {
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
        // NestJS nests custom objects into message: { message: { code, error }, error: 'Bad Request' }
        } else if (typeof obj.message === 'object' && obj.message !== null) {
          const nested = obj.message as Record<string, unknown>;
          if (typeof nested.code === 'string' && typeof nested.error === 'string') {
            code = nested.code;
            message = nested.error;
          } else {
            message = exception.message;
            code = (obj.error as string) || code;
          }
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
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Prisma 已知错误（如 P2025 记录不存在）→ 转为清晰中文提示，不暴露原始技术报错
      const mapped = prismaErrorToMessage(exception);
      if (mapped) {
        status = mapped.status;
        code = mapped.code;
        message = mapped.message;
      } else {
        message = '数据操作失败，请稍后重试。';
        code = exception.code;
      }
      this.logger.error(`${request.method} ${request.url} Prisma[${exception.code}] ${exception.message}`, exception.stack);
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      message = '数据参数校验失败，请检查输入后重试。';
      code = 'PRISMA_VALIDATION';
      this.logger.error(`${request.method} ${request.url} PrismaValidation ${exception.message}`, exception.stack);
    } else if (
      exception instanceof Prisma.PrismaClientInitializationError ||
      exception instanceof Prisma.PrismaClientRustPanicError
    ) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = '数据库服务异常，请稍后重试或联系管理员。';
      code = 'DB_ERROR';
      this.logger.error(`${request.method} ${request.url} PrismaInit ${exception.message}`, exception.stack);
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
