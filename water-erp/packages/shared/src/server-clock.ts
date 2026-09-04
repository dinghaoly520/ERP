/**
 * W4（CTS-EBS01 A-97/A-98）：服务器标准时钟客户端工具。
 * 客户端本地时间可被随意篡改——截止判断/倒计时统一走 serverNow()。
 * 用法：应用启动或关键组件挂载时 syncServerClock()，之后 new Date() 场景换成 serverNow()。
 * 同步后以 performance.now() 单调时钟推进，避免用户再次修改系统时间导致截止状态跳变。
 */

let offsetMs = 0;
let syncedAt = 0;
let inflight: Promise<void> | null = null;
let serverEpochAtSync = 0;
let monotonicAtSync = 0;

function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** 同步一次服务器时钟（失败静默——退化为本地时间，不阻塞业务）。 */
export function syncServerClock(apiBase = '/api'): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const t0 = monotonicNow();
      const res = await fetch(`${apiBase}/time`, { cache: 'no-store' });
      const rtt = Math.max(0, monotonicNow() - t0);
      if (!res.ok) return;
      const data = (await res.json()) as { serverTime: number };
      if (typeof data.serverTime === 'number') {
        const wallNow = Date.now();
        serverEpochAtSync = data.serverTime + Math.floor(rtt / 2);
        monotonicAtSync = monotonicNow();
        offsetMs = serverEpochAtSync - wallNow;
        syncedAt = wallNow;
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
  return new Date(serverNowMs());
}

/** 服务器当前毫秒时间戳。 */
export function serverNowMs(): number {
  if (serverEpochAtSync > 0 && typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return serverEpochAtSync + Math.max(0, performance.now() - monotonicAtSync);
  }
  return Date.now() + offsetMs;
}

/** 是否已成功同步过（及最近一次同步时刻，0=从未）。 */
export function clockSyncedAt(): number {
  return syncedAt;
}
