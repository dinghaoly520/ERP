/** 核定最少供应商数量（供应商邀请阶段确认闸）：localStorage 本机缓存 + 服务端草稿跨设备同步
 *  （2026-11-24 跨设备维护——设置随账号走，换设备不再回落默认 3） */
import { fetchDraft, saveDraft } from '@/lib/api/drafts';

export const CONFIRM_THRESHOLD_STORAGE_KEY = 'supplier-confirm-threshold';
const SERVER_DRAFT_KEY = 'supplier-confirm-threshold';

export function readConfirmThresholdLocal(): number {
  if (typeof window === 'undefined') return 3;
  const saved = Number(localStorage.getItem(CONFIRM_THRESHOLD_STORAGE_KEY));
  return saved >= 1 && saved <= 50 ? saved : 3;
}

export function writeConfirmThreshold(v: number) {
  try { localStorage.setItem(CONFIRM_THRESHOLD_STORAGE_KEY, String(v)); } catch {}
  void saveDraft(SERVER_DRAFT_KEY, { v, _ts: Date.now() }).catch(() => {});
}

/** 消费面挂载时调一次：服务端设置存在且与本机不同 → 写回本机并返回该值（调用方更新表单态）；
 *  一致/服务端不可达返回 null（本机缓存口径不变，离线可用）。 */
export async function syncConfirmThresholdFromServer(): Promise<number | null> {
  try {
    const d = await fetchDraft(SERVER_DRAFT_KEY);
    const v = Number((d?.payload as { v?: number } | null)?.v);
    if (!(v >= 1 && v <= 50)) return null;
    if (v !== readConfirmThresholdLocal()) {
      try { localStorage.setItem(CONFIRM_THRESHOLD_STORAGE_KEY, String(v)); } catch {}
      return v;
    }
    return null;
  } catch { return null; }
}
