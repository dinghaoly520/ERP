import { readWorkerHeartbeat } from './worker-heartbeat.util';

describe('readWorkerHeartbeat', () => {
  it('无键 → 未运行', async () => {
    const redis: any = { scan: async () => ['0', []], mget: async () => [] };
    expect(await readWorkerHeartbeat(redis)).toEqual({ alive: false, count: 0, lastBeatAgoSec: null });
  });
  it('两副本 → alive、count=2、lastBeatAgoSec 取最新心跳', async () => {
    const t1 = new Date(Date.now() - 70_000).toISOString(); // 70s 前
    const t2 = new Date(Date.now() - 10_000).toISOString(); // 10s 前（最新）
    let first = true;
    const redis: any = {
      scan: async () => (first ? ((first = false), ['9', ['hb:1', 'hb:2']]) : ['0', []]),
      mget: async (...keys: string[]) => (keys.length === 2 ? [t1, t2] : []),
    };
    const r = await readWorkerHeartbeat(redis);
    expect(r.alive).toBe(true);
    expect(r.count).toBe(2);
    expect(r.lastBeatAgoSec).toBeGreaterThanOrEqual(9);
    expect(r.lastBeatAgoSec).toBeLessThanOrEqual(12);
  });
});
