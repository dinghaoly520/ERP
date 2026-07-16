'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getSupplierList, getEvaluationStats, getSupplierEvaluations, createEvaluation, getEvaluationDimensionStats, getSupplierEvaluationAnalysis } from '@/lib/api/supplier';
import type { DimensionStats, DimensionAnalysis, EvaluationAnalysisResult } from '@/lib/api/supplier';
import type { Supplier, SupplierEvaluation, SupplierListResponse } from '@/lib/types';
import { StatusBadge, TableSkeleton, Modal } from '@/components/workbench';
import { CheckCircle2, Search, X, RefreshCw, ChevronUp, Sparkles, Loader2, Brain } from 'lucide-react';

const DIMENSIONS: { key: keyof EvalScores; label: string; hint: string; max: number }[] = [
  { key: 'completenessScore', label: '资料完整性', hint: '资质材料、投标文件的完整与规范程度', max: 20 },
  { key: 'responsivenessScore', label: '响应及时性', hint: '沟通回复与问题响应速度', max: 30 },
  { key: 'cooperationScore', label: '配合协作度', hint: '履约过程中的配合与协作意愿', max: 20 },
  { key: 'complianceScore', label: '合规守信度', hint: '合同履约、合规与诚信情况', max: 20 },
  { key: 'overallScore', label: '综合满意度', hint: '对供应商的总体评价', max: 10 },
];
type EvalScores = { completenessScore: number; responsivenessScore: number; cooperationScore: number; complianceScore: number; overallScore: number };

const DEFAULTS: EvalScores = { completenessScore: 16, responsivenessScore: 24, cooperationScore: 16, complianceScore: 16, overallScore: 8 };

