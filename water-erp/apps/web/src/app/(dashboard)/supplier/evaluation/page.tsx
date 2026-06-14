'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  getSupplierList, getEvaluationStats, getSupplierEvaluations, createEvaluation,
} from '@/lib/api/supplier';
import type { Supplier, SupplierEvaluation, SupplierListResponse } from '@/lib/types';

const levelColor: Record<string, { label: string; color: string; bg: string }> = {
  A: { label: '优秀', color: '#11a874', bg: '#11a87418' },
  B: { label: '良好', color: '#064ea2', bg: '#064ea218' },
  C: { label: '合格', color: '#f5a623', bg: '#f5a62318' },
  D: { label: '不合格', color: '#e74c3c', bg: '#e74c3c18' },
};

interface EvalStats { levelCounts: { A: number; B: number; C: number; D: number }; avgScore: number; total: number; }

const DIMENSIONS: { key: keyof Pick<SupplierEvaluation, 'completenessScore' | 'responsivenessScore' | 'cooperationScore' | 'complianceScore' | 'overallScore'>; label: string; hint: string }[] = [
  { key: 'completenessScore', label: '资料完整性', hint: '资质材料、投标文件的完整与规范程度' },
  { key: 'responsivenessScore', label: '响应及时性', hint: '沟通回复与问题响应速度' },
  { key: 'cooperationScore', label: '配合协作度', hint: '履约过程中的配合与协作意愿' },
  { key: 'complianceScore', label: '合规守信度', hint: '合同履约、合规与诚信情况' },
  { key: 'overallScore', label: '综合满意度', hint: '对供应商的总体评价' },
];

