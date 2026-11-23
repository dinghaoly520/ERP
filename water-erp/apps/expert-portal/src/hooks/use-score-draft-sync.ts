'use client';

/**
 * TAB-SYNC-02 ⑤：评分草稿双端同步 hook——桌面 `(app)/evaluate/[id]` 与平板
 * `(tablet)/tablet/evaluate/[id]` 两页草稿机制的手工双副本收敛（2026-11-18）。
 *
 * 本 hook 是两页既有逻辑的**纯搬迁**（原 buildPendingDraft / buildPendingTabletDraft /
 * onDraftSaved / autosave / draft 检查 / restore / discard / saveDraftNow / beforeunload /
 * 切步落盘），语义基线=2026-11-13 三方合并波（06ce1fa3f/cfc0ffa8c/00fa7e72f）。
 * 统一点（行为等价的双写形态收敛，非行为变更）：
 * - pull 合并主体走 mergePulledDraft（输入/输出双侧归一）——桌面原 toPageScores 已删
 *   （与 normalizeDraftEntries 语义等价：仅 passed null→缺省收窄）。
 * - 平板 serverDraft 检查态删除：restore 无本地草稿时现拉 GET（原为检查时缓存，等价）。
 * - autosave 空 scores 早退（桌面既有守卫；平板原形态会对空表多发一次空清 POST——统一消除）。
 *
 * 页面职责边界：项目数据加载（loadProject/loadMyScores）留在页面，经
 * advanceBaselineAfterServerData 精确推进基线（TAB-SYNC-02 ①：仅服务端提及键）；
 * 冲突裁决弹窗留在页面，经 setBaselineEntries 同步被采纳键的基线。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { isPassFailCategory } from '@water-erp/shared';
import type { DraftSavedPayload } from '@water-erp/shared';
import { api } from '@/lib/api';
import {
  buildPendingScoreDraft,
  buildFullPoints,
  committedRecordFor,
  type ScoreEntry,
  type CommittedScoreRecord,
} from '@/lib/score-validation';
import { mergePulledDraft, advanceBaselineAfterServerData as advanceBaselineOnServerKeys, filterStaleCommittedEntries, normalizeDraftEntries, type ScoreEntry as DraftScoreEntry } from '@/lib/draft-merge';

/** 页面冲突裁决弹窗的条目形状（双页原 inline 类型收敛） */
export interface DraftSyncConflict {
  key: string;
  scoreItemName: string;
  localVal: ScoreEntry;
  remoteVal: ScoreEntry;
}

/** 评分项的同步视图形状——由 buildPendingScoreDraft/buildFullPoints 消费方签名推导（含 name 供冲突条目映射） */
export type SyncScoreItem = NonNullable<Parameters<typeof buildPendingScoreDraft>[2]>[number] & { name?: string };

export interface UseScoreDraftSyncOptions {
  projectId: string;
  /** project.myExpertRecord.id——未加载时为 undefined（草稿检查挂起） */
  expertId?: string;
  device: 'desktop' | 'tablet';
  /** 桌面 = step === 'scoring'（打分步外不自动保存/切步落盘）；平板恒 true */
  active: boolean;
  /** 草稿检查前置条件（平板需 project 已加载——restore 防御归一依赖 scoreItems）；桌面缺省 true */
  checkReady?: boolean;
  scores: Record<string, ScoreEntry>;
  setScores: React.Dispatch<React.SetStateAction<Record<string, ScoreEntry>>>;
  scoreItems: SyncScoreItem[];
  myScores: CommittedScoreRecord[];
  conflictModalOpen: boolean;
  draftConflicts: DraftSyncConflict[];
  setDraftConflicts: React.Dispatch<React.SetStateAction<DraftSyncConflict[]>>;
}

