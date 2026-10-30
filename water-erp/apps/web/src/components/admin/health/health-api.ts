import { apiFetch } from '@/lib/api/api-fetch';

/* ═══════════════════════════════════════════════════════════════
   系统健康页共用取数层（2026-10-30 合并操作日志重构）：
   类型 + api() 取数函数 + 格式化工具，page 与 overview-tab 共用
   ═══════════════════════════════════════════════════════════════ */

export type Probe = { ok: boolean; latencyMs: number; error?: string };
export type HealthReport = {
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
export type RecentError = { method: string; path: string; statusCode: number; durationMs: number; createdAt: string; ipAddress: string | null };

export async function healthApi<T>(path: string, init?: RequestInit): Promise<T> {
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

export const fmtBytes = (n: number): string =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(0)} MB` : `${(n / 1024).toFixed(0)} KB`;

export const fmtAgo = (iso: string | null): string => {
  if (!iso) return '—';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} 小时前` : `${Math.floor(h / 24)} 天前`;
};

/** 秒距 → 人话（渲染期纯算术，不取当前时刻） */
export const fmtSecAgo = (s: number): string =>
  s < 90 ? `${s} 秒前` : s < 5400 ? `${Math.round(s / 60)} 分钟前` : `${Math.round(s / 3600)} 小时前`;
