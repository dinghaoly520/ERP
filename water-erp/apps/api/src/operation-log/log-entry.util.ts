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
