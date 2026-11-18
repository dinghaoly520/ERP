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
  /** 编辑时刻打点（TAB-SYNC-01 §4.1 新增；旧格式条目缺省 → 回退所属槽顶层 savedAt）。
   *  注意：新增**内容**字段必须同步 entryContentEquals（stampDraftEntries）与客户端
   *  draft-merge.ts entryEquals——否则只改新字段的编辑不换时戳，newest-wins 会输给同键竞争者。 */
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
    const unchanged = old !== undefined && entryContentEquals(old, v);
    out[k] = { ...v, savedAt: unchanged ? (typeof old.savedAt === 'number' ? old.savedAt : now) : now };
  }
  return out;
}

/**
 * 内容等价（field-wise，键序无关）——T4 审查 Critical 回修：scoreDraft 为 jsonb 列，
 * PG 回读键序归一化（实证 passed 提前于 reason），stringify 比较会把内容等价的回声条目
 * 永久误判为「变更」重打时戳，陈旧回声即可压过真实编辑。字段级比较 + points 点键序无关
 * （逐键取值比对）；passed null≡缺省、awardedScore 数值宽松（'90'≡90）与客户端
 * draft-merge 契约同口径。
 */
function entryContentEquals(a: ScoreEntry, b: ScoreEntry): boolean {
  // 畸形载荷（null/非对象条目）fail 到「变更」侧重打时戳——拒崩不拒写
  if (!a || typeof a !== 'object' || !b || typeof b !== 'object') return false;
  if (Number(a.score) !== Number(b.score)) return false;
  if ((a.reason ?? '') !== (b.reason ?? '')) return false;
  if ((a.passed ?? null) !== (b.passed ?? null)) return false;
  const ap = a.points;
  const bp = b.points;
  if (!ap || !bp) return !ap === !bp;
  const aks = Object.keys(ap);
  if (aks.length !== Object.keys(bp).length) return false;
  for (const pk of aks) {
    const x = ap[pk];
    const y = bp[pk];
    if (!x || !y) return false;
    if (x.checked !== y.checked) return false;
    if (Number(x.awardedScore) !== Number(y.awardedScore)) return false;
    if (((x as { note?: string }).note ?? '') !== ((y as { note?: string }).note ?? '')) return false;
  }
  return true;
}

/**
 * TAB-SYNC-02 ②：陈旧 committed 草稿过滤——提交后旧草稿不再回显提交前旧值。
 *
 * 语义：committed 键存在且草稿有效时戳（per-entry savedAt 缺省回退 fallbackSavedAt=
 * 槽顶层 savedAt，与 mergeDraftSlots effectiveSavedAt 同口径）**<=** 该键提交时刻
 * （BidScoreRecord.updatedAt，服务端钟——④打点后草稿时戳同为服务端钟，比较自洽）
 * → 剔除；严格大于（提交后的新编辑/修正）→ 保留；无 committed 记录 → 保留。
 * 同毫秒视提交前（savedAt==committedAt 剔除）——提交后编辑须严格更新。
 * 客户端半（restore 路径）在 expert-portal lib/draft-merge.ts 同语义双副本，改一处须改两处。
 */
export function filterStaleCommittedEntries(
  entries: Record<string, ScoreEntry>,
  committedAt: Record<string, number>,
  fallbackSavedAt: number,
): { kept: Record<string, ScoreEntry>; droppedKeys: string[] } {
  const kept: Record<string, ScoreEntry> = {};
  const droppedKeys: string[] = [];
  for (const [k, v] of Object.entries(entries)) {
    const at = committedAt[k];
    if (at === undefined) { kept[k] = v; continue; }
    const effective = typeof v?.savedAt === 'number' ? v.savedAt : fallbackSavedAt;
    if (effective <= at) droppedKeys.push(k);
    else kept[k] = v;
  }
  return { kept, droppedKeys };
}
