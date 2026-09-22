'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, AlertTriangle, Clock, Lock, Check, CheckCircle, Clipboard, Gavel, Sparkles, ShieldAlert } from 'lucide-react';
import { api, listMemos } from '@/lib/api';
import { HelpTip } from '@/components/help-tip';
import { SigninCamera } from '@/components/signin-camera';
import {
  CATEGORY_COLOR, CATEGORY_LABEL, isPassFailCategory, DECRYPT_LABEL,
} from '@water-erp/shared';
import type { ExpertProjectDetail } from '@/lib/types';
import { buildFullPoints, committedRecordFor, isCommittedEquivalent, type ScoreEntry } from '@/lib/score-validation';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { SupplierTabBar } from '@/components/evaluate/supplier-tab-bar';
import { PointChecklistScoring, type PointDecisionValue } from '@/components/evaluate/point-checklist-scoring';
import { MemoPanel } from '@/components/memo/memo-panel';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useExpertWebSocket } from '@/hooks/use-expert-websocket';
import { SyncConflictModal } from '@/components/evaluate/sync-conflict-modal';

// ScoreEntry 从 @/lib/score-validation 导入（桌面/平板共用规范定义）

const scoreKey = (supplierId: string, scoreItemId: string) => `${supplierId}:${scoreItemId}`;

/**
 * 平板触屏评标页（Phase ⑤ Task 6 —— MINIMAL 版 · cgzxui 新拟态重构）
 *
 * 范围：header + SupplierTabBar + 分组评分项（PointChecklistScoring compact）+ MemoPanel 侧栏
 *       + 评分草稿暂存/自动恢复（localStorage）+ 暂存/重置/提交操作栏。
 * 非范围（当 follow-up）：
 *   - 7 步 wizard（身份核验/标书获取/AI 辅助/条款核对/核对评分/评审报告）
 *     → 由桌面端 (app) 完成；tablet 假设专家已完成这些前置步骤
 *   - 异议条款联动 / 实时 WS 状态板
 *
 * 鉴权：(tablet)/layout.tsx 完成；cookie + X-Portal 由 api 客户端处理。
 * 平板仅产生草稿（localStorage + 服务端 draft），正式提交请在桌面专家打分 tab 完成。
 */
