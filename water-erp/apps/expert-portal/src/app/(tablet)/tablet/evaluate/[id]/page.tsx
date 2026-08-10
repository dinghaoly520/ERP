'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Send, Save, RotateCcw } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { validateSupplierScores } from '@/lib/score-validation';
import {
  CATEGORY_COLOR, CATEGORY_LABEL, isPassFailCategory, DECRYPT_LABEL,
} from '@water-erp/shared';
import type { ExpertProjectDetail } from '@/lib/types';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { SupplierTabBar } from '@/components/evaluate/supplier-tab-bar';
import { PointChecklistScoring } from '@/components/evaluate/point-checklist-scoring';
import { MemoPanel } from '@/components/memo/memo-panel';
import { ConfirmDialog } from '@/components/confirm-dialog';

// 与 (app) evaluate 页面一致的 score 条目结构（精简版，不含 passed/points 之外的 UI 态）
type ScoreEntry = {
  score: number;
  reason: string;
  passed?: boolean;
  points?: Record<string, { checked: boolean; awardedScore: number; note?: string }>;
};

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
 * 安全：handleSubmitScores 仅对解密成功 + 未撤回 + 未废标的供应商提交。
 */
export default function TabletEvaluatePage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;

  const [project, setProject] = useState<ExpertProjectDetail | null>(null);
  const [activeSupplier, setActiveSupplier] = useState<string>('');
  const [scores, setScores] = useState<Record<string, ScoreEntry>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null); // P1-16：加载失败错误态（替代永久 loading）
  const [busy, setBusy] = useState(false);
  // 手写备忘得分点上下文（点击左侧得分点 → 选中高亮 → 右侧备忘绑定该得分点）
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const [activePointName, setActivePointName] = useState<string>('');
  // E：跨设备联动——桌面端「去打分平板」focus hint 触发的闪烁项
  const [flashItemId, setFlashItemId] = useState<string | null>(null);
  const lastFocusSeq = useRef(0);

  // ── 评分草稿（localStorage 暂存 + 自动恢复）──
  const [draftAvailable, setDraftAvailable] = useState<{ count: number; savedAt: number } | null>(null);
  const [serverDraft, setServerDraft] = useState<Record<string, ScoreEntry> | null>(null); // Phase 1：服务端草稿 fallback（跨设备恢复）
  const [draftDismissed, setDraftDismissed] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftStorageKey = useMemo(() => {
    const expertId = project?.myExpertRecord?.id;
    return expertId ? `expert-draft-tablet:${projectId}:${expertId}` : '';
  }, [project?.myExpertRecord?.id, projectId]);

  // P0-1: hydrate 时用 composite key（与桌面端一致，避免跨供应商串分）
  // P0-B: committedSupplierId 传入本次提交的供应商，合并刷新时仅覆盖该供应商、保留其他供应商未提交编辑
  const loadProject = useCallback((committedSupplierId?: string) => {
    setLoading(true);
    setLoadError(null);
    api.get<ExpertProjectDetail & { restricted?: boolean }>(`/expert/projects/${projectId}`)
      .then(p => {
        if (p.restricted || (p.stage !== 'OPENING' && p.stage !== 'EVALUATING')) {
          toast.error('该项目尚未进入开评标阶段');
          router.replace('/tablet');
          return;
        }
        setProject(p);
        const existing: Record<string, ScoreEntry> = {};
        p.myScores.forEach((rec: { supplierId: string; scoreItemId: string; score: number; reason?: string }) => {
          existing[scoreKey(rec.supplierId, rec.scoreItemId)] = {
            score: Number(rec.score),
            reason: rec.reason || '',
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
        const err = e as { message?: string };
        setLoadError(err?.message || '加载项目失败'); // P1-16：记录错误态供重试
      })
      .finally(() => setLoading(false));
  }, [projectId, router]);

  useEffect(() => { loadProject(); }, [loadProject]);

  // ── 草稿：项目加载后检查本地草稿；无本地则 fallback 服务端草稿（跨设备恢复）──
  useEffect(() => {
    if (!draftStorageKey || !project) return;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (raw) {
        const draft = JSON.parse(raw) as { scores: Record<string, ScoreEntry>; savedAt: number };
        const count = Object.keys(draft.scores ?? {}).length;
        if (count > 0) { setDraftAvailable({ count, savedAt: draft.savedAt }); return; }
      }
    } catch { /* 本地草稿损坏 → 继续 fallback 服务端 */ }
    api.get<{ scores: Record<string, ScoreEntry>; savedAt?: number }>(`/expert/projects/${projectId}/score-draft`)
      .then((d) => {
        if (!d || !d.scores) return;
        const count = Object.keys(d.scores).length;
        if (count > 0) { setServerDraft(d.scores); setDraftAvailable({ count, savedAt: d.savedAt ?? Date.now() }); }
      })
      .catch(() => { /* 服务端草稿可选 — ignore */ });
  }, [draftStorageKey, project, projectId]);

  // ── 草稿自动暂存（scores 变化后 2 秒防抖）──
  useEffect(() => {
    if (!draftStorageKey) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      try {
        // P2：仅暂存相对服务端未提交的条目，避免把已提交分记为草稿（假「未提交草稿」横幅）
        const committed = new Set((project?.myScores ?? []).map((r: { supplierId: string; scoreItemId: string }) => scoreKey(r.supplierId, r.scoreItemId)));
        const draftScores: typeof scores = {};
        let hasDraft = false;
        for (const [k, v] of Object.entries(scores)) {
          if (!committed.has(k)) { draftScores[k] = v; hasDraft = true; }
        }
        if (hasDraft) {
          localStorage.setItem(draftStorageKey, JSON.stringify({ scores: draftScores, savedAt: Date.now() }));
          // P2-5: 同步草稿到服务端（与桌面端一致，跨设备恢复）
          api.post(`/expert/projects/${projectId}/score-draft`, { scores: draftScores, savedAt: Date.now() }).catch(() => {});
        } else {
          localStorage.removeItem(draftStorageKey); // 无未提交条目 → 清掉草稿
        }
      } catch { /* quota exceeded — silent */ }
    }, 2000);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [scores, draftStorageKey, project]);

  // ── 草稿操作 ──
  const saveDraft = useCallback(() => {
    if (!draftStorageKey) return;
    setDraftSaving(true);
    try {
      localStorage.setItem(draftStorageKey, JSON.stringify({ scores, savedAt: Date.now() }));
      toast.success('评分已暂存');
    } catch {
      toast.error('暂存失败，请检查浏览器存储空间');
    } finally {
      setDraftSaving(false);
    }
  }, [draftStorageKey, scores]);

  const restoreDraft = useCallback(() => {
    if (!draftStorageKey) return;
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (raw) {
        const draft = JSON.parse(raw) as { scores: Record<string, ScoreEntry>; savedAt: number };
        setScores((prev) => ({ ...prev, ...draft.scores }));
        toast.success(`已恢复 ${Object.keys(draft.scores).length} 项评分`);
        setDraftAvailable(null); setDraftDismissed(true); setServerDraft(null);
        return;
      }
    } catch { /* 本地损坏 → fallback 服务端 */ }
    if (serverDraft) {
      setScores((prev) => ({ ...prev, ...serverDraft }));
      toast.success(`已恢复 ${Object.keys(serverDraft).length} 项评分（来自服务端草稿）`);
    }
    setDraftAvailable(null); setDraftDismissed(true); setServerDraft(null);
  }, [draftStorageKey, serverDraft]);

  const discardDraft = useCallback(() => {
    if (draftStorageKey) localStorage.removeItem(draftStorageKey);
    setServerDraft(null);
    setDraftAvailable(null);
    setDraftDismissed(true);
  }, [draftStorageKey]);

  // 重置当前供应商所有评分
  const resetCurrentSupplier = useCallback(() => {
    if (!activeSupplier) return;
    setScores((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        if (k.startsWith(`${activeSupplier}:`)) delete next[k];
      }
      return next;
    });
    toast.success('已重置当前供应商评分');
  }, [activeSupplier]);

  // 默认选中第一家供应商
  useEffect(() => {
    if (project && project.suppliers.length > 0 && !activeSupplier) {
      setActiveSupplier(project.suppliers[0].id);
    }
  }, [project, activeSupplier]);

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
        if (hint && hint.seq > lastFocusSeq.current) {
          lastFocusSeq.current = hint.seq;
          if (project.suppliers.some((s) => s.id === hint.supplierId)) setActiveSupplier(hint.supplierId);
          // 等 supplier 切换渲染后再滚动 + 闪烁
          setTimeout(() => {
            if (hint.scoreItemId && typeof document !== 'undefined') {
              const el = document.querySelector(`[data-score-item="${hint.scoreItemId}"]`);
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              setFlashItemId(hint.scoreItemId!);
              setTimeout(() => setFlashItemId((cur) => (cur === hint.scoreItemId ? null : cur)), 2500);
            }
            if (hint.pointId) { setActivePointId(hint.pointId); setActivePointName(''); }
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
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false); // P2：重置二次确认

  // 按 category 分组
  const grouped = useMemo(() => {
    const g: Record<string, NonNullable<typeof project>['scoreItems']> = {};
    project?.scoreItems.forEach(si => {
      if (!g[si.category]) g[si.category] = [];
      g[si.category].push(si);
    });
    return g;
  }, [project]);

  const handleSubmit = async () => {
    if (!project || !activeSupplier || !canScoreActiveSupplier || scoreLocked) return;
    // P1-15：提交前校验评分完整性（与桌面端一致）
    const missing = validateSupplierScores(project.scoreItems, scores, activeSupplier);
    if (missing.length > 0) {
      toast.error(missing[0].message);
      return;
    }
    setBusy(true);
    try {
      const supplierName = activeSupplierRecord?.supplierName || '';
      const payload = project.scoreItems.map(si => {
        const k = scoreKey(activeSupplier, si.id);
        const entry = scores[k];
        const itemPoints = (si.points ?? []).map(p => ({ id: p.id }));
        if (isPassFailCategory(si.category)) {
          if (itemPoints.length > 0) {
            const ptEntries = Object.entries(entry?.points ?? {});
            return {
              scoreItemId: si.id,
              supplierId: activeSupplier,
              reason: entry?.reason ?? '',
              pointDecisions: ptEntries.length > 0
                ? ptEntries.map(([pid, d]) => ({ pointId: pid, checked: d.checked, awardedScore: d.awardedScore, note: d.note }))
                : (si.points ?? []).map(p => ({ pointId: p.id, checked: entry?.passed === true, awardedScore: entry?.passed === true ? Number(p.fullScore) : 0 })),
            };
          }
          return {
            scoreItemId: si.id,
            supplierId: activeSupplier,
            passed: entry?.passed,
            reason: entry?.reason ?? '',
          };
        }
        if (itemPoints.length > 0) {
          return {
            scoreItemId: si.id,
            supplierId: activeSupplier,
            score: entry?.score ?? 0,
            reason: entry?.reason ?? '',
            pointDecisions: Object.entries(entry?.points ?? {}).map(([pointId, d]) => ({
              pointId,
              checked: d.checked,
              awardedScore: d.awardedScore,
              note: d.note,
            })),
          };
        }
        return {
          scoreItemId: si.id,
          supplierId: activeSupplier,
          score: entry?.score ?? 0,
          reason: entry?.reason ?? '',
        };
      });
      await api.post(`/expert/projects/${projectId}/scores`, { scores: payload, supplierName });
      toast.success(`${supplierName} 评分提交成功`);
      // P0-B：不再整键删除草稿（会误删其他供应商未提交分）；合并刷新后自动暂存按剩余未提交分重写
      setDraftAvailable(null);
      setDraftDismissed(true);
      loadProject(activeSupplier);
    } catch (e) {
      const err = e as ApiError;
      toast.error(err?.message || '提交失败');
    } finally {
      setBusy(false);
    }
  };

  // 点击得分点：切换选中 → MemoPanel 内部自动保存/加载
  const handlePointClick = useCallback(
    (pointId: string, pointName: string) => {
      setActivePointId(activePointId === pointId ? null : pointId);
      setActivePointName(activePointId === pointId ? '' : pointName);
    },
    [activePointId],
  );

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
              请先完成身份核验、回避确认与 AI 辅助评标声明后再提交评分。
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
                      const readOnly = !canScoreActiveSupplier || scoreLocked;

                      if (passFail) {
                        const verdict = val?.passed;
                        return (
                          <div
                            key={item.id}
                            data-score-item={item.id}
                            className={`rounded-[14px] bg-[oklch(1_0_0/0.55)] p-3 transition ${flashItemId === item.id ? '!bg-[oklch(0.96_0.06_71/0.5)] shadow-[0_0_0_2px_var(--warning)] animate-pulse' : ''}`}
                          >
                            <h4 className="mb-2.5 text-sm font-bold text-[var(--foreground)]">
                              {item.name}
                            </h4>
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
                            {verdict === false && (
                              <textarea
                                placeholder="不通过理由（必填）"
                                value={val?.reason || ''}
                                onChange={e => {
                                  const v = e.target.value;
                                  setScores(prev => ({
                                    ...prev,
                                    [k]: { score: 0, reason: v, passed: false },
                                  }));
                                }}
                                disabled={readOnly}
                                className="neu-input !mt-2.5 !h-14 !min-h-0 resize-none text-sm disabled:opacity-60"
                              />
                            )}
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
                              value={val?.points ?? {}}
                              readOnly={readOnly}
                              compact
                              selectedPointId={activePointId}
                              onPointClick={handlePointClick}
                              onChange={(pid, pv) =>
                                setScores(prev => {
                                  const cur = prev[k] ?? { score: 0, reason: '' };
                                  const points = { ...(cur.points ?? {}), [pid]: pv };
                                  // rollup: Σ awardedScore → item.score
                                  const score = itemPoints.reduce(
                                    (s, p) => s + (points[p.id]?.awardedScore ?? 0),
                                    0,
                                  );
                                  return { ...prev, [k]: { ...cur, points, score } };
                                })
                              }
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
            compact
            sourceDevice="tablet"
          />
        </aside>
        </Panel>
      </PanelGroup>

      {/* 操作栏：重置 / 暂存 / 提交（平板大按钮 !h-12） */}
      <div className="flex flex-shrink-0 items-center justify-center gap-3">
        {!scoreLocked && (
          <>
            {/* 重置当前供应商评分（P2：二次确认，防触屏误触清空） */}
            <button
              type="button"
              onClick={() => setResetConfirmOpen(true)}
              disabled={busy || !canScoreActiveSupplier}
              className="neu-btn-soft is-danger !h-12 !px-6"
            >
              <RotateCcw size={16} strokeWidth={1.7} />
              重置
            </button>

            {/* 暂存评分到本地 */}
            <button
              type="button"
              onClick={saveDraft}
              disabled={busy || draftSaving || !canScoreActiveSupplier}
              className="neu-btn-soft !h-12 !px-6"
            >
              <Save size={16} strokeWidth={1.7} />
              {draftSaving ? '暂存中…' : '暂存'}
            </button>
            <ConfirmDialog
              open={resetConfirmOpen}
              title="重置当前供应商评分"
              message="将清空当前供应商已录入的全部评分，此操作不可撤销。"
              confirmText="重置"
              cancelText="取消"
              danger
              onConfirm={() => { resetCurrentSupplier(); setResetConfirmOpen(false); }}
              onCancel={() => setResetConfirmOpen(false)}
            />
          </>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy || !canScoreActiveSupplier || scoreLocked || !verificationComplete}
          className="neu-btn-primary !h-12 !px-8"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} strokeWidth={1.7} />}
          {busy ? '提交中…' : scoreLocked ? '评分已锁定' : !verificationComplete ? '请先完成核验' : '提交'}
        </button>
      </div>
    </div>
  );
}
