import { api } from "@/lib/api";

/** OperationLog 行（apps/api/src/operation-log/operation-log.types.ts Entry 的落库形态） */
export type OperationLogRow = {
  id: string;
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
  createdAt: string;
};

export type OperationLogList = { items: OperationLogRow[]; total: number };

/** 全站操作日志查询（admin/bid_host；body 服务端已脱敏截断） */
export function fetchOperationLogs(params: URLSearchParams) {
  const qs = params.toString();
  return api.get<OperationLogList>(`/operation-log${qs ? `?${qs}` : ""}`);
}
