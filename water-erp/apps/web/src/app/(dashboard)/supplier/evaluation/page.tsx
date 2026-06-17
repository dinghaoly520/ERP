'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  getSupplierList, getEvaluationStats, getSupplierEvaluations, createEvaluation,
} from '@/lib/api/supplier';
import type { Supplier, SupplierEvaluation, SupplierListResponse } from '@/lib/types';
import { DataToolbar, MetricCard, PageHero, SectionCard, StatusBadge, TableSkeleton, EmptyState } from '@/components/workbench';
import { CheckCircle2, Search, X } from 'lucide-react';

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
    try {
      const res = await getSupplierList({ status: 'APPROVED', search: search || undefined, page, pageSize: 20 });
      setData(res);
    } catch { /* empty */ }
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

  const totalPages = Math.ceil(data.total / 20);

  return (
    <div className="space-y-6">
      <PageHero
         title="供应商评价"
        description="供应商履约评价：资料完整性、响应及时性、配合协作度、合规守信度、综合满意度。"
        tone="green" icon={<CheckCircle2 size={14} />}
      />

      {/* Level distribution */}
      <div className="grid gap-4 md:grid-cols-4">
        {(['A','B','C','D'] as const).map(lv => (
          <MetricCard
            key={lv}
            label={`${lv}级 · ${lv === 'A' ? '优秀' : lv === 'B' ? '良好' : lv === 'C' ? '合格' : '不合格'}`}
            value={evalStats.levelCounts[lv]}
            tone={lv === 'A' ? 'green' : lv === 'B' ? 'blue' : lv === 'C' ? 'orange' : 'red'}
          />
        ))}
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-6 glass-card glass-card-lighter rounded-2xl px-5 py-3 text-sm">
        <span className="text-[#5a6d8a]">累计评价 <strong className="tabular-nums text-[#18243a]">{evalStats.total}</strong> 次</span>
        <span className="text-[#5a6d8a]">平均得分 <strong className="tabular-nums text-[#064ea2]">{evalStats.avgScore.toFixed(1)}</strong></span>
      </div>

      <DataToolbar>
        <div className="flex items-center gap-2 flex-1">
          <Search size={15} className="text-[#94a3b8] flex-shrink-0" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="搜索供应商名称" className="workbench-input flex-1 text-sm" />
        </div>
      </DataToolbar>

      <SectionCard className="p-0">
        <table className="workbench-table">
          <thead className="bg-[#f3f7fc] text-[#5a6d8a]">
            <tr>
              <th className="px-4 py-3">企业名称</th>
              <th className="px-4 py-3 text-center">分类</th>
              <th className="px-4 py-3 text-center">评价次数</th>
              <th className="px-4 py-3 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton cols={4} rows={5} />
            ) : data.items.length === 0 ? (
              <tr><td colSpan={4}><EmptyState title="暂无已入库供应商" description="供应商通过审核后即可进行履约评价" action={<button onClick={() => router.push('/supplier/repository')} className="text-sm font-bold text-[#064ea2] hover:underline">前往供应商库 →</button>} /></td></tr>
            ) : data.items.map((s: Supplier) => (
              <tr key={s.id} className="row-clickable" onClick={() => openEvalModal(s)}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#064ea2] text-xs font-extrabold text-white">
                      {s.name[0]}
                    </div>
                    <span className="text-sm font-bold text-[#18243a] cursor-pointer hover:text-[#064ea2] transition"
                      onClick={() => router.push(`/supplier/${s.id}`)}>{s.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-center">{s.classification?.name || '—'}</td>
                <td className="px-4 py-3 text-center">
                  <StatusBadge tone="blue">{s._count?.evaluations ?? 0} 次</StatusBadge>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={(e) => { e.stopPropagation(); openEvalModal(s); }}
                    className="btn-press rounded-lg bg-[#064ea2] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#054280] transition">
                    评价 / 查看
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-[#edf2f7] px-4 py-3">
            <span className="text-xs text-[#8a99ad]">共 {data.total} 条，第 {page}/{totalPages} 页</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="rounded-lg border border-[#dce6f3] px-3 py-1 text-xs font-semibold text-[#5a6d8a] hover:bg-[#f8fafc] disabled:opacity-40 transition">上一页</button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                className="rounded-lg border border-[#dce6f3] px-3 py-1 text-xs font-semibold text-[#5a6d8a] hover:bg-[#f8fafc] disabled:opacity-40 transition">下一页</button>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Evaluation Modal */}
      {evalModal && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setEvalModal(null)}>
          <div className="modal-content w-full max-w-2xl overflow-hidden rounded-2xl border border-[#dce6f3] bg-white shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#edf2f7] px-6 py-4">
              <div>
                <h3 className="text-base font-bold text-[#18243a]">供应商评价</h3>
                <p className="mt-0.5 text-xs text-[#5a6d8a]">{evalModal.name}</p>
              </div>
              <button onClick={() => setEvalModal(null)}
                className="rounded-lg p-1 text-[#8a99ad] hover:bg-[#f8fafc] hover:text-[#5a6d8a] transition"><X size={18} /></button>
            </div>

            <div className="p-6">
              <div className="space-y-5 mb-6">
                {DIMENSIONS.map(d => (
                  <div key={d.key}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <span className="text-sm font-bold text-[#18243a]">{d.label}</span>
                        <span className="ml-2 text-xs text-[#8a99ad]">{d.hint}</span>
                      </div>
                      <span className="text-sm font-extrabold text-[#064ea2] tabular-nums min-w-[2rem] text-right">{scores[d.key]}</span>
                    </div>
                    <input type="range" min={0} max={d.max} step={1} value={scores[d.key]}
                      onChange={e => setScores({ ...scores, [d.key]: Number(e.target.value) })}
                      className="w-full range-enhanced accent-[#064ea2]" />
                    <div className="flex justify-between text-[10px] text-[#8a99ad] mt-0.5">
                      <span>0</span><span>{d.max}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-[#bcd0e8] bg-[#f0f6ff] p-3 mb-5">
                <span className="text-xs font-bold text-[#5a6d8a]">总分</span>
                <strong className="text-xl font-black text-[#064ea2] tabular-nums">{totalScore}</strong>
                <StatusBadge tone={previewLevel === 'A' ? 'green' : previewLevel === 'B' ? 'blue' : previewLevel === 'C' ? 'orange' : 'red'}>
                  {previewLevel === 'A' ? '优秀' : previewLevel === 'B' ? '良好' : previewLevel === 'C' ? '合格' : '不合格'}（{previewLevel}级）
                </StatusBadge>
                <span className="ml-auto text-xs text-[#8a99ad]">A≥90 · B≥80 · C≥60 · D&lt;60</span>
              </div>

              <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="评价说明（可选）"
                className="w-full rounded-xl border border-[#dce6f3] px-3 py-2 text-sm placeholder-[#94a3b8] h-20 resize-none focus:outline-none focus:border-[#064ea2]" />

              {/* History */}
              {history.length > 0 && (
                <div className="mt-5">
                  <h4 className="text-sm font-bold text-[#18243a] mb-2">历史评价（{history.length}）</h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {history.map(ev => {
                      const lv = ev.level || 'D';
                      const tone = lv === 'A' ? 'green' : lv === 'B' ? 'blue' : lv === 'C' ? 'orange' : 'red';
                      return (
                        <div key={ev.id} className="rounded-lg border border-[#dce6f3] p-2.5 text-xs">
                          <div className="flex items-center gap-2">
                            <StatusBadge tone={tone as any}>{lv}</StatusBadge>
                            <strong className="text-[#18243a]">{Number(ev.score)}分</strong>
                            <span className="text-[#8a99ad]">{ev.evaluator?.displayName || '—'}</span>
                            <span className="ml-auto text-[#8a99ad]">{new Date(ev.createdAt).toLocaleDateString('zh-CN')}</span>
                          </div>
                          {ev.comment && <p className="mt-1 text-[#5a6d8a]">{ev.comment}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-[#edf2f7] px-6 py-4">
              <button onClick={() => setEvalModal(null)}
                className="rounded-xl border border-[#dce3eb] px-4 py-2 text-sm font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition">取消</button>
              <button onClick={submit} disabled={saving}
                className="rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-bold text-white hover:bg-[#054280] disabled:opacity-50 transition">
                {saving ? '提交中...' : '提交评价'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
