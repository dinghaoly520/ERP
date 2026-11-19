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
 * 深比较为字段级 entryEquals（键序无关——T4 回修审查 Important#1：stringify 对键序敏感，
 * r-vs-b 回声比较跨 jsonb 键序边界假冲突可达），savedAt 不参与相等——它是编辑时刻元数据
 * 而非内容：本机重刷时间戳不算改、双端改成同值（各自打点）不算冲突；savedAt 的新旧裁决
 * 归服务端双槽合并。可选字段显式 undefined 与缺省视为相等（null≡缺省，field-wise 语义）。
 */

export interface ScoreEntry {
  score: number;
  reason: string;
  passed?: boolean | null;
  points?: Record<string, { checked: boolean; awardedScore: number; note?: string }>;
  /** 编辑时刻打点（TAB-SYNC-01 §4.1；形状同服务端 score-draft-merge.util.ts） */
  savedAt?: number;
}

/** 归一后的条目：passed 收窄为 boolean/缺省（评分页本地形状），savedAt 等其余字段保留 */
export type NormalizedScoreEntry = Omit<ScoreEntry, 'passed'> & { passed?: boolean };

/**
 * 服务端草稿形状归一（TAB-SYNC-01）：ScoreEntry.passed 服务端可落 null（数值项天然无
 * 通过性），而评分页本地形状只认 boolean/缺省——深比较走 JSON.stringify，null 与缺省
 * 序列化不同，不归一直接进 threeWayMerge 会把「远端未变」的数值项误判为分歧（假冲突；
 * 桌面端复审 Minor 项，平板端在 merge 输入侧做对）。逐条浅拷贝并剥除 null（undefined
 * 序列化天然丢弃），不原地改入参；savedAt 等其余字段原样保留。next/baseline 输出侧
 * 同用本函数收窄类型（对齐桌面端 toPageScores 的语义）。
 */
export function normalizeDraftEntries(scores: Record<string, ScoreEntry>): Record<string, NormalizedScoreEntry> {
  const out: Record<string, NormalizedScoreEntry> = {};
  for (const [k, v] of Object.entries(scores)) {
    const { passed, ...rest } = v;
    out[k] = passed == null ? rest : { ...rest, passed };
  }
  return out;
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

/**
 * 内容稳定深比较（field-wise，键序无关）。T4 回修审查 Important#1：stringify 比较对键序
 * 敏感，而 r-vs-b 回声比较天然跨 jsonb 边界（远端 GET 回读键序归一化、normalize 只钉
 * passed 位不钉 points/reason 序）——points 条目在双端活跃打分时假冲突可达，误采远端
 * 即丢最新本地编辑。字段级比较与客户端构造序/服务端 jsonb 序均无关；新增内容字段
 * 必须同步本函数（镜像服务端 score-draft-merge.util.ts entryContentEquals——双副本
 * 交叉注释互指，改一处须改两处）。
 */
const entryEquals = (a: ScoreEntry | undefined, b: ScoreEntry | undefined): boolean => {
  if (a === undefined || b === undefined) return a === b;
  if (Number(a.score) !== Number(b.score)) return false;
  if ((a.reason ?? '') !== (b.reason ?? '')) return false;
  if ((a.passed ?? null) !== (b.passed ?? null)) return false;
  const ap = a.points;
  const bp = b.points;
  if (!ap || !bp) return !ap === !bp;
  if (Object.keys(ap).length !== Object.keys(bp).length) return false;
  for (const pk of Object.keys(ap)) {
    const x = ap[pk];
    const y = bp[pk];
    if (!x || !y) return false;
    if (x.checked !== y.checked) return false;
    if (Number(x.awardedScore) !== Number(y.awardedScore)) return false;
    if ((x.note ?? '') !== (y.note ?? '')) return false;
  }
  return true;
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

/**
 * TAB-SYNC-02 ⑤：pull 侧合并封装——双页 onDraftSaved 主体下放（原桌面/平板各一份的手工
 * 副本收敛）。输入侧先把 local/baseline/remoteRaw 统一 normalizeDraftEntries（服务端形状
 * passed=null 剥为缺省——null≠缺省的 JSON.stringify 深比较会整批假冲突），输出侧再归一，
 * 双页从此共用同一语义；conflicts 携带归一后的 local/remote（passed 已收窄为 boolean/缺省，
 * 页面裁决弹窗可直接采纳 remoteVal——勿再加防御性二次归一，那正是双副本漂移的老路）。
 */
export interface PulledMergeDraftResult {
  next: Record<string, NormalizedScoreEntry>;
  baseline: Record<string, NormalizedScoreEntry>;
  conflicts: DraftMergeConflict[];
}

export function mergePulledDraft(
  local: Record<string, ScoreEntry>,
  baseline: Record<string, ScoreEntry>,
  remoteRaw: Record<string, ScoreEntry>,
): PulledMergeDraftResult {
  const merged = threeWayMerge(normalizeDraftEntries(local), normalizeDraftEntries(baseline), normalizeDraftEntries(remoteRaw));
  return {
    next: normalizeDraftEntries(merged.next),
    baseline: normalizeDraftEntries(merged.baseline),
    conflicts: merged.conflicts,
  };
}

/**
 * TAB-SYNC-02 ①：服务端数据落定后的基线推进——**只动服务端提及的键**。
 *
 * 缺陷背景（遗留待办 §三.1 ①）：原「整表重照」`baseline = {...当前 scores}` 会把本地
 * ≤2s 防抖窗/推送失败遗留的未推送编辑烧入基线——此后对端对同键的并发编辑被判
 * 「local==base」而静默接受，本地未推送编辑无声丢失（双端同病）。
 * 语义：serverEntries（committed 记录 / pointDecisions 键）取服务端值为新基线；
 * 未提及键保留旧基线（本地未推送编辑不入基线→并发分歧正确进弹窗）；空提及原引用短路。
 * 注：恢复草稿路径仍是全量重照（恢复=本页新起点，语义不同，见 hook restoreDraft）。
 */
export function advanceBaselineAfterServerData(
  baseline: Record<string, ScoreEntry>,
  serverEntries: Record<string, ScoreEntry>,
): Record<string, ScoreEntry> {
  const keys = Object.keys(serverEntries);
  if (keys.length === 0) return baseline;
  const next = { ...baseline };
  for (const k of keys) next[k] = serverEntries[k];
  return next;
}

/**
 * TAB-SYNC-02 ②客户端副本：陈旧 committed 草稿过滤（restore 路径——localStorage 草稿
 * 不经服务端，须本端过滤）。语义与服务端 score-draft-merge.util.ts
 * filterStaleCommittedEntries 完全一致（双副本交叉注释互指，改一处须改两处）：
 * committed 键 + 有效时戳（per-entry 回退 fallbackSavedAt）<= 提交时刻 → 剔除；
 * 严格大于（提交后新编辑）→ 保留；无记录 → 保留。committedAt 由调用方从
 * project.myScores 的 updatedAt（毫秒）构造。
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