export default function SupplierEvaluationPage() {
  const router = useRouter();
  const [data, setData] = useState<SupplierListResponse>({ total: 0, page: 1, pageSize: 20, items: [] });
  const [evalStats, setEvalStats] = useState<EvalStats>({ levelCounts: { A: 0, B: 0, C: 0, D: 0 }, avgScore: 0, total: 0 });
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
      setHistory(await getSupplierEvaluations(evalModal.id));
      setEvalModal(null);
      getEvaluationStats().then(setEvalStats).catch(() => {});
    } catch (e: any) { alert(e?.message || '评价提交失败'); }
    setSaving(false);
  };

  const totalPages = Math.ceil(data.total / 20);

  return (
    <div>
      <div className="mb-6">
        <div className="mb-2 inline-flex rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-1 text-xs font-semibold text-[#11a874]">供应商管理中心</div>
        <h1 className="text-2xl font-bold text-[#0f2f57]">供应商评价</h1>
        <p className="text-sm text-[#5a6d8a] mt-1">供应商履约评价：完整性 / 响应性 / 配合度 / 合规性 / 综合满意度</p>
      </div>

      {/* 评价等级分布 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {(['A', 'B', 'C', 'D'] as const).map(lv => (
          <div key={lv} className="bg-white rounded-xl border border-[#e5ecf4] p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#5a6d8a]">{lv}级 · {levelColor[lv].label}</span>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: levelColor[lv].color }} />
            </div>
            <p className="text-3xl font-bold mt-1" style={{ color: levelColor[lv].color }}>{evalStats.levelCounts[lv]}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-[#e5ecf4] p-4 mb-6 flex items-center gap-6 text-sm">
        <span className="text-[#5a6d8a]">累计评价 <strong className="text-[#18243a] text-base">{evalStats.total}</strong> 次</span>
        <span className="text-[#5a6d8a]">平均得分 <strong className="text-[#064ea2] text-base">{evalStats.avgScore.toFixed(1)}</strong></span>
      </div>

      {/* 搜索 */}
      <div className="bg-white rounded-xl border border-[#e5ecf4] p-4 mb-4 flex gap-3 items-center">
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="搜索供应商名称" className="flex-1 px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]" />
      </div>

      {/* 供应商列表 */}
      <div className="bg-white rounded-xl border border-[#e5ecf4]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5ecf4] text-left text-[#5a6d8a]">
              <th className="px-5 py-3">企业名称</th>
              <th className="px-5 py-3">分类</th>
              <th className="px-5 py-3">评价次数</th>
              <th className="px-5 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-5 py-10 text-center text-[#5a6d8a]">加载中...</td></tr>
            ) : data.items.length === 0 ? (
              <tr><td colSpan={4} className="px-5 py-10 text-center text-[#5a6d8a]">暂无供应商</td></tr>
            ) : data.items.map((s: Supplier) => (
              <tr key={s.id} className="border-b border-[#e5ecf4] hover:bg-[#f8fafc]">
                <td className="px-5 py-3 font-semibold text-[#064ea2] cursor-pointer" onClick={() => router.push(`/supplier/${s.id}`)}>{s.name}</td>
                <td className="px-5 py-3 text-[#5a6d8a]">{s.classification?.name || '—'}</td>
                <td className="px-5 py-3">
                  <span className="rounded-full bg-[#eff6ff] px-2 py-1 text-xs font-semibold text-[#064ea2]">{s._count?.evaluations ?? 0} 次</span>
                </td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => openEvalModal(s)} className="px-3 py-1 text-xs text-white bg-[#064ea2] hover:bg-[#054280] rounded transition">评价 / 查看</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="flex justify-between items-center px-5 py-3 border-t border-[#e5ecf4]">
            <span className="text-xs text-[#5a6d8a]">共 {data.total} 条，第 {page}/{totalPages} 页</span>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-xs border border-[#e5ecf4] rounded hover:bg-[#f8fafc] disabled:opacity-40 transition">上一页</button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-xs border border-[#e5ecf4] rounded hover:bg-[#f8fafc] disabled:opacity-40 transition">下一页</button>
            </div>
          </div>
        )}
      </div>

      {/* 评价弹窗 */}
      {evalModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setEvalModal(null)}>
          <div className="bg-white rounded-xl w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-[#e5ecf4]">
              <h3 className="text-lg font-bold text-[#18243a]">供应商评价</h3>
              <p className="text-sm text-[#5a6d8a] mt-1">{evalModal.name}</p>
            </div>

            <div className="p-6">
              {/* 评分维度 */}
              <div className="space-y-4 mb-5">
                {DIMENSIONS.map(d => (
                  <div key={d.key}>
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <span className="text-sm font-semibold text-[#18243a]">{d.label}</span>
                        <span className="ml-2 text-xs text-[#5a6d8a]">{d.hint}</span>
                      </div>
                      <span className="text-sm font-bold text-[#064ea2] w-8 text-right">{scores[d.key]}</span>
                    </div>
                    <input
                      type="range" min={0} max={20} step={1} value={scores[d.key]}
                      onChange={e => setScores({ ...scores, [d.key]: Number(e.target.value) })}
                      className="w-full accent-[#064ea2]"
                    />
                  </div>
                ))}
              </div>

              {/* 总分预览 */}
              <div className="flex items-center gap-3 rounded-xl bg-[#f0f6ff] border border-[#bcd0e8] p-3 mb-4">
                <span className="text-sm text-[#5a6d8a]">总分</span>
                <strong className="text-xl text-[#064ea2]">{totalScore}</strong>
                <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ color: levelColor[previewLevel].color, backgroundColor: levelColor[previewLevel].bg }}>{levelColor[previewLevel].label}（{previewLevel}级）</span>
                <span className="ml-auto text-xs text-[#5a6d8a]">A≥90 · B≥80 · C≥60 · D&lt;60</span>
              </div>

              <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="评价说明（可选）" className="w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm mb-5 h-20 resize-none focus:outline-none focus:border-[#064ea2]" />

              {/* 历史评价 */}
              {history.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold text-[#18243a] mb-2">历史评价（{history.length}）</h4>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {history.map(ev => {
                      const lv = levelColor[ev.level] || levelColor.D;
                      return (
                        <div key={ev.id} className="rounded-lg border border-[#e5ecf4] p-2.5 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded font-semibold" style={{ color: lv.color, backgroundColor: lv.bg }}>{ev.level}</span>
                            <strong className="text-[#18243a]">{Number(ev.score)}分</strong>
                            <span className="text-[#5a6d8a]">{ev.evaluator?.displayName || '—'}</span>
                            <span className="text-[#5a6d8a] ml-auto">{new Date(ev.createdAt).toLocaleDateString('zh-CN')}</span>
                          </div>
                          {ev.comment && <p className="text-[#5a6d8a] mt-1">{ev.comment}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-[#e5ecf4] flex justify-end gap-3">
              <button onClick={() => setEvalModal(null)} className="px-4 py-2 text-sm text-[#5a6d8a] hover:bg-[#f8fafc] rounded-lg transition">取消</button>
              <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm text-white bg-[#064ea2] hover:bg-[#054280] rounded-lg disabled:opacity-50 transition">{saving ? '提交中...' : '提交评价'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
