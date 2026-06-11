'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { getSupplierList, getSupplierEvaluations, createEvaluation, getEvaluationStats } from '@/lib/api/supplier';
import type { Supplier, SupplierEvaluation } from '@/lib/types';

export default function EvaluationPage() {
  const router = useRouter();
  const [stats, setStats] = useState<{ levelCounts: { A: number; B: number; C: number; D: number }; avgScore: number; total: number } | null>(null);
  const [evaluations, setEvaluations] = useState<(SupplierEvaluation & { supplierName?: string })[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchSupplier, setSearchSupplier] = useState('');

  // 发起评价弹窗
  const [createModal, setCreateModal] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [scores, setScores] = useState({ completeness: 0, responsiveness: 0, cooperation: 0, compliance: 0, overall: 0 });
  const [comment, setComment] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  // 评价详情弹窗
  const [detailEvaluation, setDetailEvaluation] = useState<SupplierEvaluation | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, supplierRes] = await Promise.all([
        getEvaluationStats().catch(() => null),
        getSupplierList({ status: 'APPROVED', pageSize: 100 }),
      ]);
      setStats(statsRes);
      setSuppliers(supplierRes.items);

      // 加载各供应商的评价记录
      const allEvals: (SupplierEvaluation & { supplierName?: string })[] = [];
      for (const s of supplierRes.items.slice(0, 20)) {
        try {
          const evals = await getSupplierEvaluations(s.id);
          allEvals.push(...evals.map(e => ({ ...e, supplierName: s.name })));
        } catch { /* empty */ }
      }
      allEvals.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setEvaluations(allEvals);
    } catch { /* empty */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    if (!selectedSupplierId) return;
    setCreateLoading(true);
    try {
      await createEvaluation(selectedSupplierId, {
        completenessScore: scores.completeness,
        responsivenessScore: scores.responsiveness,
        cooperationScore: scores.cooperation,
        complianceScore: scores.compliance,
        overallScore: scores.overall,
        comment: comment || undefined,
      });
      setCreateModal(false);
      setSelectedSupplierId('');
      setScores({ completeness: 0, responsiveness: 0, cooperation: 0, compliance: 0, overall: 0 });
      setComment('');
      loadData();
    } catch { /* empty */ }
    setCreateLoading(false);
  };

  const filteredSuppliers = searchSupplier
    ? suppliers.filter(s => s.name.includes(searchSupplier) || s.creditCode.includes(searchSupplier))
    : suppliers;

  const levelColor = (level: string) => {
    switch (level) {
      case 'A': return { color: '#11a874', bg: '#11a87418' };
      case 'B': return { color: '#064ea2', bg: '#064ea218' };
      case 'C': return { color: '#f5a623', bg: '#f5a62318' };
      case 'D': return { color: '#e74c3c', bg: '#e74c3c18' };
      default: return { color: '#999', bg: '#99918' };
    }
  };

  const totalScore = scores.completeness + scores.responsiveness + scores.cooperation + scores.compliance + scores.overall;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[oklch(0.18_0.012_265)]">评价管理</h1>
          <p className="text-sm text-[oklch(0.55_0.01_264)] mt-1">评价列表、发起评价、评价统计、异常记录</p>
        </div>
        <button onClick={() => setCreateModal(true)}
          className="px-5 py-2 bg-[#064ea2] text-white rounded-lg font-semibold hover:bg-[#0e62d0] transition">发起评价</button>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
          <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">总评价数</p>
          <p className="text-3xl font-bold text-[oklch(0.18_0.012_265)]">{stats?.total ?? 0}</p>
        </div>
        {stats && (['A', 'B', 'C', 'D'] as const).map(level => {
          const lc = levelColor(level);
          return (
            <div key={level} className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5">
              <div className="flex items-center gap-2 mb-1">
                <span className="px-1.5 py-0.5 text-xs font-bold rounded" style={{ color: lc.color, backgroundColor: lc.bg }}>{level}</span>
                <span className="text-xs text-[oklch(0.55_0.01_264)]">级</span>
              </div>
              <p className="text-3xl font-bold" style={{ color: lc.color }}>{stats.levelCounts[level]}</p>
            </div>
          );
        })}
      </div>

      {stats && stats.total > 0 && (
        <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)] p-5 mb-6 flex items-center gap-8">
          <div>
            <p className="text-xs text-[oklch(0.55_0.01_264)] mb-1">平均评分</p>
            <p className="text-2xl font-bold text-[#064ea2]">{stats.avgScore.toFixed(1)}<span className="text-sm font-normal text-[oklch(0.55_0.01_264)]"> / 100</span></p>
          </div>
          {/* 等级分布条 */}
          <div className="flex-1">
            <p className="text-xs text-[oklch(0.55_0.01_264)] mb-2">等级分布</p>
            <div className="flex h-4 rounded-full overflow-hidden bg-[oklch(0.992_0.003_264)]">
              {(['A', 'B', 'C', 'D'] as const).map(level => {
                const count = stats.levelCounts[level];
                if (count === 0) return null;
                return <div key={level} style={{ width: `${(count / stats.total) * 100}%`, backgroundColor: levelColor(level).color }} className="transition-all" />;
              })}
            </div>
            <div className="flex justify-between mt-1 text-xs text-[oklch(0.55_0.01_264)]">
              {(['A', 'B', 'C', 'D'] as const).map(level => (
                <span key={level}>{level}: {stats.levelCounts[level]}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 评价记录列表 */}
      <div className="bg-white rounded-xl border border-[oklch(0.91_0.006_264)]">
        <div className="px-5 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <h2 className="font-bold text-[oklch(0.18_0.012_265)]">评价记录</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
              <th className="px-5 py-3">供应商</th>
              <th className="px-5 py-3">评分</th>
              <th className="px-5 py-3">等级</th>
              <th className="px-5 py-3">评价人</th>
              <th className="px-5 py-3">评价时间</th>
              <th className="px-5 py-3">意见</th>
              <th className="px-5 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-[oklch(0.55_0.01_264)]">加载中...</td></tr>
            ) : evaluations.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-[oklch(0.55_0.01_264)]">暂无评价记录</td></tr>
            ) : evaluations.map(e => {
              const lc = levelColor(e.level);
              return (
                <tr key={e.id} className="border-b border-[oklch(0.91_0.006_264)] hover:bg-[oklch(0.992_0.003_264)]">
                  <td className="px-5 py-3 font-semibold text-[#064ea2] cursor-pointer" onClick={() => router.push(`/supplier/${e.supplierId}`)}>{e.supplierName || '—'}</td>
                  <td className="px-5 py-3 font-bold text-[oklch(0.18_0.012_265)]">{e.score}分</td>
                  <td className="px-5 py-3"><span className="px-2 py-0.5 text-xs font-semibold rounded" style={{ color: lc.color, backgroundColor: lc.bg }}>{e.level}</span></td>
                  <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{e.evaluator?.displayName || '—'}</td>
                  <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{new Date(e.createdAt).toLocaleDateString('zh-CN')}</td>
                  <td className="px-5 py-3 text-[oklch(0.55_0.01_264)] max-w-[200px] truncate">{e.comment || '—'}</td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => setDetailEvaluation(e)} className="text-xs text-[#064ea2] hover:underline">详情</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 发起评价弹窗 */}
      {createModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setCreateModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[oklch(0.18_0.012_265)] mb-4">发起评价</h3>

            {/* 选择供应商 */}
            <div className="mb-4">
              <label className="text-sm font-semibold text-[oklch(0.18_0.012_265)] mb-1 block">选择供应商</label>
              <input value={searchSupplier} onChange={e => setSearchSupplier(e.target.value)}
                placeholder="搜索供应商名称..." className="w-full px-3 py-2 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm mb-2 focus:outline-none focus:border-[#064ea2]" />
              <select value={selectedSupplierId} onChange={e => setSelectedSupplierId(e.target.value)}
                className="w-full px-3 py-2 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]">
                <option value="">请选择供应商</option>
                {filteredSuppliers.slice(0, 20).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>

            {/* 评分项 */}
            <div className="space-y-3 mb-4">
              {[
                { key: 'completeness' as const, label: '资料完整性', desc: '20%', max: 20 },
                { key: 'responsiveness' as const, label: '文件响应情况', desc: '30%', max: 30 },
                { key: 'cooperation' as const, label: '参与配合情况', desc: '20%', max: 20 },
                { key: 'compliance' as const, label: '规范合规情况', desc: '20%', max: 20 },
                { key: 'overall' as const, label: '综合评价', desc: '10%', max: 10 },
              ].map(item => (
                <div key={item.key} className="flex items-center gap-3">
                  <div className="w-32">
                    <p className="text-sm text-[oklch(0.18_0.012_265)]">{item.label}</p>
                    <p className="text-xs text-[oklch(0.55_0.01_264)]">权重 {item.desc}</p>
                  </div>
                  <input type="range" min={0} max={item.max} value={scores[item.key]}
                    onChange={e => setScores(s => ({ ...s, [item.key]: Number(e.target.value) }))}
                    className="flex-1 accent-[#064ea2]" />
                  <span className="w-10 text-right text-sm font-bold text-[oklch(0.18_0.012_265)]">{scores[item.key]}</span>
                </div>
              ))}
            </div>

            {/* 总分 */}
            <div className="bg-[oklch(0.992_0.003_264)] rounded-lg p-3 mb-4 flex justify-between items-center">
              <span className="text-sm text-[oklch(0.55_0.01_264)]">总分</span>
              <span className="text-lg font-bold text-[#064ea2]">{totalScore} / 100</span>
            </div>

            {/* 评价意见 */}
            <textarea value={comment} onChange={e => setComment(e.target.value)}
              placeholder="评价意见（选填）..."
              className="w-full px-3 py-2 border border-[oklch(0.91_0.006_264)] rounded-lg text-sm mb-4 h-20 resize-none focus:outline-none focus:border-[#064ea2]" />

            <div className="flex justify-end gap-3">
              <button onClick={() => setCreateModal(false)} className="px-4 py-2 text-sm text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.992_0.003_264)] rounded-lg transition">取消</button>
              <button onClick={handleCreate} disabled={createLoading || !selectedSupplierId || totalScore === 0}
                className="px-4 py-2 text-sm text-white bg-[#064ea2] hover:bg-[#0e62d0] rounded-lg transition disabled:opacity-50">
                {createLoading ? '提交中...' : '提交评价'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 评价详情弹窗 */}
      {detailEvaluation && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setDetailEvaluation(null)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-[oklch(0.18_0.012_265)] mb-4">评价详情</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-[oklch(0.55_0.01_264)]">评分</span>
                <span className="text-lg font-bold text-[#064ea2]">{detailEvaluation.score}分</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-[oklch(0.55_0.01_264)]">等级</span>
                <span className="px-2 py-0.5 text-xs font-semibold rounded" style={{ color: levelColor(detailEvaluation.level).color, backgroundColor: levelColor(detailEvaluation.level).bg }}>
                  {detailEvaluation.level}
                </span>
              </div>
              <hr className="border-[oklch(0.91_0.006_264)]" />
              {[
                ['资料完整性', `${detailEvaluation.completenessScore} / 20`],
                ['文件响应情况', `${detailEvaluation.responsivenessScore} / 30`],
                ['参与配合情况', `${detailEvaluation.cooperationScore} / 20`],
                ['规范合规情况', `${detailEvaluation.complianceScore} / 20`],
                ['综合评价', `${detailEvaluation.overallScore} / 10`],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-[oklch(0.55_0.01_264)]">{label}</span>
                  <span className="font-semibold text-[oklch(0.18_0.012_265)]">{value}</span>
                </div>
              ))}
              <hr className="border-[oklch(0.91_0.006_264)]" />
              <div>
                <p className="text-sm text-[oklch(0.55_0.01_264)] mb-1">评价意见</p>
                <p className="text-sm text-[oklch(0.18_0.012_265)]">{detailEvaluation.comment || '无'}</p>
              </div>
              <div className="flex justify-between text-xs text-[oklch(0.55_0.01_264)]">
                <span>评价人：{detailEvaluation.evaluator?.displayName || '—'}</span>
                <span>{new Date(detailEvaluation.createdAt).toLocaleString('zh-CN')}</span>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={() => setDetailEvaluation(null)} className="px-4 py-2 text-sm text-[oklch(0.55_0.01_264)] hover:bg-[oklch(0.992_0.003_264)] rounded-lg transition">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