export default function TabletEvaluatePage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;

  const [project, setProject] = useState<ExpertProjectDetail | null>(null);
  // P2-2 平板跟进：分钟级时钟——评标截止横幅的剩余时间/过期态随它刷新（与桌面端同口径）
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const [activeSupplier, setActiveSupplier] = useState<string>('');
  const [scores, setScores] = useState<Record<string, ScoreEntry>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null); // P1-16：加载失败错误态（替代永久 loading）
  // 手写备忘得分点上下文（点击左侧得分点 → 选中高亮 → 右侧备忘绑定该得分点）
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const [activePointName, setActivePointName] = useState<string>('');
  // 得分点批注计数（按 scorePointId reduce）+ 当前选中得分点所属 scoreItemId
  const [pointMemoCounts, setPointMemoCounts] = useState<Record<string, number>>({});
  const [activeScoreItemId, setActiveScoreItemId] = useState<string | null>(null);
  // E：跨设备联动——桌面端「去打分平板」focus hint 触发的闪烁项
  const [flashItemId, setFlashItemId] = useState<string | null>(null);
  // 2026-08-28 审查修复：去重改按服务端时间戳 at（而非 Redis seq）——seq 计数器 key 过去带
  // 120s TTL，过期后 INCR 从 1 重新计数，而这里的高水位停在旧值，导致新 hint 永远被忽略。
  // at 单调来自服务端时钟，天然免疫序号回卷（服务端已同步改为不过期计数器，双保险）。
  const lastFocusAt = useRef(0);

  // ── 评分草稿（localStorage 暂存 + 自动恢复）──
  const [draftAvailable, setDraftAvailable] = useState<{ count: number; savedAt: number } | null>(null);
  const [serverDraft, setServerDraft] = useState<Record<string, ScoreEntry> | null>(null); // Phase 1：服务端草稿 fallback（跨设备恢复）
  const [draftDismissed, setDraftDismissed] = useState(false);
  // QA-2026-09-11 A1：草稿检查完成闸——完成前自动保存悬置（防挂载期覆写待恢复草稿）
  const [draftCheckDone, setDraftCheckDone] = useState(false);
  // A2：草稿检查一次性守卫——本 effect 的 deps 含 project 身份（WS 刷新会重跑），只允许检查一次
  const draftCheckedRef = useRef(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftStorageKey = useMemo(() => {
    const expertId = project?.myExpertRecord?.id;
    return expertId ? `expert-draft-tablet:${projectId}:${expertId}` : '';
  }, [project?.myExpertRecord?.id, projectId]);

  // P0-1: hydrate 时用 composite key（与桌面端一致，避免跨供应商串分）
  // P0-B: committedSupplierId 传入本次提交的供应商，合并刷新时仅覆盖该供应商、保留其他供应商未提交编辑
  const loadProject = useCallback((committedSupplierId?: string, silent = false) => {
    if (!silent) {
      setLoading(true);
      setLoadError(null);
    }
    api.get<ExpertProjectDetail & { restricted?: boolean }>(`/expert/projects/${projectId}`)
      .then(p => {
        if (p.restricted || (p.stage !== 'OPENING' && p.stage !== 'EVALUATING')) {
          toast.error('该项目尚未进入开评标阶段');
          router.replace('/tablet');
          return;
        }
        setProject(p);
        // 身份核验视图（2026-09-22 平板补齐）：同步承诺/回避/签到本地态
        const me = p.myExpertRecord;
        setConfidentialityAgreed(!!me?.confidentialityAgreed);
        setDisciplineAgreed(!!me?.disciplineAgreed);
        if (me?.signedIn) setFaceVerified(true);
        setAvoidIds(new Set(me?.conflictedSupplierIds ?? []));
        const existing: Record<string, ScoreEntry> = {};
        p.myScores.forEach((rec: { supplierId: string; scoreItemId: string; score: number; passed?: boolean | null; reason?: string }) => {
          existing[scoreKey(rec.supplierId, rec.scoreItemId)] = {
            score: Number(rec.score),
            reason: rec.reason || '',
            ...(rec.passed !== null && rec.passed !== undefined ? { passed: rec.passed } : {}),
          };
        });
        // P0-B：合并而非覆盖——保留其他供应商尚未提交的内存编辑，仅用服务端值覆盖已提交供应商
        setScores(prev => {
          const next: Record<string, ScoreEntry> = { ...existing };
          for (const [k, v] of Object.entries(prev)) {
            if (committedSupplierId && k.startsWith(`${committedSupplierId}:`)) continue; // 已提交的用服务端值
            if (!(k in next)) next[k] = v; // 其他供应商的未提交编辑保留
          }
          return next;
        });
        // 同时取 pointDecisions（checklist hydrate）
        api.get<{
          records: unknown[];
          pointDecisions?: Array<{ pointId: string; supplierId: string; checked: boolean; awardedScore: number | string; note?: string }>;
        }>(`/expert/projects/${projectId}/my-scores`)
          .then(d => {
            const pointToItem = new Map<string, string>();
            for (const si of p.scoreItems ?? []) {
              for (const pt of si.points ?? []) pointToItem.set(pt.id, si.id);
            }
            setScores(prev => {
              const next = { ...prev };
              for (const pd of (d.pointDecisions ?? [])) {
                const scoreItemId = pointToItem.get(pd.pointId);
                if (!scoreItemId) continue;
                const k = scoreKey(pd.supplierId, scoreItemId);
                const cur = next[k] ?? { score: 0, reason: '' };
                next[k] = {
                  ...cur,
                  points: { ...(cur.points ?? {}), [pd.pointId]: { checked: pd.checked, awardedScore: Number(pd.awardedScore), note: pd.note || undefined } },
                };
              }
              return next;
            });
          })
          .catch(() => { /* my-scores optional */ });
      })
      .catch(e => {
        if (silent) return; // 静默轮询失败不打扰（下次轮询重试）
        const err = e as { message?: string };
        setLoadError(err?.message || '加载项目失败'); // P1-16：记录错误态供重试
      })
      .finally(() => { if (!silent) setLoading(false); });
  }, [projectId, router]);

  useEffect(() => { loadProject(); }, [loadProject]);

  // WS 实时同步：其他专家提交评分 / 对方设备保存草稿后自动刷新
  useExpertWebSocket(projectId, {
    onScoresSubmitted: () => {
      // 平板从不提交评分——任何 scoresSubmitted 都来自桌面端或其他专家，都应刷新
      loadProject();
    },
    onDraftSaved: (d) => {
      if (d.device === 'tablet') return;
      // 从服务端拉取合并后的草稿
      api.get<{ scores: Record<string, ScoreEntry>; savedAt?: number }>(`/expert/projects/${projectId}/score-draft?device=tablet`)
        .then(draft => {
          if (!draft?.scores) return;
          const newItems: string[] = [];
          const conflicts: typeof draftConflicts = [];
          for (const [key, remoteVal] of Object.entries(draft.scores)) {
            if (!(key in scores)) {
              newItems.push(key);
            } else if (JSON.stringify(scores[key]) !== JSON.stringify(remoteVal)) {
              const itemName = project?.scoreItems.find(si => key.endsWith(`:${si.id}`))?.name ?? key;
              conflicts.push({ key, scoreItemName: itemName, localVal: scores[key], remoteVal });
            }
          }
          // 静默合并新增项
          if (newItems.length > 0) {
            setScores(prev => {
              const next = { ...prev };
              for (const k of newItems) next[k] = draft.scores![k];
              return next;
            });
          }
          // 冲突项存入 state → 显示横幅
          if (conflicts.length > 0) {
            setDraftConflicts(prev => [...prev, ...conflicts]);
          }
        })
        .catch(() => {});
    },
  });

  // ── 草稿：项目加载后检查本地草稿；无本地则 fallback 服务端草稿（跨设备恢复）──
  useEffect(() => {
    if (!draftStorageKey || !project) return;
    // A2：deps 含 project 身份（WS 刷新会重跑），once-guard 保证只检查一次、不反复设闸
    if (draftCheckedRef.current) return;
    draftCheckedRef.current = true;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (raw) {
        const draft = JSON.parse(raw) as { scores: Record<string, ScoreEntry>; savedAt: number };
        const count = Object.keys(draft.scores ?? {}).length;
        if (count > 0) { setDraftAvailable({ count, savedAt: draft.savedAt }); setDraftCheckDone(true); return; }
      }
    } catch { /* 本地草稿损坏 → 继续 fallback 服务端 */ }
    api.get<{ scores: Record<string, ScoreEntry>; savedAt?: number }>(`/expert/projects/${projectId}/score-draft?device=tablet`)
      .then((d) => {
        // A1：无论服务端有无草稿都置位，解除自动保存悬置
        setDraftCheckDone(true);
        if (!d || !d.scores) return;
        const count = Object.keys(d.scores).length;
        if (count > 0) { setServerDraft(d.scores); setDraftAvailable({ count, savedAt: d.savedAt ?? Date.now() }); }
      })
      .catch(() => { setDraftCheckDone(true); /* 服务端草稿可选 — ignore */ });
  }, [draftStorageKey, project, projectId]);

  // ── 草稿自动暂存（scores 变化后 2 秒防抖）──
  useEffect(() => {
    if (!draftStorageKey) return;
    // QA-2026-09-11 P1-2/A1：草稿检查未完成或存在待处理草稿横幅时悬置（防覆写待恢复草稿）；
    // 悬置期间清掉已排定的定时器（A3）
    if (!draftCheckDone || draftAvailable !== null) {
      if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null; }
      return;
    }
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      try {
        // P1-1 对齐桌面：pending-only——与已提交记录等价（三字段+有效得分点映射）的条目不入草稿；
        // 原按键成员过滤会静默丢弃「已提交项再修改」，改为值感知（隐藏缺陷一并修复）
        const draftScores: typeof scores = {};
        for (const [k, v] of Object.entries(scores)) {
          const [sid, itemId] = k.split(':');
          const rec = committedRecordFor(project?.myScores, sid, itemId);
          const si = project?.scoreItems.find(s => s.id === itemId);
          if (!rec || !si || !isCommittedEquivalent(v, rec, si)) draftScores[k] = v;
        }
        if (Object.keys(draftScores).length > 0) {
          localStorage.setItem(draftStorageKey, JSON.stringify({ scores: draftScores, savedAt: Date.now() }));
          // P2-5: 同步草稿到服务端（与桌面端一致，跨设备恢复）
          api.post(`/expert/projects/${projectId}/score-draft?device=tablet`, { scores: draftScores, savedAt: Date.now() }).catch(() => {});
        } else {
          localStorage.removeItem(draftStorageKey); // 无未提交条目 → 清掉草稿
          // P1-1：服务端 tablet 槽同步清空（此前只清 localStorage，槽内残留仍会触发恢复横幅）
          api.post(`/expert/projects/${projectId}/score-draft?device=tablet`, { scores: {}, savedAt: Date.now() }).catch(() => {});
        }
      } catch { /* quota exceeded — silent */ }
    }, 2000);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [scores, draftStorageKey, project, draftAvailable, draftCheckDone]);

  // ── 草稿操作 ──
  // P1-3 防御：恢复时把存量部分映射草稿补全为完整映射（缺失点按 passed/提交分回退）
  const normalizeDraftScores = useCallback((draftScores: Record<string, ScoreEntry>): Record<string, ScoreEntry> => {
    const norm: Record<string, ScoreEntry> = {};
    for (const [k, v] of Object.entries(draftScores)) {
      const [sid, itemId] = k.split(':');
      const si = project?.scoreItems.find(s => s.id === itemId);
      const committedScore = committedRecordFor(project?.myScores, sid, itemId)?.score ?? null;
      const hasPartialPoints = v.points && Object.keys(v.points).length > 0;
      norm[k] = si && hasPartialPoints ? { ...v, points: buildFullPoints(si, v, committedScore) } : v;
    }
    return norm;
  }, [project]);

  const restoreDraft = useCallback(() => {
    if (!draftStorageKey) return;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (raw) {
        const draft = JSON.parse(raw) as { scores: Record<string, ScoreEntry>; savedAt: number };
        const norm = normalizeDraftScores(draft.scores);
        setScores((prev) => ({ ...prev, ...norm }));
        toast.success(`已恢复 ${Object.keys(norm).length} 项评分`);
        setDraftAvailable(null); setDraftDismissed(true); setServerDraft(null);
        return;
      }
    } catch { /* 本地损坏 → fallback 服务端 */ }
    if (serverDraft) {
      const norm = normalizeDraftScores(serverDraft);
      setScores((prev) => ({ ...prev, ...norm }));
      toast.success(`已恢复 ${Object.keys(norm).length} 项评分（来自服务端草稿）`);
    }
    setDraftAvailable(null); setDraftDismissed(true); setServerDraft(null);
  }, [draftStorageKey, serverDraft, normalizeDraftScores]);

  const discardDraft = useCallback(() => {
    if (draftStorageKey) localStorage.removeItem(draftStorageKey);
    // P2-2：报告确认后草稿端点对空清载荷豁免锁定——丢弃同时清服务端 tablet 槽
    api.post(`/expert/projects/${projectId}/score-draft?device=tablet`, { scores: {}, savedAt: Date.now() }).catch(() => {});
    setServerDraft(null);
    setDraftAvailable(null);
    setDraftDismissed(true);
  }, [draftStorageKey, projectId]);

  // 默认选中第一家供应商
  useEffect(() => {
    if (project && project.suppliers.length > 0 && !activeSupplier) {
      setActiveSupplier(project.suppliers[0].id);
    }
  }, [project, activeSupplier]);

  // 批量加载当前供应商的 memo 计数（按 scorePointId reduce）
  useEffect(() => {
    if (!activeSupplier) return;
    listMemos(projectId, activeSupplier)
      .then(list => {
        const counts: Record<string, number> = {};
        for (const m of list) {
          if (m.scorePointId) counts[m.scorePointId] = (counts[m.scorePointId] ?? 0) + 1;
        }
        setPointMemoCounts(counts);
      })
      .catch(() => { /* silent */ });
  }, [activeSupplier, projectId]);

  // Phase 0：桌面端条款响应核对「去打分平板」跳转携带 ?supplier= → 预选该供应商。
  // 只应用一次（presetApplied 闸门），不覆盖专家之后的手动切换；声明在默认选中 effect 之后以便覆盖默认值。
  const presetApplied = useRef(false);
  useEffect(() => {
    if (!project || presetApplied.current) return;
    presetApplied.current = true;
    const preset = new URLSearchParams(window.location.search).get('supplier');
    if (preset && project.suppliers.some((s) => s.id === preset)) {
      setActiveSupplier(preset);
    }
  }, [project]);

  // E：跨设备联动——轮询桌面端「去打分平板」focus hint（2.5s；页面隐藏时仍轮询但不滚动）
  useEffect(() => {
    if (!project) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const hint = await api.get<{ supplierId: string; scoreItemId?: string; pointId?: string; seq: number; at: number } | null>(
          `/expert/projects/${projectId}/focus-hint`,
        );
        if (hint && hint.at > lastFocusAt.current) {
          lastFocusAt.current = hint.at;
          if (project.suppliers.some((s) => s.id === hint.supplierId)) setActiveSupplier(hint.supplierId);
          // 等 supplier 切换渲染后再滚动 + 闪烁
          setTimeout(() => {
            if (hint.scoreItemId && typeof document !== 'undefined') {
              const el = document.querySelector(`[data-score-item="${hint.scoreItemId}"]`);
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setFlashItemId(hint.scoreItemId!);
              setTimeout(() => setFlashItemId((cur) => (cur === hint.scoreItemId ? null : cur)), 2500);
            }
            if (hint.pointId) {
              setActivePointId(hint.pointId);
              setActivePointName('');
              setActiveScoreItemId(hint.scoreItemId ?? null);
            }
          }, 350);
        }
      } catch { /* hint 可选 — ignore */ }
      timer = setTimeout(poll, 2500);
    };
    poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [project, projectId]);

  // 桌面端声明过的冲突/废标集合 —— 从 project 元数据 hydrate
  const conflictedSupplierIds = useMemo(
    () => new Set(project?.myExpertRecord?.conflictedSupplierIds ?? []),
    [project],
  );
  const invalidSupplierIds = useMemo(
    () =>
      new Set(
        (project?.suppliers ?? [])
          .filter(s => s.bidValidity === 'invalid') // P2：用共享类型字段，去 unsafe 双 cast
          .map(s => s.id),
      ),
    [project],
  );

  const activeSupplierRecord = project?.suppliers.find(s => s.id === activeSupplier);
  const canScoreActiveSupplier =
    !!activeSupplierRecord &&
    activeSupplierRecord.decryptStatus === 'SUCCESS' &&
    activeSupplierRecord.submitStatus !== '已撤回' &&
    !conflictedSupplierIds.has(activeSupplier) &&
    !invalidSupplierIds.has(activeSupplier);
  const scoreLocked = !!project?.myExpertRecord?.reportConfirmed;
  // P1-3：身份核验/回避/AI声明完成标志（后端仍强制；前端对齐桌面体验，避免专家填完才报错）
  const verificationComplete =
    !!project?.myExpertRecord?.signedIn &&
    !!project?.myExpertRecord?.avoidanceConfirmed &&
    !!project?.myExpertRecord?.aiConsentConfirmed;
  // 修改确认：拦截已有值的修改（平板防误触）
  const [pendingModify, setPendingModify] = useState<{
    scoreItemId: string;
    pointId: string;
    pointName: string;
    oldVal: PointDecisionValue;
    newVal: PointDecisionValue;
    applyFn: (val: PointDecisionValue) => void;
  } | null>(null);
  // WS 同步冲突
  const [draftConflicts, setDraftConflicts] = useState<Array<{
    key: string;
    scoreItemName: string;
    localVal: any;
    remoteVal: any;
  }>>([]);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);

  // 按 category 分组
  const grouped = useMemo(() => {
    const g: Record<string, NonNullable<typeof project>['scoreItems']> = {};
    project?.scoreItems.forEach(si => {
      if (!g[si.category]) g[si.category] = [];
      g[si.category].push(si);
    });
    return g;
  }, [project]);

  // 点击得分点：始终选中（不 toggle 取消）→ MemoPanel 绑定该得分点
  const handlePointClick = useCallback(
    (pointId: string, pointName: string) => {
      setActivePointId(pointId);
      setActivePointName(pointName);
      if (project) {
        const item = project.scoreItems.find(si => (si.points ?? []).some(p => p.id === pointId));
        setActiveScoreItemId(item?.id ?? null);
      }
    },
    [project],
  );

  const handleMemoCountChange = useCallback((pid: string, count: number) => {
    setPointMemoCounts(prev => prev[pid] === count ? prev : { ...prev, [pid]: count });
  }, []);

  // 平板修改拦截器：检测已有值的修改 → 弹确认
  // P1-4：fallbackMap = 回退渲染值（buildFullPoints/pfValueMap）——无已存 points 时以回退值判旧值，
  // 已提交点的第一次点击即弹确认（此前视为新增绕过确认）
  const makeTabletOnChange = (scoreItemId: string, itemPoints: any[], fallbackMap: Record<string, PointDecisionValue> | undefined, defaultApply: (pid: string, pv: PointDecisionValue) => void) => {
    return (pid: string, pv: PointDecisionValue) => {
      const k = scoreKey(activeSupplier, scoreItemId);
      const cur = scores[k];
      const oldPointVal = cur?.points?.[pid] ?? fallbackMap?.[pid];
      const pointName = itemPoints.find(p => p.id === pid)?.name ?? pid;

      // 检测是否为修改（已有值 + 值不同）
      const isModify = oldPointVal && (
        oldPointVal.checked !== pv.checked ||
        oldPointVal.awardedScore !== pv.awardedScore
      );

      if (isModify) {
        setPendingModify({
          scoreItemId,
          pointId: pid,
          pointName,
          oldVal: oldPointVal,
          newVal: pv,
          applyFn: (val: PointDecisionValue) => defaultApply(pid, val),
        });
        return; // 不写入 scores — React 受控 checkbox 会自动回弹
      }
      defaultApply(pid, pv);
    };
  };

  // ── 身份核验视图（2026-09-22 平板补齐）：桌面端向导第 1 步的平板版 ──
  // 签到留档照（SigninCamera 自带 secure context 不可用降级：重试+联系主持人指引）
  // + 保密承诺/评标纪律/AI 声明逐级解锁 + 利益冲突回避申报。
  const [confidentialityAgreed, setConfidentialityAgreed] = useState(false);
  const [disciplineAgreed, setDisciplineAgreed] = useState(false);
  const [aiConsentChecked, setAiConsentChecked] = useState(false);
  const [avoidIds, setAvoidIds] = useState<Set<string>>(new Set());
  const [faceVerifying, setFaceVerifying] = useState(false);
  const [faceVerified, setFaceVerified] = useState(false);
  const [avoiding, setAvoiding] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const lastSigninPhotoRef = useRef<{ blob: Blob; assetId: string } | null>(null);
  const meRecord = project?.myExpertRecord;
  const confirmedConflictIds = useMemo(
    () => new Set(meRecord?.conflictedSupplierIds ?? []),
    [meRecord?.conflictedSupplierIds],
  );
  const avoidanceDirty = !meRecord?.avoidanceConfirmed
    || confirmedConflictIds.size !== avoidIds.size
    || [...avoidIds].some((id) => !confirmedConflictIds.has(id));

  // 必拍留档照（与桌面端 handleFaceSuccess 同源）：上传照片 → 携 photoAssetId + 遮挡检测结论签到；
  // 上传失败就地重试（照片保留），同一 blob 复用 assetId 防重复上传攒孤儿资产。
  const handleFaceSignIn = async (photoBlob: Blob | null, occlusion: 'passed' | 'unchecked') => {
    setFaceVerifying(true);
    try {
      let photoAssetId: string | undefined;
      if (photoBlob) {
        const cached = lastSigninPhotoRef.current;
        if (cached && cached.blob === photoBlob) {
          photoAssetId = cached.assetId;
        } else {
          try {
            const fd = new FormData();
            fd.append('file', photoBlob, `expert-signin-${Date.now()}.jpg`);
            const asset = await api.post<{ id: string }>('/upload?category=expert_signin_photo', fd);
            lastSigninPhotoRef.current = { blob: photoBlob, assetId: asset.id };
            photoAssetId = asset.id;
          } catch {
            toast.error('签到照片上传失败，请点击「确认签到」重试，或「重拍」');
            return;
          }
        }
      }
      await api.post(`/expert/projects/${projectId}/sign-in`, { ...(photoAssetId ? { photoAssetId } : {}), occlusion });
      setFaceVerified(true);
      loadProject();
    } catch (e: any) {
      if (e?.code === 'INVALID_SIGNIN_PHOTO') lastSigninPhotoRef.current = null;
      toast.error(e.message || '签到失败，请点击「确认签到」重试');
    } finally {
      setFaceVerifying(false);
    }
  };

  const handleAgreement = (key: 'confidentialityAgreed' | 'disciplineAgreed', value: boolean) => {
    if (key === 'confidentialityAgreed') setConfidentialityAgreed(value);
    else setDisciplineAgreed(value);
    api.patch(`/expert/projects/${projectId}/agreements`, { [key]: value }).catch(() => {});
  };

  const handleConfirmAiConsent = async () => {
    if (!aiConsentChecked) return;
    setConsentBusy(true);
    try {
      await api.post(`/expert/projects/${projectId}/ai-consent`, {});
      loadProject();
      toast.success('AI 辅助评标声明已确认');
    } catch (e: any) {
      toast.error(e.message || '确认失败');
    }
    setConsentBusy(false);
  };

  const handleAvoidance = async () => {
    setAvoiding(true);
    try {
      await api.post(`/expert/projects/${projectId}/avoidance`, { conflictedSupplierIds: [...avoidIds] });
      toast.success(avoidIds.size > 0
        ? `回避声明已确认（${avoidIds.size} 家冲突申报）`
        : '回避声明已确认：与全部投标单位无利益冲突');
      await loadProject();
    } catch (e: any) {
      toast.error(e.message || '操作失败');
    } finally {
      setAvoiding(false);
    }
  };

  // 未签到期间 10s 静默轮询（与桌面端 signInPending 同口径）：主持人手动确认签到（摄像头故障降级）
  // 或 host 态核验登记后，本页自动解锁进入下一步，无需专家手动刷新。
  const hostLocked = project?.identityMode === 'host' && !meRecord?.identityVerified && !meRecord?.signedIn;
  const signInPending = !meRecord?.signedIn && !scoreLocked;
  useEffect(() => {
    if (!hostLocked && !signInPending) return;
    const t = setInterval(() => loadProject(undefined, true), 10_000);
    return () => clearInterval(t);
  }, [hostLocked, signInPending, loadProject]);

  // ── 评标室口令门（2026-09-20 spec §4 · 2026-09-22 平板补齐）──
  // 与桌面端同源：口令启用且本人未验 → 整个打分工作位置于口令输入之后；
  // 服务端对文档/AI/评分/报告接口同步 403 ROOM_CODE_REQUIRED，冒名者拿到会话也进不了评标物料。
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [roomCodeBusy, setRoomCodeBusy] = useState(false);
  const [roomCodeError, setRoomCodeError] = useState('');
  const handleVerifyRoomCode = async () => {
    setRoomCodeBusy(true);
    setRoomCodeError('');
    try {
      await api.post(`/expert/projects/${projectId}/room-code/verify`, { code: roomCodeInput.trim() });
      setRoomCodeInput('');
      loadProject();
    } catch (e: any) {
      setRoomCodeError(e.message || '口令验证失败');
    } finally {
      setRoomCodeBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 text-[var(--muted-foreground)]">
        <p>加载失败：{loadError}</p>
        <button type="button" onClick={() => loadProject()} className="neu-btn-primary">
          重试
        </button>
      </div>
    );
  }
  if (loading || !project) {
    return (
      <div className="flex h-64 items-center justify-center text-[var(--muted-foreground)]">
        加载中…
      </div>
    );
  }

  // 评标室口令门：口令启用且本人未验（roomVerifiedAt < roomCodeAt）→ 先验口令。
  // 触屏加大输入/按钮热区；文案与桌面端口令门同源（HelpTip 同款提示）。
  if (project.roomCodeActive && !project.roomCodeVerified) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center p-6">
        <div className="neu-card-static w-full max-w-md p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[oklch(0.985 0.005 258)] shadow-[inset_2.5px_2.5px_5px_oklch(0.55_0.03_258/0.14),inset_-2px_-2px_5px_oklch(1_0_0/0.75)]">
            <Lock size={30} strokeWidth={1.5} className="text-[var(--accent)]" />
          </div>
          <h2 className="text-lg font-bold text-[var(--foreground)]">评标室口令</h2>
          <p className="mx-auto mt-2 max-w-xs text-xs leading-relaxed text-[var(--muted-foreground)]">
            请向现场主持人获取口令后进入评标室
            <HelpTip text="连续输错 3 次将锁定 10 分钟。" className="ml-1" />
          </p>
          <input
            type="text"
            value={roomCodeInput}
            onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter' && roomCodeInput.trim()) void handleVerifyRoomCode(); }}
            placeholder="8 位口令"
            maxLength={8}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            disabled={roomCodeBusy}
            className="neu-input mt-5 text-center !h-14 !text-2xl !font-bold !tracking-[0.35em]"
          />
          {roomCodeError && (
            <p className="mt-3 text-xs font-semibold text-[var(--danger,#c0392b)]">{roomCodeError}</p>
          )}
          <button
            type="button"
            onClick={() => void handleVerifyRoomCode()}
            disabled={roomCodeBusy || !roomCodeInput.trim()}
            className="neu-btn-primary mt-5 !h-[48px] !w-full !px-8"
          >
            {roomCodeBusy ? '验证中…' : '进入评标室'}
          </button>
        </div>
      </div>
    );
  }

  // 身份核验门（2026-09-22 平板补齐）：签到/回避/AI 声明未齐 → 先核验（原桌面端向导第 1 步，
  // 平板此前只有一条「请先完成身份核验」横幅却无任何入口——现场平板卡死于此）。
  const verificationNeeded = !verificationComplete && !scoreLocked;
  if (verificationNeeded) {
    const signedIn = !!meRecord?.signedIn;
    return (
      <div className="mx-auto max-w-2xl space-y-4 pb-8">
        <h1 className="text-[1.2rem] font-black tracking-[-0.01em] text-[var(--foreground)]">身份核验与承诺确认</h1>

        {/* ① 身份核验 */}
        <div className="neu-card-static p-4">
          <div className="mb-3 flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-[11px] text-lg font-bold ${
              signedIn ? 'bg-[var(--success)] text-white' : 'bg-[oklch(0.985 0.005 258)] text-[var(--muted-foreground)] shadow-[inset_2.5px_2.5px_5px_oklch(0.55_0.03_258/0.14),inset_-2px_-2px_5px_oklch(1_0_0/0.75)]'
            }`}>
              {signedIn ? <Check size={18} strokeWidth={2.5} /> : '1'}
            </div>
            <h2 className={`flex-1 text-sm font-bold ${signedIn ? 'text-[var(--success)]' : 'text-[var(--foreground)]'}`}>身份核验</h2>
            {!signedIn && <span className="exp-pill" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>待完成</span>}
          </div>
          {project.identityMode === 'host' && !meRecord?.identityVerified ? (
            <div className="exp-alert exp-alert--warning flex items-center gap-3 !font-normal">
              <ShieldAlert size={20} strokeWidth={1.5} className="shrink-0" />
              <div>
                <p className="text-sm font-semibold">待主持人核验</p>
                <p className="text-xs leading-relaxed opacity-90">
                  本项目启用主持人核验（强化模式）——请到主持人处出示证件完成现场核验登记；核验通过后本页自动解锁。
                </p>
              </div>
            </div>
          ) : signedIn ? (
            <div className="exp-alert exp-alert--success flex items-center gap-2">
              <CheckCircle size={16} strokeWidth={1.5} className="shrink-0" />
              <span className="text-sm">留档照已提交 · 签到完成</span>
            </div>
          ) : (
            <SigninCamera
              userName={meRecord?.expertName}
              onSignIn={handleFaceSignIn}
              busy={faceVerifying}
              identityMode={project.identityMode}
            />
          )}
        </div>

        {/* ② 保密承诺 — 签到后解锁 */}
        <div className={`neu-card-static p-4 ${!signedIn ? 'pointer-events-none select-none opacity-50' : ''}`}>
          <div className="mb-3 flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-[11px] text-lg font-bold ${
              confidentialityAgreed ? 'bg-[var(--success)] text-white'
                : signedIn ? 'bg-[oklch(0.985 0.005_258)] text-[var(--muted-foreground)] shadow-[inset_2.5px_2.5px_5px_oklch(0.55_0.03_258/0.14),inset_-2px_-2px_5px_oklch(1_0_0/0.75)]'
                  : 'bg-[oklch(0.96_0.006_258)] text-[var(--muted-foreground)] opacity-60'
            }`}>
              {confidentialityAgreed ? <Check size={18} strokeWidth={2.5} /> : signedIn ? '2' : <Lock size={16} strokeWidth={1.5} />}
            </div>
            <h2 className="flex-1 text-sm font-bold text-[var(--foreground)]">保密承诺</h2>
          </div>
          {!confidentialityAgreed ? (
            <div className="exp-alert exp-alert--info space-y-3 !p-4 !font-normal">
              <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
                本人作为本项目评审专家，郑重承诺：在评标过程中严格遵守保密规定，不向任何第三方泄露评标过程中获取的投标文件内容、评审意见及其他相关信息。如有违反，愿意承担相应法律责任。
              </p>
              <label className="flex cursor-pointer items-center gap-3">
                <input type="checkbox" checked={confidentialityAgreed} onChange={e => handleAgreement('confidentialityAgreed', e.target.checked)} className="neu-checkbox !h-5 !w-5" />
                <span className="text-sm font-semibold text-[var(--foreground)]">本人已阅读并同意以上保密承诺</span>
              </label>
            </div>
          ) : (
            <div className="exp-alert exp-alert--success flex items-center gap-2">
              <CheckCircle size={14} strokeWidth={1.5} className="shrink-0" />
              <span className="text-sm">已签署保密承诺书</span>
            </div>
          )}
        </div>

        {/* ③ 评标纪律 — 保密承诺后解锁 */}
        <div className={`neu-card-static p-4 ${!confidentialityAgreed ? 'pointer-events-none select-none opacity-50' : ''}`}>
          <div className="mb-3 flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-[11px] text-lg font-bold ${
              disciplineAgreed ? 'bg-[var(--success)] text-white'
                : confidentialityAgreed ? 'bg-[oklch(0.985_0.005_258)] text-[var(--muted-foreground)] shadow-[inset_2.5px_2.5px_5px_oklch(0.55_0.03_258/0.14),inset_-2px_-2px_5px_oklch(1_0_0/0.75)]'
                  : 'bg-[oklch(0.96_0.006_258)] text-[var(--muted-foreground)] opacity-60'
            }`}>
              {disciplineAgreed ? <Check size={18} strokeWidth={2.5} /> : confidentialityAgreed ? '3' : <Lock size={16} strokeWidth={1.5} />}
            </div>
            <h2 className="flex-1 text-sm font-bold text-[var(--foreground)]">评标纪律</h2>
          </div>
          {!disciplineAgreed ? (
            <div className="exp-alert exp-alert--info space-y-3 !p-4 !font-normal">
              <ul className="space-y-2 text-sm text-[var(--muted-foreground)]">
                <li className="flex items-start gap-2"><span className="text-[var(--accent-strong)]">•</span>严格按照招标文件规定的评审标准和方法进行评审</li>
                <li className="flex items-start gap-2"><span className="text-[var(--accent-strong)]">•</span>独立评审，不与其他专家串通或私下交流评审意见</li>
                <li className="flex items-start gap-2"><span className="text-[var(--accent-strong)]">•</span>客观公正，不带任何偏见和个人倾向</li>
                <li className="flex items-start gap-2"><span className="text-[var(--accent-strong)]">•</span>对评审过程和结果保密，不向任何人透露</li>
              </ul>
              <label className="flex cursor-pointer items-center gap-3">
                <input type="checkbox" checked={disciplineAgreed} onChange={e => handleAgreement('disciplineAgreed', e.target.checked)} className="neu-checkbox !h-5 !w-5" />
                <span className="text-sm font-semibold text-[var(--foreground)]">本人已阅读并同意遵守以上评标纪律</span>
              </label>
            </div>
          ) : (
            <div className="exp-alert exp-alert--success flex items-center gap-2">
              <CheckCircle size={14} strokeWidth={1.5} className="shrink-0" />
              <span className="text-sm">已确认评标纪律</span>
            </div>
          )}
        </div>

        {/* ④ AI 辅助评标声明 — 评标纪律后解锁 */}
        <div className={`neu-card-static p-4 ${!disciplineAgreed ? 'pointer-events-none select-none opacity-50' : ''}`}>
          <div className="mb-3 flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-[11px] text-lg font-bold ${
              meRecord?.aiConsentConfirmed ? 'bg-[var(--success)] text-white'
                : disciplineAgreed ? 'bg-[oklch(0.985 0.005_258)] text-[var(--muted-foreground)] shadow-[inset_2.5px_2.5px_5px_oklch(0.55_0.03_258/0.14),inset_-2px_-2px_5px_oklch(1_0_0/0.75)]'
                  : 'bg-[oklch(0.96_0.006_258)] text-[var(--muted-foreground)] opacity-60'
            }`}>
              {meRecord?.aiConsentConfirmed ? <Check size={18} strokeWidth={2.5} /> : disciplineAgreed ? '4' : <Lock size={16} strokeWidth={1.5} />}
            </div>
            <h2 className="flex-1 text-sm font-bold text-[var(--foreground)]">AI 辅助评标声明</h2>
          </div>
          {!meRecord?.aiConsentConfirmed ? (
            <div className="exp-alert exp-alert--info space-y-3 !p-4 !font-normal">
              <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
                本项目评审引入人工智能（大语言模型与文档识别）辅助工具，可对投标文件进行合规性检查、风险提示与评分参考分析。AI 意见均为<strong className="text-[var(--foreground)]">辅助参考</strong>，不构成评审结论，不得干预本人的独立职业判断；最终评分由本人独立作出并负责。
              </p>
              <label className="flex cursor-pointer items-center gap-3">
                <input type="checkbox" checked={aiConsentChecked} onChange={e => setAiConsentChecked(e.target.checked)} className="neu-checkbox !h-5 !w-5" />
                <span className="text-sm font-semibold text-[var(--foreground)]">本人已阅读并知悉以上声明</span>
              </label>
              <button onClick={() => void handleConfirmAiConsent()} disabled={!aiConsentChecked || consentBusy} className="neu-btn-primary !h-[46px] w-full">
                {consentBusy ? '确认中…' : '确认同意'}
              </button>
            </div>
          ) : (
            <div className="exp-alert exp-alert--success flex items-center gap-2">
              <CheckCircle size={14} strokeWidth={1.5} className="shrink-0" />
              <span className="text-sm">已确认 AI 辅助评标声明</span>
            </div>
          )}
        </div>

        {/* ⑤ 利益冲突回避 — 签到后可申报 */}
        {signedIn && (
          <div className="neu-card-static p-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-[11px] text-lg font-bold bg-[oklch(0.985_0.005_258)] text-[var(--muted-foreground)] shadow-[inset_2.5px_2.5px_5px_oklch(0.55_0.03_258/0.14),inset_-2px_-2px_5px_oklch(1_0_0/0.75)]">
                <Gavel size={16} strokeWidth={1.5} />
              </div>
              <h2 className="flex-1 text-sm font-bold text-[var(--foreground)]">利益冲突回避</h2>
              {!meRecord?.avoidanceConfirmed && <span className="exp-pill" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>待申报</span>}
            </div>
            <p className="mb-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
              若您与以下任一投标单位存在利益关系（如曾受雇、近亲属供职、持有股份等），请勾选声明回避；被回避的供应商不会出现在您的评分列表中。
            </p>
            <div className="mb-3 space-y-1.5">
              {project.suppliers.map(sup => {
                const isConflict = avoidIds.has(sup.id);
                return (
                  <label key={sup.id} className={`flex cursor-pointer items-center gap-3 rounded-[10px] p-2.5 transition ${
                    isConflict ? 'bg-[color-mix(in_oklch,var(--danger)_8%,transparent)]' : 'hover:bg-[oklch(1_0_0/0.5)]'
                  }`}>
                    <input type="checkbox" checked={isConflict} onChange={e => {
                      setAvoidIds(prev => {
                        const n = new Set(prev);
                        if (e.target.checked) n.add(sup.id); else n.delete(sup.id);
                        return n;
                      });
                    }} className="neu-checkbox !h-5 !w-5" />
                    <span className="flex-1 text-sm font-semibold text-[var(--foreground)]">{sup.supplierName}</span>
                    {isConflict && <span className="exp-pill" style={{ '--c': 'var(--danger)' } as React.CSSProperties}>已声明回避</span>}
                  </label>
                );
              })}
            </div>
            <button onClick={() => void handleAvoidance()} disabled={avoiding || !avoidanceDirty} className={`neu-btn-primary !h-[46px] w-full ${!avoidanceDirty ? 'is-success' : ''}`}>
              {avoiding ? '提交中…'
                : !avoidanceDirty
                  ? `已确认回避声明（${confirmedConflictIds.size} 家冲突申报）`
                  : `${meRecord?.avoidanceConfirmed ? '重新确认回避声明' : '确认回避声明'}（${avoidIds.size} 家冲突 / ${project.suppliers.length - avoidIds.size} 家无冲突）`}
            </button>
          </div>
        )}
      </div>
    );
  }

  const totalScored = project.scoreItems.reduce(
    (s, si) => s + (scores[scoreKey(activeSupplier, si.id)]?.score ?? 0),
    0,
  );
  const totalMax = project.scoreItems.reduce((s, si) => s + Number(si.maxScore), 0);

  return (
    <div className="mx-auto flex h-full max-w-[1400px] flex-col gap-3 px-3 pt-2 pb-3">
      {/* 顶部信息 */}
      <div className="flex flex-shrink-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => router.push('/tablet')}
            aria-label="返回平板工作台"
            className="neu-btn-soft !h-11 !w-11 flex-shrink-0 !p-0"
          >
            <ArrowLeft size={17} strokeWidth={1.7} />
          </button>
          <h1 className="truncate text-base font-bold tracking-[-0.01em] text-[var(--foreground)]">{project.name}</h1>
          <span className="exp-code-chip flex-shrink-0">{project.projectCode}</span>
        </div>
        {/* 总分 pod */}
        <div className="neu-card-static flex flex-shrink-0 items-center gap-2 !rounded-xl px-4 py-2">
          <span className="text-xs font-semibold text-[var(--muted-foreground)]">总分</span>
          <span className="text-lg font-black tabular-nums leading-none text-[var(--accent-strong)]">{totalScored}</span>
          <span className="text-xs tabular-nums text-[var(--muted-foreground)]">/ {totalMax}</span>
        </div>
      </div>

      {/* WS 同步冲突横幅 */}
      {draftConflicts.length > 0 && (
        <div className="flex flex-shrink-0 items-center gap-3 rounded-[10px] px-4 py-2"
          style={{ background: 'color-mix(in oklch, var(--warning) 10%, transparent)', borderLeft: '3px solid var(--warning)' }}>
          <AlertTriangle size={15} className="shrink-0 text-[var(--warning)]" />
          <span className="flex-1 text-xs font-semibold text-[var(--warning)]">
            检测到 {draftConflicts.length} 项评分变更（来自桌面端）
          </span>
          <button type="button"
            onClick={() => setConflictModalOpen(true)}
            className="neu-btn-xs !h-9 !px-3">处理</button>
        </div>
      )}

      {/* P2-2 平板跟进：评标截止预警——与桌面端同口径三态（过期红 / <24h warn / 正常 info 剩余时间） */}
      {project.stage === 'EVALUATING' && project.evaluationDeadline && (() => {
        const end = new Date(project.evaluationDeadline).getTime();
        const remaining = end - nowTick;
        const fmtEnd = new Date(end).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        if (remaining <= 0) return (
          <div className="exp-alert flex flex-shrink-0 items-center gap-2 !px-4">
            <AlertTriangle size={14} strokeWidth={1.5} />
            <span className="text-xs font-semibold">评标已截止（{fmtEnd}）：评分提交已锁定，继续评审请联系采购管理端延期</span>
          </div>
        );
        const days = Math.floor(remaining / 86_400_000);
        const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
        const minutes = Math.floor((remaining % 3_600_000) / 60_000);
        const urgent = remaining < 86_400_000;
        return (
          <div className={`exp-alert flex flex-shrink-0 items-center gap-2 !px-4 ${urgent ? 'exp-alert--warn' : 'exp-alert--info'}`}>
            <Clock size={14} strokeWidth={1.5} />
            <span className="text-xs font-semibold">评标截止：{fmtEnd}（剩余 {days > 0 ? `${days} 天 ` : ''}{hours} 小时 {minutes} 分钟）{urgent ? '——即将截止，请尽快完成评审' : ''}</span>
          </div>
        );
      })()}

      {/* 供应商选择条（横滑磁贴，复用 SupplierTabBar） */}
      <SupplierTabBar
        suppliers={project.suppliers}
        activeSupplier={activeSupplier}
        onSelect={setActiveSupplier}
        conflictedSupplierIds={conflictedSupplierIds}
        invalidSupplierIds={invalidSupplierIds}
        decryptLabel={DECRYPT_LABEL}
      />

      {/* 主内容：评分 + 备忘面板 */}
      <PanelGroup orientation="horizontal" className="min-h-0 flex-1 gap-0">
        <Panel defaultSize={65} minSize={40} className="min-h-0">
        {/* 评分区 */}
        <div className="h-full overflow-y-auto p-3 pt-1">
          {!canScoreActiveSupplier && (
            <div className="exp-alert exp-alert--warn mb-3">
              该投标单位未解密成功、已撤回、已废标或已回避，不能评分。
            </div>
          )}
          {scoreLocked && (
            <div className="exp-alert exp-alert--warn mb-3">
              评审报告已确认，评分已锁定，不可再修改。
            </div>
          )}
          {!verificationComplete && !scoreLocked && (
            <div className="exp-alert exp-alert--warn mb-3">
              请先完成身份核验、回避确认与 AI 辅助评标声明后再录入评分。
            </div>
          )}

          {/* 评分草稿恢复提示 */}
          {draftAvailable && !draftDismissed && (
            <div className="exp-alert exp-alert--warn mb-3 flex items-center gap-2.5">
              <span className="flex-1">
                检测到未提交的评分草稿（{draftAvailable.count} 项 · {new Date(draftAvailable.savedAt).toLocaleString('zh-CN')}）
              </span>
              <button type="button" onClick={discardDraft} className="neu-btn-xs !h-9 !px-3">
                丢弃
              </button>
              <button type="button" onClick={restoreDraft} className="neu-btn-xs is-warning !h-9 !px-3">
                恢复
              </button>
            </div>
          )}

          <div className="space-y-4">
            {Object.entries(grouped).map(([category, items]) => {
              const catColor = CATEGORY_COLOR[category] || 'var(--accent-strong)';
              return (
                <section key={category}>
                  {/* 类目分组标题（.exp-category-group 外壳由 point-checklist-scoring 自行处理） */}
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <span className="exp-category-chip" style={{ '--cat': catColor } as React.CSSProperties} />
                    <h3 className="text-sm font-bold tracking-[-0.01em] text-[var(--foreground)]">
                      {CATEGORY_LABEL[category] || category}
                    </h3>
                    <span className="neu-tab-count">{items.length} 项</span>
                  </div>
                  <div className="space-y-2">
                    {items.map(item => {
                      const k = scoreKey(activeSupplier, item.id);
                      const val = scores[k];
                      const max = Number(item.maxScore);
                      const itemPoints = (item.points ?? []).map(p => ({
                        id: p.id,
                        name: p.name,
                        fullScore: p.fullScore,
                        objective: p.objective,
                        evidenceHint: p.evidenceHint,
                        seq: p.seq,
                      }));
                      const passFail = isPassFailCategory(item.category);
                      const readOnly = !canScoreActiveSupplier || scoreLocked || !verificationComplete;
                      // P2-3：数值单点项无 pointDecisions 时按提交分回显得分点
                      const committedScore = committedRecordFor(project?.myScores, activeSupplier, item.id)?.score ?? null;

                      if (passFail) {
                        const verdict = val?.passed;
                        const pfPoints = (item.points ?? []).map(p => ({ id: p.id, name: p.name, fullScore: p.fullScore, objective: p.objective, evidenceHint: p.evidenceHint, seq: p.seq }));
                        const hasPoints = pfPoints.length > 0;
                        // effective value: stored points → passed fallback → default unchecked（共享回退规则）
                        const pfValueMap: Record<string, PointDecisionValue> = buildFullPoints(item, val, committedScore);
                        return (
                          <div
                            key={item.id}
                            data-score-item={item.id}
                            className={`rounded-[14px] bg-[oklch(1_0_0/0.55)] p-3 transition ${flashItemId === item.id ? '!bg-[oklch(0.96_0.06_71/0.5)] shadow-[0_0_0_2px_var(--warning)] animate-pulse' : ''}`}
                          >
                            <div className="mb-2.5 flex items-center justify-between gap-2">
                              <h4 className="text-sm font-bold text-[var(--foreground)]">
                                {item.name}
                              </h4>
                              {hasPoints && (
                                <span className={`shrink-0 text-xs font-bold ${verdict === true ? 'text-[var(--success)]' : verdict === false ? 'text-[var(--danger)]' : 'text-[var(--muted-foreground)]'}`}>
                                  {verdict === true ? '✓ 通过' : verdict === false ? '✗ 不通过' : '未评'}
                                </span>
                              )}
                            </div>
                            {!hasPoints && (
                              <div className="flex items-center gap-2.5">
                                {[
                                  { v: true, label: '通过' },
                                  { v: false, label: '不通过' },
                                ].map(opt => {
                                  const selected = verdict === opt.v;
                                  return (
                                    <button
                                      key={String(opt.v)}
                                      type="button"
                                      disabled={readOnly}
                                      onClick={() =>
                                        setScores(prev => ({
                                          ...prev,
                                          [k]: { score: 0, reason: prev[k]?.reason || '', passed: opt.v },
                                        }))
                                      }
                                      className={`${selected ? 'neu-btn-primary' : 'neu-btn-soft'} ${opt.v ? 'is-success' : 'is-danger'} !h-12 flex-1`}
                                    >
                                      {opt.label}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            {hasPoints && (
                              <div>
                                <PointChecklistScoring
                                  points={pfPoints}
                                  value={pfValueMap}
                                  readOnly={readOnly}
                                  compact
                                  selectedPointId={activePointId}
                                  onPointClick={handlePointClick}
                                  pointMemoCounts={pointMemoCounts}
                                  onChange={makeTabletOnChange(item.id, pfPoints, pfValueMap, (pid, pv) =>
                                    setScores(prev => {
                                      const cur = prev[k] ?? { score: 0, reason: '' };
                                      const points = { ...(cur.points ?? pfValueMap), [pid]: pv };
                                      const objectivePts = pfPoints.filter(p => p.objective);
                                      const allChecked = objectivePts.length > 0 && objectivePts.every(p => points[p.id]?.checked === true);
                                      return { ...prev, [k]: { ...cur, points, score: 0, reason: cur.reason ?? '', passed: allChecked } };
                                    })
                                  )}
                                />
                              </div>
                            )}
                            {verdict === false && (
                              <textarea
                                placeholder="不通过理由（必填）"
                                value={val?.reason || ''}
                                onChange={e => {
                                  const v = e.target.value;
                                  setScores(prev => ({
                                    ...prev,
                                    [k]: { score: 0, reason: v, passed: false, points: prev[k]?.points },
                                  }));
                                }}
                                disabled={readOnly}
                                className="neu-input !mt-2.5 !h-14 !min-h-0 resize-none text-sm disabled:opacity-60"
                              />
                            )}
                          </div>
                        );
                      }

                      // P1: 价格分公式引擎 — PRICE 项由系统自动算分，平板只读展示
                      const isPriceFormula = item.category === 'PRICE' && !!(project as any)?.priceFormulaConfig;
                      if (isPriceFormula) {
                        return (
                          <div key={item.id} data-score-item={item.id} className="neu-card-static !rounded-[14px] p-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-bold text-[var(--foreground)]">{item.name}</h4>
                              <span className="exp-pill shrink-0" style={{ '--c': 'var(--accent)' } as React.CSSProperties}>
                                系统公式计算
                              </span>
                            </div>
                            <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">满分 {item.maxScore} · 价格分由公式引擎根据报价自动计算，无需专家打分</p>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={item.id}
                          data-score-item={item.id}
                          className={`rounded-[14px] bg-[oklch(1_0_0/0.55)] p-3 transition ${flashItemId === item.id ? '!bg-[oklch(0.96_0.06_71/0.5)] shadow-[0_0_0_2px_var(--warning)] animate-pulse' : ''}`}
                        >
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <h4 className="text-sm font-bold text-[var(--foreground)]">
                              {item.name}
                            </h4>
                            <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">
                              满分 {max}
                            </span>
                          </div>

                          {itemPoints.length > 0 ? (
                            <PointChecklistScoring
                              points={itemPoints}
                              value={buildFullPoints(item, val, committedScore)}
                              readOnly={readOnly}
                              compact
                              selectedPointId={activePointId}
                              onPointClick={handlePointClick}
                              pointMemoCounts={pointMemoCounts}
                              onChange={makeTabletOnChange(item.id, itemPoints, buildFullPoints(item, val, committedScore), (pid, pv) =>
                                setScores(prev => {
                                  const cur = prev[k] ?? { score: 0, reason: '' };
                                  // P2-3：完整映射种子——首次编辑不会从 0 起算覆盖提交分
                                  const points = { ...buildFullPoints(item, cur, committedScore), [pid]: pv };
                                  // rollup: Σ awardedScore → item.score
                                  const score = itemPoints.reduce(
                                    (s, p) => s + (points[p.id]?.awardedScore ?? 0),
                                    0,
                                  );
                                  return { ...prev, [k]: { ...cur, points, score } };
                                })
                              )}
                            />
                          ) : (
                            <div className="flex items-center gap-3">
                              <input
                                type="range"
                                min={0}
                                max={max}
                                step={0.5}
                                value={val?.score ?? 0}
                                disabled={readOnly}
                                onChange={e =>
                                  setScores(prev => ({
                                    ...prev,
                                    [k]: { score: parseFloat(e.target.value), reason: prev[k]?.reason || '' },
                                  }))
                                }
                                className="h-2 flex-1 cursor-pointer accent-[var(--accent-strong)] disabled:opacity-60"
                                aria-label={`${item.name} 评分`}
                              />
                              <input
                                type="number"
                                min={0}
                                max={max}
                                step={0.5}
                                value={val?.score ?? 0}
                                disabled={readOnly}
                                onChange={e =>
                                  setScores(prev => ({
                                    ...prev,
                                    [k]: {
                                      score: Math.max(0, Math.min(parseFloat(e.target.value) || 0, max)), // P2：clamp 到 [0, max]，禁负分
                                      reason: prev[k]?.reason || '',
                                    },
                                  }))
                                }
                                className="exp-score-input !h-11 disabled:opacity-60"
                              />
                            </div>
                          )}

                          <textarea
                            placeholder="评分理由（可选）"
                            value={val?.reason || ''}
                            onChange={e => {
                              const v = e.target.value;
                              setScores(prev => {
                                const cur = prev[k] ?? { score: 0, reason: '' };
                                return { ...prev, [k]: { ...cur, reason: v } };
                              });
                            }}
                            disabled={readOnly}
                            className="neu-input !mt-2 !h-12 !min-h-0 resize-none text-xs disabled:opacity-60"
                          />
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
        </Panel>
        <PanelResizeHandle className="w-2 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--accent)]/10" />
        <Panel defaultSize={35} minSize={20} className="min-h-0">
        {/* 备忘侧栏 */}
        <aside className="h-full overflow-y-auto rounded-2xl bg-[oklch(1_0_0/0.45)] p-3">
          <MemoPanel
            projectId={projectId}
            supplierId={activeSupplier || undefined}
            scorePointId={activePointId ?? undefined}
            scorePointName={activePointName || undefined}
            scoreItemId={activeScoreItemId ?? undefined}
            compact
            sourceDevice="tablet"
            requirePointSelection
            onMemoCountChange={handleMemoCountChange}
          />
        </aside>
        </Panel>
      </PanelGroup>

      {/* 修改确认弹窗（单项改分防误触，与已删除的批量重置无关） */}
      <ConfirmDialog
        open={pendingModify !== null}
        title="确认修改评分"
        message={pendingModify ? `确定将「${pendingModify.pointName}」${
          !pendingModify.oldVal.checked && pendingModify.newVal.checked ? '勾选该得分点'
          : pendingModify.oldVal.checked && !pendingModify.newVal.checked ? '取消勾选'
          : `从 ${pendingModify.oldVal.awardedScore} 分改为 ${pendingModify.newVal.awardedScore} 分`
        }？` : ''}
        confirmText="确认修改"
        cancelText="取消"
        danger
        onConfirm={() => {
          if (pendingModify) {
            pendingModify.applyFn(pendingModify.newVal);
            // undo toast
            toast(`已将「${pendingModify.pointName}」修改`, {
              action: {
                label: '撤销',
                onClick: () => pendingModify.applyFn(pendingModify.oldVal),
              },
              duration: 3000,
            });
          }
          setPendingModify(null);
        }}
        onCancel={() => setPendingModify(null)}
      />
      <SyncConflictModal
        open={conflictModalOpen}
        newItems={[]}
        conflictItems={draftConflicts.map(c => ({
          key: c.key,
          scoreItemName: c.scoreItemName,
          localVal: c.localVal,
          remoteVal: c.remoteVal,
          remoteDevice: 'desktop',
        }))}
        localDevice="tablet"
        onConfirm={(resolved) => {
          setScores(prev => {
            const next = { ...prev };
            for (const c of draftConflicts) {
              if (resolved[c.key] === 'remote') next[c.key] = c.remoteVal;
            }
            return next;
          });
          setDraftConflicts([]);
          setConflictModalOpen(false);
        }}
        onClose={() => setConflictModalOpen(false)}
      />
    </div>
  );
}
