'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { getSupplierList, getEvaluationStats, getSupplierEvaluations, createEvaluation } from '@/lib/api/supplier';
import type { Supplier, SupplierEvaluation, SupplierListResponse } from '@/lib/types';
import { StatusBadge, TableSkeleton } from '@/components/workbench';
import { CheckCircle2, Search, X, RefreshCw, ChevronUp } from 'lucide-react';

const DIMENSIONS: { key: keyof Pick<SupplierEvaluation, 'completenessScore' | 'responsivenessScore' | 'cooperationScore' | 'complianceScore' | 'overallScore'>; label: string; hint: string; max: number }[] = [
  { key: 'completenessScore', label: '资料完整性', hint: '资质材料、投标文件的完整与规范程度', max: 20 },
  { key: 'responsivenessScore', label: '响应及时性', hint: '沟通回复与问题响应速度', max: 30 },
  { key: 'cooperationScore', label: '配合协作度', hint: '履约过程中的配合与协作意愿', max: 20 },
  { key: 'complianceScore', label: '合规守信度', hint: '合同履约、合规与诚信情况', max: 20 },
  { key: 'overallScore', label: '综合满意度', hint: '对供应商的总体评价', max: 10 },
];

export default function SupplierEvaluationPage() {
  const router = useRouter();
  const [data, setData] = useState<SupplierListResponse>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [evalStats, setEvalStats] = useState({ levelCounts: { A: 0, B: 0, C: 0, D: 0 }, avgScore: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [evalModal, setEvalModal] = useState<Supplier | null>(null);
  const [history, setHistory] = useState<SupplierEvaluation[]>([]);
  const [scores, setScores] = useState({ completenessScore: 16, responsivenessScore: 16, cooperationScore: 16, complianceScore: 16, overallScore: 16 });
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try { const res = await getSupplierList({ status: 'APPROVED', search: search || undefined, page, pageSize: 20 }); setData(res); }
    catch {}
    setLoading(false);
  }, [search, page]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { getEvaluationStats().then(setEvalStats).catch(() => {}); }, [data.total]);

  const openEvalModal = async (s: Supplier) => {
    setEvalModal(s);
    setScores({ completenessScore: 16, responsivenessScore: 16, cooperationScore: 16, complianceScore: 16, overallScore: 16 });
    setComment('');
    try { setHistory(await getSupplierEvaluations(s.id)); } catch { setHistory([]); }
  };

  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const previewLevel = totalScore >= 90 ? 'A' : totalScore >= 80 ? 'B' : totalScore >= 60 ? 'C' : 'D';

  const submit = async () => {
    if (!evalModal) return;
    setSaving(true);
    try {
      await createEvaluation(evalModal.id, { ...scores, comment: comment || undefined });
      toast.success('评价已提交');
      setHistory(await getSupplierEvaluations(evalModal.id));
      setEvalModal(null);
      getEvaluationStats().then(setEvalStats).catch(() => {});
    } catch (e: any) { toast.error(e?.message || '评价提交失败'); }
    setSaving(false);
  };

  const totalPages = Math.max(1, Math.ceil(data.total / 20));

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><CheckCircle2 size={17} /></div>
            <div>
              <div className="page-hero__title">供应商评价</div>
              <div className="page-hero__sub">资料完整性、响应及时性、配合协作度、合规守信度、综合满意度五维评价</div>
            </div>
          </div>
          <div className="page-hero__right">
            <button onClick={loadData} disabled={loading} className="neu-btn-xs"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
          </div>
        </div>
        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(['A','B','C','D'] as const).map(lv => (
            <div key={lv} className="kpi-card group flex h-full flex-col gap-1.5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
                {lv}级 · {lv === 'A' ? '优秀' : lv === 'B' ? '良好' : lv === 'C' ? '合格' : '不合格'}
              </span>
              <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{evalStats.levelCounts[lv]}</span>
            </div>
          ))}
        </div>
        </div>
      </div>

      {/* ══════ 工具栏 ══════ */}
      <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-[color-mix(in_oklch,var(--border)_80%,transparent)] bg-[var(--surface)] px-4 py-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.65),2px_2px_6px_oklch(0.55_0.03_258/0.08),-1px_-1px_3px_oklch(1_0_0/0.85)]">
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

      {/* ══════ 数据表格 ══════ */}
      <div className="neu-table-card">
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[480px]">
            <thead>
              <tr>
                <th>企业名称</th>
                <th className="text-center">分类</th>
                <th className="text-center">评价次数</th>
                <th className="text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton cols={4} rows={5} />
              ) : data.items.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-16">
                  <div className="flex flex-col items-center gap-3">
                    <div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><CheckCircle2 size={22} className="text-[var(--muted-foreground)]" /></div>
                    <p className="text-sm text-[var(--muted-foreground)]">暂无已入库供应商</p>
                    <button onClick={() => router.push('/supplier/repository')} className="neu-btn-xs is-info">前往供应商库 →</button>
                  </div>
                </td></tr>
              ) : data.items.map((s: Supplier) => (
                <tr key={s.id} className="row-clickable" onClick={() => openEvalModal(s)}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{s.name[0]}</div>
                      <span className="text-sm font-bold text-[var(--foreground)] truncate hover:text-[var(--accent)] transition-colors">{s.name}</span>
                    </div>
                  </td>
                  <td className="text-center text-sm text-[var(--muted-foreground)]">{s.classification?.name || '—'}</td>
                  <td className="text-center"><span className="neu-tab-count">{s._count?.evaluations ?? 0}</span></td>
                  <td onClick={e => e.stopPropagation()} className="text-center">
                    <button onClick={() => openEvalModal(s)} className="neu-btn-xs is-info">评价 / 查看</button>
                  </td>
                </tr>
              ))}
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

      {/* ══════ 评价弹窗 ══════ */}
      {evalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setEvalModal(null)}>
          <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-[min(640px,92vw)] max-h-[90vh] overflow-y-auto rounded-[20px] bg-[var(--background)] p-0 shadow-[0_20px_60px_oklch(0.24_0.038_258/0.12)]" role="dialog" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 px-6 py-4">
              <div>
                <h2 className="text-lg font-bold tracking-[-0.02em] text-[var(--foreground)]">供应商评价</h2>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{evalModal.name}</p>
              </div>
              <button onClick={() => setEvalModal(null)} className="neu-btn-xs"><X size={16} /></button>
            </div>

            <div className="px-6 pb-6 space-y-5">
              {DIMENSIONS.map(d => (
                <div key={d.key}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <span className="text-sm font-bold text-[var(--foreground)]">{d.label}</span>
                      <span className="ml-2 text-xs text-[var(--muted-foreground)]">{d.hint}</span>
                    </div>
                    <span className="text-sm font-extrabold text-[var(--accent)] tabular-nums min-w-[2rem] text-right">{scores[d.key]}</span>
                  </div>
                  <input type="range" min={0} max={d.max} step={1} value={scores[d.key]} onChange={e => setScores({ ...scores, [d.key]: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
                  <div className="flex justify-between text-[10px] text-[var(--muted-foreground)] mt-0.5"><span>0</span><span>{d.max}</span></div>
                </div>
              ))}

              <div className="flex items-center gap-3 rounded-xl bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] p-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">
                <span className="text-xs font-bold text-[var(--muted-foreground)]">总分</span>
                <strong className="text-xl font-black text-[var(--accent)] tabular-nums">{totalScore}</strong>
                <StatusBadge tone={previewLevel === 'A' ? 'green' : previewLevel === 'B' ? 'blue' : previewLevel === 'C' ? 'orange' : 'red'}>
                  {previewLevel === 'A' ? '优秀' : previewLevel === 'B' ? '良好' : previewLevel === 'C' ? '合格' : '不合格'}（{previewLevel}级）
                </StatusBadge>
                <span className="ml-auto text-xs text-[var(--muted-foreground)]">A≥90 · B≥80 · C≥60 · D&lt;60</span>
              </div>

              <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="评价说明（可选）" className="neu-input w-full h-20 resize-none text-sm" />

              {history.length > 0 && (
                <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "0.75rem" }}>
                  <h4 className="text-sm font-bold text-[var(--foreground)] mb-2">历史评价（{history.length}）</h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {history.map(ev => {
                      const lv = ev.level || 'D';
                      const tone = lv === 'A' ? 'green' : lv === 'B' ? 'blue' : lv === 'C' ? 'orange' : 'red';
                      return (
                        <div key={ev.id} className="rounded-lg bg-[var(--surface)] p-2.5 text-xs shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                          <div className="flex items-center gap-2">
                            <StatusBadge tone={tone as any}>{lv}</StatusBadge>
                            <strong className="text-[var(--foreground)]">{Number(ev.score)}分</strong>
                            <span className="text-[var(--muted-foreground)]">{ev.evaluator?.displayName || '—'}</span>
                            <span className="ml-auto text-[var(--muted-foreground)]">{new Date(ev.createdAt).toLocaleDateString('zh-CN')}</span>
                          </div>
                          {ev.comment && <p className="mt-1 text-[var(--muted-foreground)]">{ev.comment}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <hr className="wb-section-rule mx-6" />
            <div className="flex justify-end gap-3 px-6 py-4">
              <button onClick={() => setEvalModal(null)} className="neu-btn-soft">取消</button>
              <button onClick={submit} disabled={saving} className="neu-btn-soft is-info">{saving ? '提交中...' : '提交评价'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
