/**
 * W4（CTS-EBS01 A-97/A-98）：服务器标准时钟客户端工具。
 * 客户端本地时间可被随意篡改——截止判断/倒计时统一走 serverNow()。
 * 用法：应用启动或关键组件挂载时 syncServerClock()，之后 new Date() 场景换成 serverNow()。
 * offset 计算：serverTime + rtt/2 - Date.now()（半程往返补偿）。
 */

let offsetMs = 0;
let syncedAt = 0;
let inflight: Promise<void> | null = null;

/** 同步一次服务器时钟（失败静默——退化为本地时间，不阻塞业务）。 */
export function syncServerClock(apiBase = '/api'): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const t0 = Date.now();
      const res = await fetch(`${apiBase}/time`, { cache: 'no-store' });
      const rtt = Date.now() - t0;
      if (!res.ok) return;
      const data = (await res.json()) as { serverTime: number };
      if (typeof data.serverTime === 'number') {
        offsetMs = data.serverTime + Math.floor(rtt / 2) - Date.now();
        syncedAt = Date.now();
      }
    } catch {
      /* 网络异常退化为本地时间 */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 服务器当前时间（未同步时=本地时间）。 */
export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

/** 服务器当前毫秒时间戳。 */
export function serverNowMs(): number {
  return Date.now() + offsetMs;
}

/** 是否已成功同步过（及最近一次同步时刻，0=从未）。 */
export function clockSyncedAt(): number {
  return syncedAt;
}
