/**
 * TAB-SYNC-01 §4.1 客户端半：草稿三方合并纯函数（桌面/平板评分页共用，双端 pull 时接线）。
 *
 * 与 Task 1 服务端「双槽逐键取最新 savedAt」配套：服务端把两设备槽合并成远端视图后，
 * 本地仍需以 last-synced 基线判定「谁改过」——只比新旧会丢并发语义。逐键语义
 * （键集 = local ∪ remote）：
 * - 本地未变（无此键 或 ==baseline）且远端有 → 接受远端（静默）
 * - 远端未变（无此键 或 ==baseline）且本地有 → 保留本地（不传播删除）
 * - 双端都偏离 baseline 且值不同 → conflicts（next 保留本地，页面弹窗裁决；
 *   裁决后页面自行同步 next 与 baseline）
 * - 双端都偏离 baseline 但值相同 → 不算冲突、保留本地（自回声：本机刚推的编辑
 *   原样回流；亦覆盖双端恰好改成同值）
 * - 仅 baseline 残留的键（local/remote 都不带）→ 不进 next 也不进新 baseline（死键回收）
 *
 * 返回 baseline = 「本次接受后的快照」——逐键与 next 同值（接受键=远端值、保留/冲突
 * 键=本地值），作为新的 last-synced 基线：后续 pull 与「本设备当前所信」对表，自回声
 * 因此天然无害。next 与 baseline 为两份独立浅拷贝（points 子对象仍共享引用——页面按
 * 不可变更新使用，勿原地改 points）。
 *
 * 深比较用 JSON.stringify 比较内容（条目字段顺序由打点处构造保证），savedAt 不参与
 * 相等——它是编辑时刻元数据而非内容：本机重刷时间戳不算改、双端改成同值（各自打点）
 * 不算冲突；savedAt 的新旧裁决归服务端 Task 1 双槽合并。可选字段显式 undefined 与
 * 缺省视为相等（JSON 序列化天然丢弃 undefined）。
 */

export interface ScoreEntry {
  score: number;
  reason: string;
  passed?: boolean | null;
  points?: Record<string, { checked: boolean; awardedScore: number }>;
  /** 编辑时刻打点（TAB-SYNC-01 §4.1；形状同服务端 score-draft-merge.util.ts） */
  savedAt?: number;
}

export interface DraftMergeConflict {
  key: string;
  local: ScoreEntry;
  remote: ScoreEntry;
}

export interface ThreeWayMergeResult {
  next: Record<string, ScoreEntry>;
  conflicts: DraftMergeConflict[];
  baseline: Record<string, ScoreEntry>;
}

/** 内容稳定深比较（savedAt 剥除；undefined 字段序列化天然丢弃）；任一缺省仅当双侧同缺省视为相等 */
const entryEquals = (a: ScoreEntry | undefined, b: ScoreEntry | undefined): boolean => {
  if (a === undefined || b === undefined) return a === b;
  return JSON.stringify({ ...a, savedAt: undefined }) === JSON.stringify({ ...b, savedAt: undefined });
};

export function threeWayMerge(
  local: Record<string, ScoreEntry>,
  baseline: Record<string, ScoreEntry>,
  remote: Record<string, ScoreEntry>,
): ThreeWayMergeResult {
  const next: Record<string, ScoreEntry> = {};
  const newBaseline: Record<string, ScoreEntry> = {};
  const conflicts: DraftMergeConflict[] = [];

  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[key];
    const r = remote[key];
    const b = baseline[key];

    let accepted: ScoreEntry;
    if (l === undefined) {
      // 本地无此键（远端独有/本地从未写过）→ 接受远端（键来自并集，r 必有）
      accepted = r as ScoreEntry;
    } else if (r === undefined) {
      // 远端无此键（本地独有）→ 保留本地
      accepted = l;
    } else if (entryEquals(l, b)) {
      // 本地未变 → 接受远端
      accepted = r;
    } else if (entryEquals(r, b) || entryEquals(l, r)) {
      // 远端未变，或双端同值（自回声）→ 保留本地、不冲突
      accepted = l;
    } else {
      conflicts.push({ key, local: l, remote: r });
      accepted = l;
    }
    next[key] = { ...accepted };
    newBaseline[key] = { ...accepted };
  }

  return { next, conflicts, baseline: newBaseline };
}
