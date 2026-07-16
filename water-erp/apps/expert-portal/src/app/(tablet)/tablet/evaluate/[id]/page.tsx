'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Send } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import {
  CATEGORY_COLOR, CATEGORY_LABEL, isPassFailCategory, DECRYPT_LABEL,
} from '@water-erp/shared';
import type { ExpertProjectDetail } from '@/lib/types';
import { SupplierTabBar } from '@/components/evaluate/supplier-tab-bar';
import { PointChecklistScoring } from '@/components/evaluate/point-checklist-scoring';
import { MemoPanel } from '@/components/memo/memo-panel';

// 与 (app) evaluate 页面一致的 score 条目结构（精简版，不含 passed/points 之外的 UI 态）
type ScoreEntry = {
  score: number;
  reason: string;
  passed?: boolean;
  points?: Record<string, { checked: boolean; awardedScore: number }>;
};

const scoreKey = (supplierId: string, scoreItemId: string) => `${supplierId}:${scoreItemId}`;

/**
 * 平板触屏评标页（Phase ⑤ Task 6 —— MINIMAL 版）
 *
 * 范围：header + SupplierTabBar + 分组评分项（PointChecklistScoring compact）+ MemoPanel 侧栏。
 * 非范围（当 follow-up）：
 *   - 7 步 wizard（身份核验/标书获取/AI 辅助/条款核对/核对评分/评审报告）
 *     → 由桌面端 (app) 完成；tablet 假设专家已完成这些前置步骤
 *   - 评分草稿自动保存 / 异议条款联动 / 实时 WS 状态板
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
  const [busy, setBusy] = useState(false);

  // P0-1: hydrate 时用 composite key（与桌面端一致，避免跨供应商串分）
  const loadProject = useCallback(() => {
    setLoading(true);
    api.get<ExpertProjectDetail & { restricted?: boolean }>(`/expert/projects/${projectId}`)
      .then(p => {
        if (p.restricted || (p.stage !== 'OPENING' && p.stage !== 'EVALUATING')) {
          toast.error('该项目尚未进入开评标阶段');
          router.replace('/');
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
        setScores(existing);
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
                  points: { ...(cur.points ?? {}), [pd.pointId]: { checked: pd.checked, awardedScore: Number(pd.awardedScore) } },
                };
              }
              return next;
            });
          })
          .catch(() => { /* my-scores optional */ });
      })
      .catch(e => {
        const err = e as { message?: string };
        toast.error(err?.message || '加载项目失败');
      })
      .finally(() => setLoading(false));
  }, [projectId, router]);

  useEffect(() => { loadProject(); }, [loadProject]);

  // 默认选中第一家供应商
  useEffect(() => {
    if (project && project.suppliers.length > 0 && !activeSupplier) {
      setActiveSupplier(project.suppliers[0].id);
    }
  }, [project, activeSupplier]);

  // 桌面端声明过的冲突/废标集合 —— 从 project 元数据 hydrate
  const conflictedSupplierIds = useMemo(
    () => new Set(project?.myExpertRecord?.conflictedSupplierIds ?? []),
    [project],
  );
  const invalidSupplierIds = useMemo(
    () =>
      new Set(
        (project?.suppliers ?? [])
          .filter(s => (s as unknown as { bidValidity?: string }).bidValidity === 'invalid')
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
    setBusy(true);
    try {
      const supplierName = activeSupplierRecord?.supplierName || '';
      const payload = project.scoreItems.map(si => {
        const k = scoreKey(activeSupplier, si.id);
        const entry = scores[k];
        const itemPoints = (si.points ?? []).map(p => ({ id: p.id }));
        if (isPassFailCategory(si.category)) {
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
      loadProject();
    } catch (e) {
      const err = e as ApiError;
      toast.error(err?.message || '提交失败');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !project) {
    return (
      <div className="flex h-64 items-center justify-center text-[oklch(0.55_0.01_264)]">
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
    <div className="mx-auto flex h-full max-w-[1400px] flex-col gap-3">
      {/* 顶部信息 */}
      <div className="flex flex-shrink-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => router.push('/')}
            aria-label="返回"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[oklch(0.55_0.01_264)] transition hover:bg-[oklch(0.97_0.005_264)]"
          >
            <ArrowLeft size={16} strokeWidth={1.7} />
          </button>
          <h1 className="truncate text-base font-bold text-[oklch(0.18_0.012_265)]">{project.name}</h1>
          <span className="shrink-0 text-xs text-[oklch(0.55_0.01_264)]">{project.projectCode}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3 rounded-lg border border-[oklch(0.91_0.006_264)] bg-white/70 px-3 py-1.5">
          <span className="text-xs text-[oklch(0.55_0.01_264)]">总分</span>
          <span className="text-lg font-bold text-[#064ea2]">{totalScored}</span>
          <span className="text-xs text-[oklch(0.55_0.01_264)]">/ {totalMax}</span>
        </div>
      </div>

      {/* 供应商选择条（复用桌面端 SupplierTabBar） */}
      <SupplierTabBar
        suppliers={project.suppliers}
        activeSupplier={activeSupplier}
        onSelect={setActiveSupplier}
        conflictedSupplierIds={conflictedSupplierIds}
        decryptLabel={DECRYPT_LABEL}
      />

      {/* 主内容：评分 + 备忘面板 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
        {/* 评分区 */}
        <div className="min-h-0 overflow-y-auto rounded-xl border border-[oklch(0.91_0.006_264)] bg-white/60 p-3">
          {!canScoreActiveSupplier && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              该投标单位未解密成功、已撤回、已废标或已回避，不能评分。
            </div>
          )}
          {scoreLocked && (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              评审报告已确认，评分已锁定，不可再修改。
            </div>
          )}

          <div className="space-y-3">
            {Object.entries(grouped).map(([category, items]) => {
              const catColor = CATEGORY_COLOR[category] || '#064ea2';
              return (
                <div
                  key={category}
                  className="overflow-hidden rounded-xl border border-blue-100 bg-blue-50/50"
                  style={{ borderLeft: `2px solid ${catColor}` }}
                >
                  <div className="flex items-center justify-between border-b border-blue-100 px-3 py-2">
                    <span
                      className="rounded-md px-2 py-0.5 text-xs font-bold"
                      style={{ color: catColor, backgroundColor: catColor + '18' }}
                    >
                      {CATEGORY_LABEL[category] || category}
                    </span>
                    <span className="text-[10px] text-[oklch(0.55_0.01_264)]">
                      {items.length} 项
                    </span>
                  </div>
                  <div className="space-y-2 p-2">
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
                            className="rounded-lg border border-blue-100 bg-white p-2.5"
                          >
                            <h4 className="mb-2 text-sm font-semibold text-[oklch(0.18_0.012_265)]">
                              {item.name}
                            </h4>
                            <div className="flex items-center gap-2">
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
                                    className={`flex-1 rounded-lg border-2 py-2.5 text-sm font-bold transition disabled:opacity-50 ${
                                      selected
                                        ? opt.v
                                          ? 'border-[#11a874] bg-[#11a874] text-white'
                                          : 'border-[#e74c3c] bg-[#e74c3c] text-white'
                                        : opt.v
                                          ? 'border-[#11a874]/40 bg-white text-[#11a874] hover:bg-[#ecfdf5]'
                                          : 'border-[#e74c3c]/40 bg-white text-[#e74c3c] hover:bg-[#fef2f2]'
                                    }`}
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
                                className="mt-2 h-14 w-full resize-none rounded-lg border border-blue-100 px-2 py-1.5 text-sm focus:border-[#064ea2] focus:outline-none focus:ring-1 focus:ring-[#064ea2] disabled:opacity-60"
                              />
                            )}
                          </div>
                        );
                      }

                      return (
                        <div
                          key={item.id}
                          data-score-item={item.id}
                          className="rounded-lg border border-blue-100 bg-white p-2.5"
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <h4 className="text-sm font-semibold text-[oklch(0.18_0.012_265)]">
                              {item.name}
                            </h4>
                            <span className="text-[10px] text-[oklch(0.55_0.01_264)]">
                              满分 {max}
                            </span>
                          </div>

                          {itemPoints.length > 0 ? (
                            <PointChecklistScoring
                              points={itemPoints}
                              value={val?.points ?? {}}
                              readOnly={readOnly}
                              compact
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
                                className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-[oklch(0.94_0.004_264)] accent-[#064ea2] disabled:opacity-60"
                                style={{
                                  background: `linear-gradient(to right, ${catColor} ${((val?.score ?? 0) / Math.max(max, 1)) * 100}%, #f0f4f8 ${((val?.score ?? 0) / Math.max(max, 1)) * 100}%)`,
                                }}
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
                                      score: Math.min(parseFloat(e.target.value) || 0, max),
                                      reason: prev[k]?.reason || '',
                                    },
                                  }))
                                }
                                className="w-16 rounded-lg border border-blue-100 px-2 py-1.5 text-center text-sm font-bold text-[#064ea2] focus:border-[#064ea2] focus:outline-none focus:ring-1 focus:ring-[#064ea2] disabled:opacity-60"
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
                            className="mt-2 h-12 w-full resize-none rounded-lg border border-blue-100 px-2 py-1.5 text-xs focus:border-[#064ea2] focus:outline-none focus:ring-1 focus:ring-[#064ea2] disabled:opacity-60"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 备忘侧栏 */}
        <aside className="min-h-0 overflow-y-auto rounded-xl border border-[oklch(0.91_0.006_264)] bg-white/70 p-3">
          <MemoPanel
            projectId={projectId}
            supplierId={activeSupplier || undefined}
            compact
          />
        </aside>
      </div>

      {/* 提交栏 */}
      <div className="flex flex-shrink-0 items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={busy || !canScoreActiveSupplier || scoreLocked}
          className="flex items-center gap-1.5 rounded-lg bg-[#064ea2] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#054280] disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} strokeWidth={1.7} />}
          {busy ? '提交中…' : scoreLocked ? '评分已锁定' : '提交评分'}
        </button>
      </div>
    </div>
  );
}
