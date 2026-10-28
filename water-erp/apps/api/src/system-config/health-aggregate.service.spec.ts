import { HealthAggregateService } from './health-aggregate.service';
import { METRICS_KEYS, minuteKey } from '../metrics/metrics-keys.util';

function minuteField(d: Date, kind: 't' | 'e') { return `${kind}:${minuteKey(d)}`; }

/** 构造 24h 内外的分钟字段混合，验证窗口过滤与小时聚合 */
function mkMinutesHash() {
  const now = new Date();
  const h1 = new Date(now.getTime() - 60 * 60 * 1000);
  const h2 = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const stale = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 窗口外，应忽略
  return {
    [minuteField(now, 't')]: '5', [minuteField(now, 'e')]: '1',
    [minuteField(h1, 't')]: '10', [minuteField(h2, 't')]: '20', [minuteField(h2, 'e')]: '2',
    [minuteField(stale, 't')]: '999',
  };
}

/** 聚合服务工厂：六个依赖位均可覆盖（Task 5 的队列/日志操作测试复用） */
function mkSvc(over: { prisma?: any; redis?: any; storage?: any; ocr?: any; tender?: any; bidder?: any } = {}) {
  const prisma: any = over.prisma ?? {
    $queryRaw: jest.fn().mockResolvedValue([
      { activeConns: 3, maxConns: 200, sizeBytes: 1234567890n },
    ]),
    operationLog: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const redis: any = over.redis ?? {
    ping: async () => 'PONG',
    info: async () => '# Memory\r\nused_memory:1048576\r\n# Clients\r\nconnected_clients:8\r\n# Server\r\nuptime_in_seconds:3600\r\n',
    hgetall: jest.fn().mockImplementation(async (key: string) => {
      if (key === METRICS_KEYS.minutesHash) return mkMinutesHash();
      if (key.startsWith('sys:metrics:routes:err:')) return { 'GET /api/x': '7', 'POST /api/y': '3' };
      if (key.startsWith('sys:metrics:routes:last:')) return { 'GET /api/x': new Date().toISOString() };
      return {};
    }),
    scan: async () => ['0', []],
    mget: async () => [],
  };
  const storage: any = over.storage ?? { ensureBucket: async () => undefined };
  const ocr: any = over.ocr ?? { probeReplicas: async () => [{ url: 'http://localhost:8100', ok: true, latencyMs: 2 }] };
  const mkQueue = () => ({
    getJobCounts: async () => ({ waiting: 1, active: 0, failed: 2 }),
    getJobs: jest.fn().mockImplementation(async (type: string) =>
      type === 'completed' ? [{ finishedOn: Date.now() - 5000 }]
        : [{ id: 'j1', name: 'tender:1', failedReason: 'LLM 超时'.repeat(80), finishedOn: Date.now() - 1000, attemptsMade: 2 }]),
  });
  return new HealthAggregateService(prisma, redis, storage, ocr, over.tender ?? mkQueue(), over.bidder ?? mkQueue());
}

describe('HealthAggregateService.read', () => {
  it('聚合形状：组件实质指标 + 全量口径 api24h（窗口过滤）+ 小时序列 + Top 榜 + 队列快照 + worker', async () => {
    const r = await mkSvc().read();
    expect(r.components.db).toMatchObject({ activeConns: 3, maxConns: 200 });
    expect(r.components.redis).toMatchObject({ usedMemoryBytes: 1048576, clients: 8, uptimeSec: 3600 });
    expect(r.components.ocr).toMatchObject({ upCount: 1, total: 1 });
    // 窗口外 999 被忽略：total = 5+10+20 = 35，errors = 1+2 = 3
    expect(r.api24h.total).toBe(35);
    expect(r.api24h.errors).toBe(3);
    expect(r.api24h.series).toHaveLength(24);           // 恒 24 个小时点（含补零）
    expect(r.topErrors[0]).toMatchObject({ method: 'GET', route: '/api/x', count: 7 });
    expect(r.topErrors[0].lastAt).toBeTruthy();
    expect(r.queues.tenderProcessing).toMatchObject({ waiting: 1, failed: 2 });
    expect(r.queues.tenderProcessing!.failedJobs[0].failedReason.length).toBeLessThanOrEqual(300);
    expect(r.queues.tenderProcessing!.lastFinishedAt).toBeTruthy();
    expect(r.worker).toEqual({ alive: false, count: 0, lastBeatAgoSec: null });
  });
});
