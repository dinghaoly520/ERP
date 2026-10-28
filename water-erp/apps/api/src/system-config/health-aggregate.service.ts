import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OcrService } from '../local-ai/ocr.service';
import { QUEUE_NAMES } from '../ai-bid-analysis/queues/queue.module';
import { dayKey, METRICS_KEYS, minuteKey } from '../metrics/metrics-keys.util';
import { readWorkerHeartbeat } from '../metrics/worker-heartbeat.util';

export type QueueSnapshot = {
  waiting: number; active: number; failed: number;
  lastFinishedAt: string | null;
  failedJobs: Array<{ id: string; name: string; failedReason: string; failedAt: string | null; attempts: number }>;
};

export type HealthReport = {
  checkedAt: string;
  components: {
    db: { ok: boolean; latencyMs: number; error?: string; activeConns: number; maxConns: number; sizeBytes: number };
    redis: { ok: boolean; latencyMs: number; error?: string; usedMemoryBytes: number; clients: number; uptimeSec: number };
    minio: { ok: boolean; latencyMs: number; error?: string };
    ocr: { ok: boolean; upCount: number; total: number; replicas: Array<{ url: string; ok: boolean; latencyMs: number }> };
  };
  api24h: { total: number; errors: number; errorRate: number; p95ms: number; series: Array<{ hour: string; total: number; errors: number }> };
  topErrors: Array<{ method: string; route: string; count: number; lastAt: string | null }>;
  topSlow: Array<{ method: string; path: string; count: number; p95ms: number; maxMs: number }>;
  queues: { tenderProcessing: QueueSnapshot | null; bidderProcessing: QueueSnapshot | null };
  worker: { alive: boolean; count: number; lastBeatAgoSec: number | null };
};

const pad = (n: number) => String(n).padStart(2, '0');