export function useScoreDraftSync(options: UseScoreDraftSyncOptions) {
  const {
    projectId, expertId, device, active, checkReady = true,
    scores, setScores, scoreItems, myScores,
    conflictModalOpen, draftConflicts, setDraftConflicts,
  } = options;

  const storagePrefix = device === 'tablet' ? 'expert-draft-tablet' : 'expert-draft';
  const draftStorageKey = expertId ? `${storagePrefix}:${projectId}:${expertId}` : '';

  const [draftAvailable, setDraftAvailable] = useState<{ count: number; savedAt: number } | null>(null);
  const [draftDismissed, setDraftDismissed] = useState(false);
  // 草稿检查完成前暂停自动保存，避免挂载时以空值或旧 scores 覆盖待恢复草稿
  const [draftCheckDone, setDraftCheckDone] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // B4（2026-11-19 残留收口）：防抖自动保存 POST 的中断控制器——提交成功清槽时撤走在途
  // 请求（timer 已清但在途 fetch 落地会以 stale pending 重推已提交键 → ②过滤被穿透复活幽灵横幅）
  const autosaveAbortRef = useRef<AbortController | null>(null);
  // 未落盘评分改动标记（断点续评加固）：驱动 beforeunload 原生防误关
  const [hasUnflushed, setHasUnflushed] = useState(false);
  const unflushedRef = useRef(false);

  // scoresRef 恒随最新 scores（三方合并拉取须读当前值而非事件闭包快照；beforeunload 同步补写同源）
  const scoresRef = useRef<Record<string, ScoreEntry>>({});
  useEffect(() => { scoresRef.current = scores; }, [scores]);

  // TAB-SYNC-01 §4.1 last-synced 基线：草稿三方合并的「本页起点」。savedAt 不参与内容相等
  // （draft-merge 契约）。推进点：push 成功（advanceBaselineAfterPush）、pull 接受、
  // 服务端数据落定（advanceBaselineAfterServerData，仅提及键）、冲突裁决（setBaselineEntries）。
  const baselineRef = useRef<Record<string, DraftScoreEntry>>({});

  // ── 草稿检查（挂载/换项目一次）：localStorage 快路径 → 服务端槽 fallback ──
  const draftCheckedKeyRef = useRef('');
  useEffect(() => {
    if (!draftStorageKey || !checkReady) return;
    // once-guard 按 storageKey：同键不复查（平板原 A2 守卫；桌面原 deps-only 形态等价）
    if (draftCheckedKeyRef.current === draftStorageKey) return;
    draftCheckedKeyRef.current = draftStorageKey;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (raw) {
        const draft = JSON.parse(raw) as { scores: Record<string, ScoreEntry>; savedAt: number };
        const count = Object.keys(draft.scores || {}).length;
        // A1：无论有无草稿都置位，解除自动保存悬置（React 18 自动批处理）
        if (count > 0) { setDraftAvailable({ count, savedAt: draft.savedAt }); setDraftCheckDone(true); return; }
      }
    } catch { /* corrupt draft — ignore（本地损坏走服务端 fallback） */ }
    api.get<{ scores: Record<string, DraftScoreEntry>; savedAt?: number }>(`/expert/projects/${projectId}/score-draft?device=${device}`)
      .then(d => {
        setDraftCheckDone(true);
        if (d && d.scores && Object.keys(d.scores).length > 0) {
          setDraftAvailable({ count: Object.keys(d.scores).length, savedAt: d.savedAt ?? Date.now() });
        }
      })
      .catch(() => { setDraftCheckDone(true); });
  }, [draftStorageKey, checkReady, projectId, device]);

  // pending-only 草稿构建（原双页 buildPendingDraft / buildPendingTabletDraft 收敛到纯函数）
  const buildPending = useCallback(
    (source: Record<string, ScoreEntry>): Record<string, ScoreEntry> =>
      buildPendingScoreDraft(source, myScores, scoreItems),
    [myScores, scoreItems],
  );

  // TAB-SYNC-01（T8 接线契约①）：推送成功后对「本次推送的键」推进 baseline——推送值即双端
  // 共同所见，不推进则对端后续对同键的编辑会被误判为双端分歧（假冲突）。只并入本端推送键、
  // 不整表重拉（GET score-draft 是双槽逐键取新的合并视图，整表提基线会把对端未拉取合并的
  // 新值提为基线、随后判其「远端未变」而静默丢弃对端编辑）。有未裁决冲突时跳过（T8 契约②）。
  const advanceBaselineAfterPush = useCallback((pending: Record<string, ScoreEntry>) => {
    if (conflictModalOpen || draftConflicts.length > 0) return;
    for (const [k, v] of Object.entries(pending)) baselineRef.current[k] = v as DraftScoreEntry;
  }, [conflictModalOpen, draftConflicts.length]);

  /**
   * TAB-SYNC-02 ①：服务端数据落定后的基线推进——只动服务端提及的键（committed 记录 /
   * pointDecisions 键取服务端值），未提及键保留旧基线。原「整表重照」会把本地未推送编辑
   * 烧入基线、吞并发对端编辑（遗留待办 §三.1 ①，已废止）。恢复草稿路径仍是全量重照
   * （恢复=本页新起点，语义不同，见 restoreDraft）。
   */
  const advanceBaselineAfterServerData = useCallback((serverEntries: Record<string, ScoreEntry>) => {
    baselineRef.current = advanceBaselineOnServerKeys(baselineRef.current, serverEntries as Record<string, DraftScoreEntry>);
  }, []);

  /** 冲突裁决：被采纳（remote）键成为该键新基线——对端后续同键编辑不再误报冲突 */
  const setBaselineEntries = useCallback((entries: Record<string, ScoreEntry>) => {
    for (const [k, v] of Object.entries(entries)) baselineRef.current[k] = v as DraftScoreEntry;
  }, []);

  // ── 自动暂存（2s 防抖；打分步外挂起）──
  useEffect(() => {
    if (!draftStorageKey || !active) return;
    // 草稿检查未完成或仍有待处理草稿横幅时暂停自动保存（防以空/旧 scores 覆写待恢复草稿）；
    // 悬置期间清掉已排定的定时器（A3）
    if (!draftCheckDone || draftAvailable !== null) {
      if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
      return;
    }
    if (Object.keys(scores).length === 0) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    unflushedRef.current = true;
    setHasUnflushed(true);
    draftTimer.current = setTimeout(() => {
      unflushedRef.current = false;
      setHasUnflushed(false);
      const pending = buildPending(scores);
      if (Object.keys(pending).length === 0) {
        // 全部等价已提交：主动清理幽灵草稿（本地 + 服务端槽），下次进入不再出现误导横幅
        try { localStorage.removeItem(draftStorageKey); } catch { /* private mode — ignore */ }
        api.post(`/expert/projects/${projectId}/score-draft?device=${device}`, { scores: {}, savedAt: Date.now() }).catch(() => {});
        return;
      }
      try {
        localStorage.setItem(draftStorageKey, JSON.stringify({ scores: pending, savedAt: Date.now() }));
      } catch { /* quota / private mode — ignore */ }
      // B4：自动保存 POST 可中断（AbortController）——提交清槽时撤走在途请求
      const ac = new AbortController();
      autosaveAbortRef.current = ac;
      api.post(`/expert/projects/${projectId}/score-draft?device=${device}`, { scores: pending, savedAt: Date.now() }, { signal: ac.signal })
        .then(() => advanceBaselineAfterPush(pending))
        .catch(() => {})
        .finally(() => { if (autosaveAbortRef.current === ac) autosaveAbortRef.current = null; });
    }, 2000);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
  }, [scores, draftStorageKey, active, projectId, device, draftAvailable, draftCheckDone, buildPending, advanceBaselineAfterPush]);

  // ── 切离打分步（active true→false）：防抖窗口内的最后改动立即落盘 ──
  const prevActiveRef = useRef(active);
  useEffect(() => {
    if (prevActiveRef.current && !active && unflushedRef.current && draftStorageKey) {
      const pending = buildPending(scoresRef.current);
      if (Object.keys(pending).length > 0) {
        try {
          localStorage.setItem(draftStorageKey, JSON.stringify({ scores: pending, savedAt: Date.now() }));
        } catch { /* quota — ignore */ }
        api.post(`/expert/projects/${projectId}/score-draft?device=${device}`, { scores: pending, savedAt: Date.now() })
          .then(() => advanceBaselineAfterPush(pending))
          .catch(() => {});
      }
      unflushedRef.current = false;
      setHasUnflushed(false);
    }
    prevActiveRef.current = active;
  }, [active, draftStorageKey, projectId, device, buildPending, advanceBaselineAfterPush]);

  // ── 防误关：评分有未落盘改动时关页/刷新弹浏览器原生确认；离开前同步补写 localStorage ──
  useEffect(() => {
    if (!hasUnflushed) return;
    const flushLocalSync = () => {
      if (!unflushedRef.current || !draftStorageKey) return;
      const pending = buildPending(scoresRef.current);
      if (Object.keys(pending).length === 0) return;
      try {
        localStorage.setItem(draftStorageKey, JSON.stringify({ scores: pending, savedAt: Date.now() }));
      } catch { /* quota — ignore */ }
    };
    const handler = (e: BeforeUnloadEvent) => {
      if (!active || !unflushedRef.current) return;
      flushLocalSync();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnflushed, draftStorageKey, active, buildPending]);

  // ── 恢复：localStorage → 服务端槽 fallback；防御归一后合并入当前 scores 并重建基线 ──
  /** 防御归一：存量部分映射草稿补全为完整映射（缺失点按 passed/提交分回退）；
   *  通过性项缺 passed 时从客观分点重导（否则恢复后勾选全亮、项头却「未评」） */
  const normalizeRestoreEntries = useCallback((draftScores: Record<string, DraftScoreEntry>): Record<string, ScoreEntry> => {
    const norm: Record<string, ScoreEntry> = {};
    for (const [k, v] of Object.entries(draftScores)) {
      const [sid, itemId] = k.split(':');
      const si = scoreItems.find(s => s.id === itemId);
      const committedScore = committedRecordFor(myScores, sid, itemId)?.score ?? null;
      const hasPartialPoints = v.points && Object.keys(v.points).length > 0;
      if (!(si && hasPartialPoints)) { norm[k] = v as ScoreEntry; continue; }
      const points = buildFullPoints(si, v as ScoreEntry, committedScore);
      let passed = v.passed;
      if (typeof passed !== 'boolean' && isPassFailCategory(si.category)) {
        const objectivePts = (si.points ?? []).filter(p => p.objective);
        if (objectivePts.length > 0) passed = objectivePts.every(p => points[p.id]?.checked === true);
      }
      norm[k] = { ...v, points, ...(typeof passed === 'boolean' ? { passed } : {}) } as ScoreEntry;
    }
    return norm;
  }, [scoreItems, myScores]);

  const restoreDraft = useCallback(async () => {
    if (!draftStorageKey) return;
    let draft: { scores: Record<string, DraftScoreEntry>; savedAt?: number } | null = null;
    let fromServer = false;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (raw) draft = JSON.parse(raw);
    } catch { toast.error('草稿已损坏，无法恢复'); }
    // A5：localStorage 无草稿时回退服务端槽
    if (!draft || Object.keys(draft.scores || {}).length === 0) {
      try {
        const d = await api.get<{ scores: Record<string, DraftScoreEntry>; savedAt?: number }>(`/expert/projects/${projectId}/score-draft?device=${device}`);
        if (d && d.scores && Object.keys(d.scores).length > 0) { draft = { scores: d.scores, savedAt: d.savedAt ?? Date.now() }; fromServer = true; }
      } catch { /* ignore */ }
    }
    if (!draft || Object.keys(draft.scores || {}).length === 0) {
      toast.info('没有可恢复的草稿');
      setDraftAvailable(null);
      setDraftDismissed(true);
      return;
    }
    // TAB-SYNC-02 ②：陈旧 committed 过滤（客户端半——localStorage 草稿不经服务端）：
    // 提交时刻之前的条目剔除，恢复不再回显提交前旧值；全陈旧 → 横幅就地消除
    const committedAtRestore: Record<string, number> = {};
    for (const rec of myScores) {
      const at = rec.updatedAt != null ? new Date(rec.updatedAt).getTime() : NaN;
      if (Number.isFinite(at)) committedAtRestore[`${rec.supplierId}:${rec.scoreItemId}`] = at;
    }
    const filtered = filterStaleCommittedEntries(draft.scores, committedAtRestore, draft.savedAt ?? 0);
    if (Object.keys(filtered.kept).length === 0) {
      toast.info('草稿均已随评分提交，无需恢复');
      setDraftAvailable(null);
      setDraftDismissed(true);
      return;
    }
    const norm = normalizeRestoreEntries(filtered.kept);
    // TAB-SYNC-01：恢复落定即本页起点——以合并后快照初始化 last-synced 基线
    const merged = { ...scoresRef.current, ...norm };
    setScores(merged);
    baselineRef.current = { ...merged } as Record<string, DraftScoreEntry>;
    toast.success(fromServer ? `已从保存的草稿恢复 ${Object.keys(norm).length} 项评分` : `已恢复 ${Object.keys(norm).length} 项评分`);
    setDraftAvailable(null);
    setDraftDismissed(true);
  }, [draftStorageKey, projectId, device, normalizeRestoreEntries, setScores]);

  const discardDraft = useCallback(() => {
    if (draftStorageKey) { try { localStorage.removeItem(draftStorageKey); } catch { /* ignore */ } }
    // 报告确认后草稿端点对空清载荷豁免锁定——丢弃同时清服务端本机槽
    api.post(`/expert/projects/${projectId}/score-draft?device=${device}`, { scores: {}, savedAt: Date.now() }).catch(() => {});
    setDraftAvailable(null);
    setDraftDismissed(true);
  }, [draftStorageKey, projectId, device]);

  /** 手动保存（桌面专用按钮/就地打分即时落盘入口）；有待恢复草稿横幅时禁止 */
  const saveDraftNow = useCallback((snapshot?: Record<string, ScoreEntry>) => {
    if (!draftStorageKey) return;
    if (draftAvailable !== null) {
      toast.warning('有未处理的评分草稿，请先恢复或丢弃');
      return;
    }
    unflushedRef.current = false;
    setHasUnflushed(false);
    const pending = buildPending(snapshot ?? scores);
    if (Object.keys(pending).length === 0) {
      // 全部等价已提交：清空而非新写
      try { localStorage.removeItem(draftStorageKey); } catch { /* quota — ignore */ }
      api.post(`/expert/projects/${projectId}/score-draft?device=${device}`, { scores: {}, savedAt: Date.now() }).catch(() => {});
      return;
    }
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify({ scores: pending, savedAt: Date.now() }));
    } catch { /* quota — ignore */ }
    api.post(`/expert/projects/${projectId}/score-draft?device=${device}`, { scores: pending, savedAt: Date.now() })
      .then(() => { advanceBaselineAfterPush(pending); toast.success('草稿已保存，可换设备继续评审'); })
      .catch(() => toast.success('草稿已保存在本机（未同步）'));
  }, [draftStorageKey, projectId, device, draftAvailable, scores, buildPending, advanceBaselineAfterPush]);

  /** 提交评分成功后横幅清除（原页面 setDraftAvailable(null)） */
  const clearDraftBanner = useCallback(() => {
    setDraftAvailable(null);
  }, []);

  /**
   * T5 审查 Minor#1 回修：取消已排定的防抖自动保存——提交评分成功后必须先调本函数再清槽，
   * 否则 armed timer 以 stale myScores 重推刚提交的供应商键（stampDraftEntries 视作新键打
   * 服务器钟 > updatedAt），② 过滤被穿透、复活出「检测到未提交草稿」幽灵横幅。
   * B4（2026-11-19）：timer 已清但 POST 在途的毫秒窗竞态同收——abort 撤走在途请求
   * （服务端已收包的极端窗仍可能落地，属化妆性残留——值与提交值相同，见遗留待办 B4 注记）。
   */
  const cancelPendingAutosave = useCallback(() => {
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
    autosaveAbortRef.current?.abort();
    autosaveAbortRef.current = null;
    unflushedRef.current = false;
    setHasUnflushed(false);
  }, []);

  // ── WS pull：对方设备保存草稿 → 拉取 + 三方合并（mergePulledDraft 双侧归一）──
  const onDraftSaved = useCallback((d: DraftSavedPayload) => {
    if (d.device === device) return;
    // 跨专家噪音过滤：draft:saved 按项目房间广播，只响应本人草稿
    if (!expertId || d.expertId !== expertId) return;
    // TAB-SYNC-01（T8 接线契约②）：冲突未裁决期间暂停拉取合并——冲突键 baseline 已前移到
    // local，此时拉取会把同一远端分歧静默接受为「远端未变」
    if (conflictModalOpen || draftConflicts.length > 0) return;
    // TAB-SYNC-02 ⑥：横幅期暂停门（与 autosave 同口径）——草稿检查未完成或待恢复横幅挂着
    // 时拉取仍会 setScores+推进 baseline，旧草稿恢复与新远端值互踩（恢复值可被横幅期拉取
    // 覆盖；横幅消失后首个 pull 再补拉，不丢数据）
    if (!draftCheckDone || draftAvailable !== null) return;
    api.get<{ scores: Record<string, DraftScoreEntry>; savedAt?: number }>(`/expert/projects/${projectId}/score-draft?device=${device}`)
      .then(draft => {
        if (!draft?.scores) return;
        const result = mergePulledDraft(scoresRef.current as Record<string, DraftScoreEntry>, baselineRef.current, draft.scores);
        const nextScores = result.next as unknown as Record<string, ScoreEntry>;
        setScores(prev => {
          let changed = false;
          for (const k of new Set([...Object.keys(prev), ...Object.keys(nextScores)])) {
            if (JSON.stringify(prev[k]) !== JSON.stringify(nextScores[k])) { changed = true; break; }
          }
          return changed ? nextScores : prev;
        });
        baselineRef.current = result.baseline as Record<string, DraftScoreEntry>;
        if (result.conflicts.length > 0) {
          const conflicts: DraftSyncConflict[] = result.conflicts.map(c => ({
            key: c.key,
            scoreItemName: scoreItems.find(si => c.key.endsWith(`:${si.id}`))?.name ?? c.key,
            localVal: c.local as unknown as ScoreEntry,
            remoteVal: c.remote as unknown as ScoreEntry,
          }));
          setDraftConflicts(prev => [...prev, ...conflicts]);
        }
      })
      .catch(() => { /* pull optional — ignore */ });
  }, [device, expertId, projectId, conflictModalOpen, draftConflicts.length, draftCheckDone, draftAvailable, scoreItems, setDraftConflicts, setScores]);

  return {
    draftAvailable,
    draftDismissed,
    draftCheckDone,
    hasUnflushed,
    onDraftSaved,
    restoreDraft,
    discardDraft,
    saveDraftNow,
    clearDraftBanner,
    cancelPendingAutosave,
    advanceBaselineAfterServerData,
    setBaselineEntries,
  };
}