export default function SupplierEvaluationPage() {
  const router = useRouter();
  const [data, setData] = useState<SupplierListResponse>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [evalStats, setEvalStats] = useState({ levelCounts: { A: 0, B: 0, C: 0, D: 0 }, avgScore: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [evalModal, setEvalModal] = useState<Supplier | null>(null);
  const [history, setHistory] = useState<SupplierEvaluation[]>([]);
  const [scores, setScores] = useState<EvalScores>(DEFAULTS);
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  // AI 分析
  const [aiResult, setAiResult] = useState<EvaluationAnalysisResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try { const res = await getSupplierList({ status: 'APPROVED', search: search || undefined, page, pageSize: 20 }); setData(res); }
    catch {}
    setLoading(false);
  }, [search, page]);

  const [dimStats, setDimStats] = useState<DimensionStats | null>(null);
  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { getEvaluationStats().then(setEvalStats).catch(() => {}); getEvaluationDimensionStats().then(setDimStats).catch(() => {}); }, [data.total]);

  const openEval = async (s: Supplier) => {
    setEvalModal(s);
    setScores(DEFAULTS);
    setEvidence({});
    setComment('');
    setAiResult(null);
    setAiError('');
    try { setHistory(await getSupplierEvaluations(s.id)); } catch { setHistory([]); }
  };

  const runAiAnalysis = async () => {
    if (!evalModal) return;
    setAiLoading(true);
    setAiError('');
    try {
      const res = await getSupplierEvaluationAnalysis(evalModal.id);
      setAiResult(res);
      // 自动填入分数和依据
      const autoScores = { ...scores };
      const autoEvidence = { ...evidence };
      res.dimensions.forEach(d => {
        const dim = DIMENSIONS.find(dm => dm.label === d.dimension);
        if (dim) {
          autoScores[dim.key] = d.suggestedScore;
          autoEvidence[dim.key] = d.evidencePoints?.length
            ? `${d.rationale}。参考数据：${d.evidencePoints.join('；')}`
            : `${d.rationale}`;
        }
      });
      setScores(autoScores);
      setEvidence(autoEvidence);
      toast.success(`AI 分析完成，已自动填入各维度分数与依据（综合建议 ${res.overallSuggestion} 分）`);
    } catch (e: any) {
      setAiError(e?.message || 'AI 分析失败，请手动评分');
      toast.error('AI 分析失败，可继续手动评分');
    }
    setAiLoading(false);
  };

  const adoptAiScores = () => {
    if (!aiResult) return;
    const newScores = { ...scores };
    const newEvidence = { ...evidence };
    aiResult.dimensions.forEach(d => {
      const dim = DIMENSIONS.find(dm => dm.label === d.dimension);
      if (dim) {
        newScores[dim.key] = d.suggestedScore;
        newEvidence[dim.key] = d.evidencePoints?.length
          ? `${d.rationale}。参考数据：${d.evidencePoints.join('；')}`
          : `${d.rationale}`;
      }
    });
    setScores(newScores);
    setEvidence(newEvidence);
    toast.success('已全部恢复 AI 建议分数和依据');
  };

  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const previewLevel = totalScore >= 90 ? 'A' : totalScore >= 80 ? 'B' : totalScore >= 60 ? 'C' : 'D';

  const submit = async () => {
    if (!evalModal) return;
    // 检查每个维度是否有依据
    const missingEvidence = DIMENSIONS.filter(d => !evidence[d.key]);
    if (missingEvidence.length > 0) {
      toast.error(`请为以下维度填写评价依据：${missingEvidence.slice(0, 2).map(d => d.label).join('、')}${missingEvidence.length > 2 ? '等' : ''}`);
      return;
    }
    setSaving(true);
    try {
      // 将 evidence 打包进 comment
      const evidenceJson = JSON.stringify(evidence);
      const fullComment = [comment, `\n--- 评价依据 ---\n${evidenceJson}`].filter(Boolean).join('\n');
      await createEvaluation(evalModal.id, { ...scores, comment: fullComment || undefined });
      toast.success('评价已提交');
      setHistory(await getSupplierEvaluations(evalModal.id));
      setEvalModal(null);
      getEvaluationStats().then(setEvalStats).catch(() => {});
      loadData();
    } catch (e: any) { toast.error(e?.message || '评价提交失败'); }
    setSaving(false);
  };

  const totalPages = Math.max(1, Math.ceil(data.total / 20));

  return (
    <div className="flex flex-col gap-4">
      {/* ══════ page-hero ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><CheckCircle2 size={17} /></div>
            <div>
              <div className="page-hero__title">供应商评价</div>
              <div className="page-hero__sub">AI 辅助五维评价 · 各维度需填写依据后方可提交</div>
            </div>
          </div>
          <div className="page-hero__right">
            <button onClick={loadData} disabled={loading} className="neu-btn-xs"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
          </div>
        </div>
        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 items-stretch">
          {(['A','B','C','D'] as const).map(lv => (
            <div key={lv} className="kpi-card group flex h-full flex-col gap-1.5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">
                {lv}级 · {lv === 'A' ? '优秀' : lv === 'B' ? '良好' : lv === 'C' ? '合格' : '不合格'}
              </span>
              <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{evalStats.levelCounts[lv]}</span>
              <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">&nbsp;</span>
            </div>
          ))}
        </div>
        </div>
      </div>

      {/* ══════ 工具栏 ══════ */}
      <div className="wb-toolbar">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-[var(--muted-foreground)]">累计评价 <strong className="tabular-nums text-[var(--foreground)]">{evalStats.total}</strong> 次</span>
          <span className="text-[var(--muted-foreground)]">平均得分 <strong className="tabular-nums text-[var(--accent)]">{evalStats.avgScore.toFixed(1)}</strong></span>
        </div>
        <div className="relative min-w-[140px] xl:min-w-[200px] flex-1 ml-auto">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="搜索供应商名称" className="neu-input !pl-9" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-[rgba(96,139,239,0.1)] text-[var(--muted-foreground)] z-10"><X size={14} /></button>}
        </div>
      </div>

      {/* ══════ 五维评分分布 ══════ */}
      {dimStats && dimStats.total > 0 && (
        <div className="neu-table-card p-5">
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-4">五维评分分布（全局均分）</h3>
          <div className="space-y-2">
            {[
              { label: '资料完整性', key: 'completenessAvg' as const, max: 20 },
              { label: '响应及时性', key: 'responsivenessAvg' as const, max: 30 },
              { label: '配合协作度', key: 'cooperationAvg' as const, max: 20 },
              { label: '合规守信度', key: 'complianceAvg' as const, max: 20 },
              { label: '综合满意度', key: 'overallAvg' as const, max: 10 },
            ].map(d => {
              const score = dimStats[d.key];
              const pct = (score / d.max) * 100;
              const color = pct >= 80 ? 'var(--success)' : pct >= 60 ? 'var(--accent)' : pct >= 40 ? 'var(--warning)' : 'var(--danger)';
              return (
                <div key={d.key} className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold text-[var(--foreground)] w-20">{d.label}</span>
                  <div className="flex-1 h-5 rounded-md bg-[var(--muted)]/20 overflow-hidden">
                    <div className="h-full rounded-md transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.6 }} />
                  </div>
                  <span className="text-[11px] tabular-nums font-semibold text-[var(--muted-foreground)] w-16 text-right">{score}/{d.max}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════ 数据表格 ══════ */}
      <div className="neu-table-card">
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[680px]">
            <thead>
              <tr>
                <th style={{ width: 160 }}>企业名称</th>
                <th className="text-center" style={{ width: 100 }}>分类</th>
                <th className="text-center" style={{ width: 80 }}>平均评分</th>
                <th className="text-center" style={{ width: 100 }}>最新评分</th>
                <th className="text-center" style={{ width: 72 }}>评价次数</th>
                <th className="text-center" style={{ width: 100 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton cols={6} rows={5} />
              ) : data.items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-16">
                  <div className="flex flex-col items-center gap-3">
                    <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><CheckCircle2 size={22} className="text-[var(--muted-foreground)]" /></div>
                    <p className="text-sm text-[var(--muted-foreground)]">暂无已入库供应商</p>
                    <button onClick={() => router.push('/supplier/repository')} className="neu-btn-xs is-info">前往供应商库 →</button>
                  </div>
                </td></tr>
              ) : data.items.map((s: Supplier) => {
                const latest = (s as any).evaluations?.[0];
                const latestScore = latest ? Number(latest.score).toFixed(0) : null;
                const level = latest?.level as string | undefined;
                const levelTone = level === 'A' ? 'green' : level === 'B' ? 'blue' : level === 'C' ? 'orange' : level === 'D' ? 'red' : undefined;
                const avgScore = (s as any)._avgScore != null ? Number((s as any)._avgScore).toFixed(1) : null;
                return (
                <tr key={s.id} className="row-clickable" onClick={() => openEval(s)}>
                  <td>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{s.name[0]}</div>
                      <span className="text-sm font-bold text-[var(--foreground)] truncate hover:text-[var(--accent)] transition-colors">{s.name}</span>
                    </div>
                  </td>
                  <td className="text-center text-sm text-[var(--muted-foreground)]">{s.classification?.name || '—'}</td>
                  <td className="text-center">
                    {avgScore ? (
                      <span className="text-sm font-extrabold text-[var(--accent)] tabular-nums">{avgScore}</span>
                    ) : (
                      <span className="text-sm text-[var(--muted-foreground)]">—</span>
                    )}
                  </td>
                  <td className="text-center">
                    {latestScore ? (
                      <div className="flex items-center justify-center gap-1.5">
                        <span className="text-sm font-extrabold text-[var(--foreground)] tabular-nums">{latestScore}</span>
                        <StatusBadge tone={levelTone as any}>{level}</StatusBadge>
                      </div>
                    ) : (
                      <span className="text-sm text-[var(--muted-foreground)]">—</span>
                    )}
                  </td>
                  <td className="text-center"><span className="neu-tab-count">{s._count?.evaluations ?? 0}</span></td>
                  <td onClick={e => e.stopPropagation()} className="text-center">
                    <button onClick={() => openEval(s)} className="neu-btn-xs is-info">评价 / 查看</button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {data.total > 0 && (
          <div className="neu-table-card-footer flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[0.8rem] text-[var(--muted-foreground)] tabular-nums">共 <strong className="font-semibold text-[var(--foreground)]">{data.total}</strong> 条 · 第 {page}/{totalPages} 页</span>
            <div className="flex gap-1.5">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="neu-btn-xs disabled:opacity-30"><ChevronUp size={14} className="rotate-[-90deg]" /></button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="neu-btn-xs disabled:opacity-30"><ChevronUp size={14} className="rotate-90" /></button>
            </div>
          </div>
        )}
      </div>

      {/* ══════ 评价面板 ══════ */}
      {evalModal && (
        <Modal
          open
          onClose={() => setEvalModal(null)}
          title={<span className="flex items-center gap-2">{evalModal.name}<StatusBadge tone="blue">评价</StatusBadge></span>}
          size="lg"
          footer={
            <div className="flex items-center justify-between w-full">
              <span className="text-xs text-[var(--muted-foreground)]">{saving ? '提交中...' : '每个维度需填写评价依据'}</span>
              <div className="flex gap-3">
                <button onClick={() => setEvalModal(null)} className="neu-btn-soft">取消</button>
                <button onClick={submit} disabled={saving} className="neu-btn-soft is-success">{saving ? '提交中...' : '提交评价'}</button>
              </div>
            </div>
          }
        >
          {/* ══ AI 状态栏 ══ */}
          <div className="flex items-center gap-3 rounded-xl p-3 bg-[var(--surface)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {aiLoading ? (
                <><Loader2 size={14} className="animate-spin text-[var(--accent)]" /><span className="text-xs text-[var(--muted-foreground)]">AI 正在分析 {evalModal.name} 的资质、历史评价与项目参与数据…</span></>
              ) : aiResult ? (
                <>
                  <Brain size={14} className="text-[var(--accent)] flex-shrink-0" />
                  <span className="text-xs text-[var(--accent)] font-semibold flex-shrink-0">AI 已分析</span>
                  <span className="text-xs text-[var(--muted-foreground)] truncate">{aiResult.summary}</span>
                </>
              ) : (
                <>
                  <Brain size={14} className="text-[var(--muted-foreground)]/40 flex-shrink-0" />
                  <span className="text-xs text-[var(--muted-foreground)]">AI 可自动分析供应商数据，完成后将直接填入各维度分数与评价依据</span>
                </>
              )}
            </div>
            <button onClick={runAiAnalysis} disabled={aiLoading} className="neu-btn-soft flex-shrink-0">
              {aiLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={13} />}
              {aiLoading ? '分析中' : aiResult ? '重新分析' : 'AI 分析'}
            </button>
          </div>
          {aiError && <p className="text-xs font-semibold text-[var(--danger)]">{aiError}</p>}

          {/* ══ 评分维度（每条嵌入 AI 建议）══ */}
          {DIMENSIONS.map(d => {
            const aiDim = aiResult?.dimensions.find(ad => ad.label === d.label);
            const isAdopted = aiDim && scores[d.key] === aiDim.suggestedScore;
            return (
              <div key={d.key} className="rounded-xl p-4 bg-[var(--surface)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                {/* 标题行 */}
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[var(--foreground)]">{d.label}</span>
                    <span className="text-[11px] text-[var(--muted-foreground)] hidden sm:inline">{d.hint}</span>
                  </div>
                  <span className="text-sm font-extrabold text-[var(--accent)] tabular-nums">{scores[d.key]}</span>
                </div>

                {/* AI 建议行 */}
                {aiDim && (
                  <div className="flex items-center gap-2 mb-2 -mt-0.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-[var(--accent)]/70 truncate">{aiDim.rationale}</p>
                      {aiDim.evidencePoints?.length > 0 && (
                        <p className="text-[10px] text-[var(--muted-foreground)]/50 mt-0.5 truncate">
                          {aiDim.evidencePoints.join(' · ')}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setScores(prev => ({ ...prev, [d.key]: aiDim.suggestedScore }));
                        setEvidence(prev => ({
                          ...prev,
                          [d.key]: aiDim.evidencePoints?.length
                            ? `${aiDim.rationale}。参考数据：${aiDim.evidencePoints.join('；')}`
                            : `${aiDim.rationale}`,
                        }));
                      }}
                      className={`neu-btn-xs flex-shrink-0 ${isAdopted ? 'is-success' : ''}`}
                      title={isAdopted ? '已为 AI 建议值' : '恢复到 AI 建议值'}
                    >
                      <Sparkles size={10} />
                      {isAdopted ? `AI ${aiDim.suggestedScore}` : `恢复 ${aiDim.suggestedScore}`}
                    </button>
                  </div>
                )}

                {/* 滑块 */}
                <div className="relative">
                  <input type="range" min={0} max={d.max} step={1} value={scores[d.key]}
                    onChange={e => setScores({ ...scores, [d.key]: Number(e.target.value) })}
                    className="w-full accent-[var(--accent)]" />
                  {aiDim && (
                    <div className="absolute top-0 h-full pointer-events-none"
                      style={{ left: `${(aiDim.suggestedScore / d.max) * 100}%`, width: 1 }}>
                      <div className="h-full w-px bg-[var(--accent)]/30" />
                      <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-[8px] text-[var(--accent)]/40 font-bold">AI</div>
                    </div>
                  )}
                </div>
                <div className="flex justify-between text-[10px] text-[var(--muted-foreground)] mt-0.5">
                  <span>0</span>
                  {aiDim && <span className="tabular-nums text-[var(--accent)]/40">AI 建议 {aiDim.suggestedScore}</span>}
                  <span className="tabular-nums">{d.max}</span>
                </div>

                {/* 评价依据 */}
                <textarea
                  value={evidence[d.key] || ''}
                  onChange={e => setEvidence(prev => ({ ...prev, [d.key]: e.target.value }))}
                  placeholder={`评价依据（必填）：基于哪些具体事实或数据得出此评分？`}
                  className="neu-input w-full h-14 resize-none text-xs mt-2"
                />
              </div>
            );
          })}

          {/* ══ 总分预览 ══ */}
          <div className="flex items-center gap-3 rounded-xl bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] p-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">
            <span className="text-xs font-bold text-[var(--muted-foreground)]">总分</span>
            <strong className="text-xl font-black text-[var(--accent)] tabular-nums">{totalScore}</strong>
            <StatusBadge tone={previewLevel === 'A' ? 'green' : previewLevel === 'B' ? 'blue' : previewLevel === 'C' ? 'orange' : 'red'}>
              {previewLevel === 'A' ? '优秀' : previewLevel === 'B' ? '良好' : previewLevel === 'C' ? '合格' : '不合格'}（{previewLevel}级）
            </StatusBadge>
            <span className="ml-auto text-[10px] text-[var(--muted-foreground)]">A≥90 · B≥80 · C≥60 · D&lt;60</span>
          </div>

          <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="总体评价说明（可选）" className="neu-input w-full h-20 resize-none text-sm" />

          {/* 历史评价 */}
          {history.length > 0 && (
            <>
              <hr className="wb-section-rule" />
              <div>
                <h4 className="text-sm font-bold text-[var(--foreground)] mb-2">历史评价（{history.length}）</h4>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {history.map(ev => {
                    const lv = ev.level || 'D';
                    const tone = lv === 'A' ? 'green' : lv === 'B' ? 'blue' : lv === 'C' ? 'orange' : 'red';
                    let evidenceText = '';
                    try {
                      const m = ev.comment?.match(/--- 评价依据 ---\n(\{[\s\S]*\})/);
                      if (m) {
                        const evObj = JSON.parse(m[1]);
                        evidenceText = Object.entries(evObj).map(([k, v]) => `${DIMENSIONS.find(d => d.key === k)?.label || k}: ${(v as string).slice(0, 30)}`).join(' · ');
                      }
                    } catch {}
                    return (
                      <div key={ev.id} className="rounded-lg bg-[var(--surface)] p-2.5 text-xs shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                        <div className="flex items-center gap-2">
                          <StatusBadge tone={tone as any}>{lv}</StatusBadge>
                          <strong className="text-[var(--foreground)]">{Number(ev.score)}分</strong>
                          <span className="text-[var(--muted-foreground)]">{ev.evaluator?.displayName || '—'}</span>
                          <span className="ml-auto text-[var(--muted-foreground)]">{new Date(ev.createdAt).toLocaleDateString('zh-CN')}</span>
                        </div>
                        {ev.comment && <p className="mt-1 text-[var(--muted-foreground)]">{ev.comment.slice(0, 200).replace(/\n--- 评价依据 ---[\s\S]*/, '')}</p>}
                        {evidenceText && <p className="mt-0.5 text-[var(--muted-foreground)]/60 text-[10px]">{evidenceText}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