@Injectable()
export class HealthAggregateService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
    @InjectQueue(QUEUE_NAMES.TENDER_PROCESSING) private readonly tenderQueue: Queue,
    @InjectQueue(QUEUE_NAMES.BIDDER_PROCESSING) private readonly bidderQueue: Queue,
  ) {}

  private async timed<T>(fn: () => Promise<T>): Promise<{ ok: boolean; latencyMs: number; error?: string; value?: T }> {
    const t0 = Date.now();
    try { const value = await fn(); return { ok: true, latencyMs: Date.now() - t0, value }; }
    catch (e) { return { ok: false, latencyMs: Date.now() - t0, error: (e as Error).message }; }
  }

  /** Redis INFO 文本 → 行解析 */
  private static infoLine(info: string, key: string): number {
    const m = info.match(new RegExp(`^${key}:(.*)$`, 'm'));
    return m ? Number(m[1].trim()) || 0 : 0;
  }

  private async apiMetrics() {
    const hash = await this.redis.hgetall(METRICS_KEYS.minutesHash).catch(() => ({} as Record<string, string>));
    const windowStart = minuteKey(new Date(Date.now() - 24 * 3600 * 1000));
    let total = 0, errors = 0;
    const perHour = new Map<string, { total: number; errors: number }>();
    for (const [field, count] of Object.entries(hash)) {
      const kind = field.slice(0, 1);            // 't' | 'e'
      const min = field.slice(2);                // yyyyMMddHHmm
      if (min < windowStart) continue;           // 窗口外忽略（同长数字串字典序=时间序）
      const n = Number(count) || 0;
      if (kind === 't') total += n; else errors += n;
      const hour = min.slice(0, 10);             // yyyyMMddHH
      const bucket = perHour.get(hour) ?? { total: 0, errors: 0 };
      if (kind === 't') bucket.total += n; else bucket.errors += n;
      perHour.set(hour, bucket);
    }
    // 补齐最近 24 个小时点（含零值小时），旧→新
    const series: HealthReport['api24h']['series'] = [];
    const now = new Date();
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 3600 * 1000);
      const hour = minuteKey(d).slice(0, 10);
      const b = perHour.get(hour) ?? { total: 0, errors: 0 };
      series.push({ hour: `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:00`, total: b.total, errors: b.errors });
    }
    // P95：OperationLog 口径（排除高频轮询，如实标注）
    const p95 = await this.prisma.$queryRaw<Array<{ p95ms: number }>>`
      SELECT COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs"), 0)::int AS "p95ms"
      FROM "OperationLog" WHERE "createdAt" > now() - interval '24 hours'`.catch(() => [{ p95ms: 0 }]);
    return { total, errors, errorRate: total > 0 ? Math.round((errors / total) * 10000) / 100 : 0, p95ms: p95[0]?.p95ms ?? 0, series };
  }

  private async topErrors() {
    const day = dayKey();
    const [errCounts, lastAt] = await Promise.all([
      this.redis.hgetall(METRICS_KEYS.routesErrDay(day)).catch(() => ({} as Record<string, string>)),
      this.redis.hgetall(METRICS_KEYS.routesLastDay(day)).catch(() => ({} as Record<string, string>)),
    ]);
    return Object.entries(errCounts)
      .map(([field, count]) => {
        const sp = field.indexOf(' ');
        return { method: field.slice(0, sp), route: field.slice(sp + 1), count: Number(count) || 0, lastAt: lastAt[field] ?? null };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }

  private async topSlow() {
    return this.prisma.$queryRaw<HealthReport['topSlow']>`
      SELECT "method", "path", COUNT(*)::int AS "count",
             COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs"), 0)::int AS "p95ms",
             MAX("durationMs")::int AS "maxMs"
      FROM "OperationLog" WHERE "createdAt" > now() - interval '24 hours'
      GROUP BY "method", "path" ORDER BY "p95ms" DESC LIMIT 8`.catch(() => [] as HealthReport['topSlow']);
  }

  private async queueSnapshot(q: Queue): Promise<QueueSnapshot | null> {
    try {
      const counts = await q.getJobCounts('waiting', 'active', 'failed');
      const completed = await q.getJobs('completed', 0, 4);
      const failed = await q.getJobs('failed', 0, 9);
      const lastFinishedMs = Math.max(0, ...completed.map((j) => j.finishedOn ?? 0));
      return {
        waiting: counts.waiting ?? 0, active: counts.active ?? 0, failed: counts.failed ?? 0,
        lastFinishedAt: lastFinishedMs > 0 ? new Date(lastFinishedMs).toISOString() : null,
        failedJobs: failed.map((j) => ({
          id: String(j.id), name: j.name ?? '',
          failedReason: (j.failedReason ?? '').slice(0, 300),
          failedAt: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
          attempts: j.attemptsMade ?? 0,
        })),
      };
    } catch { return null; }
  }

  async read(): Promise<HealthReport> {
    const [dbP, redisP, minioP, replicas, api, errs, slow, tender, bidder, worker] = await Promise.all([
      this.timed(() => this.prisma.$queryRaw<Array<{ activeConns: number; maxConns: number; sizeBytes: bigint }>>`
        SELECT (SELECT numbackends::int FROM pg_stat_database WHERE datname = current_database()) AS "activeConns",
               (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') AS "maxConns",
               pg_database_size(current_database())::bigint AS "sizeBytes"`),
      this.timed(() => this.redis.ping().then(() => this.redis.info())),
      this.timed(() => this.storage.ensureBucket()),
      this.ocr.probeReplicas().catch(() => [] as Array<{ url: string; ok: boolean; latencyMs: number }>),
      this.apiMetrics(), this.topErrors(), this.topSlow(),
      this.queueSnapshot(this.tenderQueue), this.queueSnapshot(this.bidderQueue),
      readWorkerHeartbeat(this.redis).catch(() => ({ alive: false, count: 0, lastBeatAgoSec: null })),
    ]);
    const dbStats = dbP.value?.[0];
    const info = redisP.value ?? '';
    return {
      checkedAt: new Date().toISOString(),
      components: {
        db: {
          ok: dbP.ok, latencyMs: dbP.latencyMs, error: dbP.error,
          activeConns: dbStats?.activeConns ?? 0, maxConns: dbStats?.maxConns ?? 0,
          sizeBytes: Number(dbStats?.sizeBytes ?? 0),
        },
        redis: {
          ok: redisP.ok, latencyMs: redisP.latencyMs, error: redisP.error,
          usedMemoryBytes: HealthAggregateService.infoLine(info, 'used_memory'),
          clients: HealthAggregateService.infoLine(info, 'connected_clients'),
          uptimeSec: HealthAggregateService.infoLine(info, 'uptime_in_seconds'),
        },
        minio: { ok: minioP.ok, latencyMs: minioP.latencyMs, error: minioP.error },
        ocr: {
          ok: replicas.some((r) => r.ok), upCount: replicas.filter((r) => r.ok).length,
          total: replicas.length, replicas,
        },
      },
      api24h: api,
      topErrors: errs,
      topSlow: slow,
      queues: { tenderProcessing: tender, bidderProcessing: bidder },
      worker,
    };
  }

  /** 队列名白名单（防任意队列名注入） */
  private queueByName(name: string): Queue {
    if (name === 'tender') return this.tenderQueue;
    if (name === 'bidder') return this.bidderQueue;
    throw new BadRequestException({ error: '未知队列', code: 'UNKNOWN_QUEUE' });
  }

  /** 重试失败任务：单次至多最新 500 个；重试失败计入 skipped */
  async retryFailed(name: string): Promise<{ retried: number; skipped: number }> {
    const q = this.queueByName(name);
    const jobs = await q.getJobs('failed', 0, 499);
    let retried = 0, skipped = 0;
    for (const j of jobs) {
      try { await j.retry(); retried++; } catch { skipped++; }
    }
    return { retried, skipped };
  }

  /** 清除失败记录（不可恢复——前端确认弹窗警示） */
  async clearFailed(name: string): Promise<{ cleaned: number }> {
    const q = this.queueByName(name);
    const cleaned = await q.clean(0, 10_000, 'failed');
    return { cleaned: cleaned.length };
  }

  /** 最近错误样例（OperationLog ≥400，倒序） */
  async recentErrors(limit = 20) {
    const take = Math.min(100, Math.max(1, limit));
    return this.prisma.operationLog.findMany({
      where: { statusCode: { gte: 400 }, createdAt: { gt: new Date(Date.now() - 24 * 3600 * 1000) } },
      orderBy: { createdAt: 'desc' },
      take,
      select: { method: true, path: true, statusCode: true, durationMs: true, createdAt: true, ipAddress: true },
    });
  }
}
