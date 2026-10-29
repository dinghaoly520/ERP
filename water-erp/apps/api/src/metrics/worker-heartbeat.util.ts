import Redis from 'ioredis';

export const WORKER_HB_PREFIX = 'sys:aiworker:hb:';

export type WorkerHeartbeat = { alive: boolean; count: number; lastBeatAgoSec: number | null };

/** SCAN 心跳键（TTL 90s，过期自动消失）→ 存活副本数 + 最新心跳距今秒数 */
export async function readWorkerHeartbeat(redis: Redis): Promise<WorkerHeartbeat> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${WORKER_HB_PREFIX}*`, 'COUNT', 100);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  if (keys.length === 0) return { alive: false, count: 0, lastBeatAgoSec: null };
  const values = await redis.mget(...keys);
  let newest = 0;
  for (const v of values) {
    const t = v ? Date.parse(v) : NaN;
    if (!Number.isNaN(t) && t > newest) newest = t;
  }
  return {
    alive: newest > 0,
    count: keys.length,
    lastBeatAgoSec: newest > 0 ? Math.max(0, Math.round((Date.now() - newest) / 1000)) : null,
  };
}
