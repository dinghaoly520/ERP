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
