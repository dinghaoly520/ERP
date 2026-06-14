'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import ProjectSelector from '@/components/project-selector';
import { TableSkeleton } from '@/components/skeleton';
import { toast } from 'sonner';
import { Users, FileText, ClipboardCheck } from 'lucide-react';

type EvalResult = {
  id: string; supplierName: string; totalScore: string; averageScore: string;
  rank: number; recommended: boolean; generatedAt: string;
};

export default function BidEvaluatePage() {
  const [projectId, setProjectId] = useState('');
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSupplier, setActiveSupplier] = useState('');
  const [scores, setScores] = useState<Record<string, string>>({});
  const [results, setResults] = useState<EvalResult[]>([]);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    api.get<{id:string}[]>('/bid/projects').then(ps => { if (ps.length) setProjectId(ps[0].id); });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(p => {
      setProject(p);
      setActiveSupplier(p.suppliers[0]?.supplierName || '');
      setLoading(false);
    });
    api.get<EvalResult[]>(`/bid/projects/${projectId}/evaluation-results`).then(setResults).catch(() => setResults([]));
  }, [projectId]);

  const reload = () => { if (projectId) api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject); };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const r = await api.post<EvalResult[]>(`/bid/projects/${projectId}/evaluation-results/generate`, {});
      setResults(r);
      toast.success('评标结果已生成');
    } catch (e: any) {
      toast.error(e.message || '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleSubmitScore = async (scoreItemId: string, expertId: string) => {
    const v = scores[`${expertId}-${scoreItemId}`];
    if (!v || Number(v) < 0) { toast.error('请填写有效分数'); return; }
    try {
      await api.post(`/bid/projects/${projectId}/scores`, { expertId, scoreItemId, score: Number(v) });
      toast.success('评分已提交');
      setScores(p => { const n = { ...p }; delete n[`${expertId}-${scoreItemId}`]; return n; });
      reload();
    } catch { toast.error('提交失败'); }
  };

  if (loading) return <TableSkeleton rows={8} cols={6} />;
  if (!project) return <div className="text-[13px] text-[oklch(0.62_0.008_264)] text-center py-20">暂无项目数据</div>;

  const experts = project.experts;
  const cur = experts.length > 0 ? experts[0] : null;
  const totalMax = project.scoreItems.reduce((s, i) => s + Number(i.maxScore), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-[oklch(0.18_0.012_265)]" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>专家评标端</h1>
          <p className="text-[14px] text-[oklch(0.55_0.01_264)] mt-1">身份核验 · 独立评审 · AI辅助</p>
        </div>
        <ProjectSelector value={projectId} onChange={setProjectId} />
      </div>

      {/* Verification steps */}
      <div className="flex gap-px bg-[oklch(0.91_0.006_264)] mb-8">
        {['身份核验', '保密承诺', '回避确认', '评标纪律'].map((s, i) => (
          <div key={i} className="flex-1 bg-white p-3 flex items-center gap-2 text-[12px] text-[oklch(0.54_0.16_158)] font-semibold tracking-tight">
            <span className="text-[10px]">✓</span> {s}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-[240px_1fr_360px] gap-6">
        {/* Supplier list */}
        <div className="bg-white border border-[oklch(0.91_0.006_264)] p-4">
          <h2 className="text-[11px] font-semibold text-[oklch(0.55_0.01_264)] uppercase tracking-widest mb-3">投标单位</h2>
          {project.suppliers.map(s => (
            <button key={s.id} onClick={() => setActiveSupplier(s.supplierName)}
              className={`block w-full text-left p-3 mb-1 text-[13px] border transition-colors ${activeSupplier === s.supplierName ? 'border-[oklch(0.42_0.14_260)] bg-[oklch(0.97_0.008_262)]' : 'border-transparent hover:bg-[oklch(0.992_0.003_264)]'}`}>
              <div className="font-semibold text-[oklch(0.18_0.012_265)] tracking-tight">{s.supplierName}</div>
              <div className="text-[11px] text-[oklch(0.62_0.008_264)] mt-0.5">{s.encryptStatus}</div>
            </button>
          ))}
        </div>

        {/* Document summary */}
        <div className="bg-white border border-[oklch(0.91_0.006_264)] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>文件与响应摘要</h2>
            <span className="text-[12px] font-medium text-[oklch(0.42_0.14_260)] tracking-tight">{activeSupplier}</span>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[
              { label: '资格文件', val: '已提交' }, { label: '技术响应', val: '完整' }, { label: '商务报价', val: '有效区间' },
            ].map(t => (
              <div key={t.label} className="bg-[oklch(0.982_0.003_264)] border border-[oklch(0.91_0.006_264)] p-4">
                <div className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight">{t.label}</div>
                <div className="text-[12px] text-[oklch(0.55_0.01_264)] mt-1">{t.val}</div>
              </div>
            ))}
          </div>
          {project.clarifications.length > 0 && (
            <div className="bg-[oklch(0.96_0.04_85)] border border-[oklch(0.88_0.06_82)] p-4">
              <h3 className="text-[12px] font-semibold text-[oklch(0.18_0.012_265)] mb-2">澄清说明</h3>
              {project.clarifications.map(c => (
                <p key={c.id} className="text-[12px] text-[oklch(0.55_0.01_264)]">{c.question} —— {c.status}：{c.reply}</p>
              ))}
            </div>
          )}
        </div>

        {/* Scoring panel */}
        <div className="bg-white border border-[oklch(0.91_0.006_264)] p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>评分表</h2>
            {cur && <span className="text-[12px] font-medium text-[oklch(0.42_0.14_260)] tracking-tight">{cur.expertName}</span>}
          </div>
          {cur && project.scoreItems.map(item => (
            <div key={item.id} className="border-b border-[oklch(0.94_0.004_264)] py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight">{item.name}</span>
                <span className="text-[11px] text-[oklch(0.62_0.008_264)]">{item.maxScore > 0 ? `满分 ${item.maxScore}` : '通过/不通过'}</span>
              </div>
              {item.maxScore > 0 && (
                <div className="flex gap-2">
                  <input type="number" min={0} max={Number(item.maxScore)} step={0.5} placeholder="打分"
                    value={scores[`${cur.id}-${item.id}`] || ''}
                    onChange={e => setScores(p => ({ ...p, [`${cur.id}-${item.id}`]: e.target.value }))}
                    className="flex-1 px-3 py-1.5 border border-[oklch(0.91_0.006_264)] text-[13px] bg-[oklch(0.992_0.001_264)] focus:outline-none focus:border-[oklch(0.42_0.14_260)]" />
                  <button onClick={() => handleSubmitScore(item.id, cur.id)}
                    className="px-4 py-1.5 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors">提交</button>
                </div>
              )}
            </div>
          ))}
          <div className="pt-3 flex items-center justify-between">
            <span className="text-[13px] text-[oklch(0.18_0.012_265)] tracking-tight">总分满分</span>
            <span className="text-xl font-bold font-mono text-[oklch(0.42_0.14_260)] tracking-tight">{totalMax}</span>
          </div>
        </div>
      </div>

      {/* 评标结果汇总 */}
      <div className="bg-white border border-[oklch(0.91_0.006_264)] mt-8">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <div>
            <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight" style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}>评标结果汇总</h2>
            <p className="text-[11px] text-[oklch(0.62_0.008_264)] mt-1">需所有专家确认评审报告后方可生成；按平均分排名，第一名推荐为中标候选人。</p>
          </div>
          <button onClick={handleGenerate} disabled={generating}
            className="px-4 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors disabled:opacity-50">
            {generating ? '生成中…' : '生成评标结果'}
          </button>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">排名</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">投标单位</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">总分</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">平均分</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">推荐</th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-12 text-center text-[13px] text-[oklch(0.62_0.008_264)]">暂未生成评标结果</td></tr>
            ) : results.map(r => (
              <tr key={r.id} className="border-b border-[oklch(0.94_0.004_264)]">
                <td className="px-5 py-3 font-mono font-bold text-[oklch(0.18_0.012_265)]">{r.rank}</td>
                <td className="px-5 py-3 font-medium text-[oklch(0.18_0.012_265)]">{r.supplierName}</td>
                <td className="px-5 py-3 font-mono text-[oklch(0.18_0.012_265)]">{r.totalScore}</td>
                <td className="px-5 py-3 font-mono font-bold text-[oklch(0.42_0.14_260)]">{r.averageScore}</td>
                <td className="px-5 py-3">
                  {r.recommended
                    ? <span className="text-[11px] font-semibold px-2 py-0.5 tracking-wide text-[#11a874] bg-[#f0faf6]">第一中标候选人</span>
                    : <span className="text-[11px] text-[oklch(0.62_0.008_264)]">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
