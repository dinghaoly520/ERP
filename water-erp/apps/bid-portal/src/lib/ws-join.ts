import type { Socket } from 'socket.io-client';

/** join:project 的应答：成功为 { ok: true, … }，被拒为 { error: <原因> } */
export interface JoinAck {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface JoinProjectOptions {
  /** 含首次在内最多发几次 */
  attempts?: number;
  /** 首次重试前的等待毫秒数，逐次翻倍 */
  baseDelayMs?: number;
  /** 每次等应答的毫秒数 */
  ackTimeoutMs?: number;
  /** 返回 true 表示这条连接已不是当前连接（重连 / 切项目 / 手动关闭），立即停止 */
  isStale?: () => boolean;
  /** 等待函数，测试里替换成立即完成 */
  sleep?: (ms: number) => Promise<void>;
}

/** hook 侧策略需要的上下文 */
export interface JoinPolicyDeps {
  /** 这条连接是否仍是当前连接 */
  isCurrent: () => boolean;
  /** 连续入会失败次数（跨重连累计，成功清零） */
  getFailStreak: () => number;
  setFailStreak: (n: number) => void;
  /** 停止自动重连 */
  stopReconnect: () => void;
}

/** 连续这么多次连接都没能入会，就停止自动重连 */
export const JOIN_MAX_CONSECUTIVE_FAILURES = 3;

/** 客户端自己调用 disconnect() 时 socket.io 报的断开原因 */
const CLIENT_DISCONNECT_REASON = 'io client disconnect';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 记一次连续入会失败；满额则要求停止自动重连 */
function countJoinFailure(deps: JoinPolicyDeps): void {
  const streak = deps.getFailStreak() + 1;
  deps.setFailStreak(streak);
  if (streak >= JOIN_MAX_CONSECUTIVE_FAILURES) deps.stopReconnect();
}

function emitOnce(socket: Socket, projectId: string, ackTimeoutMs: number): Promise<JoinAck> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve({ error: 'JOIN_TIMEOUT' }); }
    }, ackTimeoutMs);
    socket.emit('join:project', projectId, (ack: JoinAck | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ack ?? { error: 'JOIN_TIMEOUT' });
    });
  });
}

/**
 * 加入项目房间；应答为 UNAUTHORIZED 时重试（2026-11-25 入会竞态修复）。
 * UNAUTHORIZED 多半是入会申请比服务端的握手鉴权先到——稍后重发即可成功。
 * 其他应答（成功或业务性拒绝）原样返回，不重试。
 */
export async function joinProjectWithRetry(socket: Socket, projectId: string, options: JoinProjectOptions = {}): Promise<JoinAck> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 150;
  const ackTimeoutMs = options.ackTimeoutMs ?? 5000;
  const wait = options.sleep ?? sleep;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (options.isStale?.()) return { error: 'JOIN_ABORTED' };
    const ack = await emitOnce(socket, projectId, ackTimeoutMs);
    if (ack.error !== 'UNAUTHORIZED' || attempt === attempts - 1) return ack;
    await wait(baseDelayMs * 2 ** attempt);
  }
  return { error: 'JOIN_ABORTED' }; // 循环内必然已返回，这里只为类型完整
}

/** hook 在连接成功后调用：入会、必要时重试，并按结果决定是否断开重连。返回 true 仅当这条连接入会成功 */
export async function joinProjectOnConnect(socket: Socket, projectId: string, deps: JoinPolicyDeps, options: JoinProjectOptions = {}): Promise<boolean> {
  const ack = await joinProjectWithRetry(socket, projectId, { ...options, isStale: () => !deps.isCurrent() });
  if (!deps.isCurrent()) return false; // 迟到的应答：连接已被替换，结果作废
  if (ack.ok) { deps.setFailStreak(0); return true; }
  if (ack.error === 'UNAUTHORIZED' || ack.error === 'JOIN_TIMEOUT') {
    countJoinFailure(deps);
    socket.disconnect(); // 走 hook 既有的 disconnect → 重连路径
    return false;
  }
  console.warn('[ws] join:project 被拒', ack.error);
  return false;
}

/**
 * hook 在连接断开时调用：给「连上了、却没入会成功就被断开」的连接记一次入会失败，
 * 满 JOIN_MAX_CONSECUTIVE_FAILURES 次要求停止自动重连。
 * 会话真正失效（被顶、登出、冻结）时服务端在握手鉴权里直接断开、不给入会应答——
 * 应答那条路（joinProjectOnConnect）看不到这种失败，只有这里看得到。
 * 客户端自己断开的不计：入会未授权、超时已经在那里记过。
 */
export function onDisconnectedBeforeJoin(joined: boolean, reason: string, deps: JoinPolicyDeps): void {
  if (joined || reason === CLIENT_DISCONNECT_REASON) return;
  countJoinFailure(deps);
}
