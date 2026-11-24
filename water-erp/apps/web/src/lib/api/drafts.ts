/** 用户向导草稿（账号维度，跨设备续作）——localStorage 仅作本机离线缓存 */
import { api } from '../api';

export interface DraftPayload { key: string; payload: unknown; updatedAt: string }

export function fetchDraft(key: string) {
  return api.get<DraftPayload | null>(`/drafts/${encodeURIComponent(key)}`);
}

export function saveDraft(key: string, payload: unknown) {
  return api.put<{ savedAt: string }>(`/drafts/${encodeURIComponent(key)}`, { payload });
}

export function deleteDraft(key: string) {
  return api.delete<{ deleted: boolean }>(`/drafts/${encodeURIComponent(key)}`);
}

/** 合并决策（纯函数）：按快照时间戳（_ts/savedAt）取新者——'remote' 采用服务端、'local' 采用本机、
 *  两边皆空/畸形返回 null。时间戳缺失按 0（旧数据）处理，服务端带时间戳即胜出（上云迁移语义）。 */
export function pickNewerDraft(
  remote: unknown,
  local: unknown,
): 'remote' | 'local' | null {
  const r = (remote && typeof remote === 'object' ? remote : null) as Record<string, any> | null;
  const l = (local && typeof local === 'object' ? local : null) as Record<string, any> | null;
  if (!r) return l ? 'local' : null;
  if (!l) return 'remote';
  const remoteAt = Number(r._ts ?? r.savedAt ?? 0);
  const localAt = Number(l._ts ?? l.savedAt ?? 0);
  return remoteAt > localAt ? 'remote' : 'local';
}

/** 恢复合并的取件时限：API 挂死时不得挂起调用方的「打开流程门」——超时按无服务端草稿降级 */
export const DRAFT_RESTORE_TIMEOUT_MS = 6000;

async function fetchDraftWithTimeout(key: string, ms: number): Promise<DraftPayload | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetchDraft(key),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 向导草稿跨设备恢复（账号维度）：服务端草稿与本机缓存按快照时间戳（_ts/savedAt）取新者——
 * 服务端新 → 采用服务端快照（调用方写回本机后照常恢复）；本机新或服务端无记录 → 采用本机并
 * 回写服务端（旧数据一次性上云迁移）。服务端不可达/超时（6s）退化为纯本机（离线可用）。
 * 两边皆空返回 null。**保证不抛错、必定落定**——调用方的「打开流程门/恢复落定门」依赖此契约。
 * 与 supplier/selection 内联实现同语义，抽出供项目管理各向导复用（2026-11-24 跨设备维护）。
 */
export async function restoreSyncedDraft(
  key: string,
  localRaw: string | null,
): Promise<Record<string, any> | null> {
  let local: Record<string, any> | null = null;
  try { local = localRaw ? (JSON.parse(localRaw) as Record<string, any>) : null; } catch { local = null; }
  if (local && typeof local !== 'object') local = null;
  try {
    const remote = await fetchDraftWithTimeout(key, DRAFT_RESTORE_TIMEOUT_MS);
    const rp = (remote?.payload ?? null) as Record<string, any> | null;
    const winner = pickNewerDraft(rp, local);
    if (winner === 'remote' && rp) return rp;
    if (winner === 'local' && local) {
      void saveDraft(key, local).catch(() => {});
      return local;
    }
  } catch { /* 服务端不可达 → 本机缓存离线兜底 */ }
  if (local) void saveDraft(key, local).catch(() => {});
  return local;
}

/** 向导草稿服务端推送（防抖）：本机每次落盘后 push 同一份快照（须自带 _ts/savedAt），
 *  delayMs 内多次变更合并为一次请求；flushNow 供卸载/完成时冲刷防抖中最后一次变更。 */
export function createDraftPusher(key: string, delayMs = 2000) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest: Record<string, any> | null = null;
  const send = () => {
    timer = null;
    if (latest) {
      void saveDraft(key, latest).catch((e) => console.warn('[draft-sync] 服务端草稿推送失败，本机缓存不受影响', key, e?.message ?? e));
    }
  };
  return {
    push(payload: Record<string, any>) {
      latest = payload;
      if (timer) clearTimeout(timer);
      timer = setTimeout(send, delayMs);
    },
    flushNow() {
      if (!timer) return; // 防抖静默期外无待发内容
      clearTimeout(timer);
      send();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      latest = null;
    },
  };
}
