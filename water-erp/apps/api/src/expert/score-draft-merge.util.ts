/**
 * TAB-SYNC-01 §4.1：评分草稿双槽合并——逐键取最新 savedAt（替代旧「本设备槽整槽优先」）。
 *
 * 旧缺陷（2026-11-12 二轮代码走查）：本设备槽优先合并 × 自动保存从全量 state 构建草稿
 * 产生回声——对端经 WS 合并进来的键 2s 后被写进本设备自己的槽，此后同键被双端各改一次
 * 即永久静默分叉、互不可见。修正语义：
 * - 条目带 per-entry `savedAt`（编辑时刻打点；跨设备合并拷贝保留原值——回声从此无害）
 * - 逐键取两槽中有效 savedAt 新者；条目无 savedAt → 回退所属槽顶层 savedAt；
 *   相等 → device 侧槽优先 tiebreak；顶层 savedAt = 两槽 max
 * - 旧扁平格式（无 device 分槽、`raw.scores` 直接存在）→ 原样返回（照抄旧 getScoreDraft 语义）
 */

export interface ScoreEntry {
  score: number;
  reason: string;
  passed?: boolean | null;
  points?: Record<string, { checked: boolean; awardedScore: number }>;
  /** 编辑时刻打点（TAB-SYNC-01 §4.1 新增；旧格式条目缺省 → 回退所属槽顶层 savedAt） */
  savedAt?: number;
}

export interface MergedScoreDraft {
  scores: Record<string, ScoreEntry>;
  savedAt: number;
}

interface DraftSlot {
  scores: Record<string, ScoreEntry>;
  savedAt: number;
}

/** 槽读取容错：缺槽/空槽归一为 {scores:{}, savedAt:0}，槽级 savedAt 非数字按 0 */
const readSlot = (slot: unknown): DraftSlot => {
  const s = (slot ?? {}) as { scores?: unknown; savedAt?: unknown };
  return {
    scores:
      s.scores && typeof s.scores === 'object' ? (s.scores as Record<string, ScoreEntry>) : {},
    savedAt: typeof s.savedAt === 'number' ? s.savedAt : 0,
  };
};

/** 条目有效时间戳：per-entry savedAt 优先；缺省回退所属槽顶层 savedAt；再缺省 0 */
const effectiveSavedAt = (entry: ScoreEntry | undefined, slotSavedAt: number): number =>
  typeof entry?.savedAt === 'number' ? entry.savedAt : slotSavedAt;

export function mergeDraftSlots(
  raw: unknown,
  device?: 'tablet' | 'desktop',
): MergedScoreDraft | null {
  const r = (raw ?? {}) as { tablet?: unknown; desktop?: unknown; scores?: unknown };
  // 兼容旧扁平格式（无 device 分槽）：raw.scores 直接存在 → 原样返回；否则视为无草稿
  if (typeof r.tablet !== 'object' && typeof r.desktop !== 'object') {
    if (typeof r.scores === 'object') return r as unknown as MergedScoreDraft; // 旧格式直接返回（savedAt 可缺省）
    return null;
  }
  // 新格式：逐键取有效 savedAt 新者（相等 → device 侧槽优先）
  const own = readSlot(device === 'tablet' ? r.tablet : r.desktop);
  const other = readSlot(device === 'tablet' ? r.desktop : r.tablet);
  const scores: Record<string, ScoreEntry> = {};
  for (const key of new Set([...Object.keys(other.scores), ...Object.keys(own.scores)])) {
    const ownEntry = own.scores[key];
    const otherEntry = other.scores[key];
    if (otherEntry === undefined) {
      scores[key] = ownEntry;
    } else if (ownEntry === undefined) {
      scores[key] = otherEntry;
    } else {
      scores[key] =
        effectiveSavedAt(ownEntry, own.savedAt) >= effectiveSavedAt(otherEntry, other.savedAt)
          ? ownEntry
          : otherEntry;
    }
  }
  return { scores, savedAt: Math.max(own.savedAt, other.savedAt) };
}

/**
 * TAB-SYNC-02 ④：服务端逐键打点——savedAt 以服务器钟为唯一权威（跨设备时钟偏差下
 * 「慢钟 iPad 整场单向失步」根治：客户端 Date.now 只当建议值，落库前重打）。
 *
 * 语义（回声无害化，与客户端 draft-merge entryEquals 同构）：
 * - 与本设备槽既有同键条目**内容相等**（savedAt 剥除比较）→ 保留原 savedAt——对端
 *   合并拷贝来的回声条目重发不算编辑，不得刷新时戳制造假最新；
 * - 内容变更 / 本槽新键 → 打服务器 now（含首次收编对端条目：其客户端时戳被归一为
 *   服务器钟，原始时戳仍存于对端自己槽内，合并取新不受影响——内容相同时取哪个都等价）。
 * - existingSlot 为旧扁平/畸形形状 → 全部键视为新键打点（fail-open 到打点，不拒写）。
 */
export function stampDraftEntries(
  incoming: Record<string, ScoreEntry>,
  existingSlot: unknown,
  now: number = Date.now(),
): Record<string, ScoreEntry> {
  const prev = readSlot(existingSlot);
  const out: Record<string, ScoreEntry> = {};
  for (const [k, v] of Object.entries(incoming)) {
    const old = prev.scores[k];
    const unchanged =
      old !== undefined &&
      JSON.stringify({ ...old, savedAt: undefined }) === JSON.stringify({ ...v, savedAt: undefined });
    out[k] = { ...v, savedAt: unchanged ? (typeof old.savedAt === 'number' ? old.savedAt : now) : now };
  }
  return out;
}
