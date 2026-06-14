'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { listExperts, getExpertEvalStats, createExpertEvaluation } from '@/lib/api/expert';
import type { ExpertListItem, ExpertEvalStats } from '@/lib/api/expert';
import { Search, X } from 'lucide-react';

const levelColor: Record<string, string> = { A: '#059669', B: '#0756a5', C: '#d97706', D: '#dc2626' };
const levelLabel: Record<string, string> = { A: '优秀', B: '良好', C: '合格', D: '不合格' };

const DIMENSIONS: { key: 'attendanceScore' | 'qualityScore' | 'disciplineScore'; label: string; hint: string }[] = [
  { key: 'attendanceScore', label: '出勤纪律', hint: '按时签到、遵守评审纪律' },
  { key: 'qualityScore', label: '评审质量', hint: '评分客观、专业、有依据' },
  { key: 'disciplineScore', label: '廉洁纪律', hint: '无违规、无利益输送' },
];

export default function ExpertEvaluationPage() {
  const router = useRouter();
  const [experts, setExperts] = useState<ExpertListItem[]>([]);
  const [stats, setStats] = useState<ExpertEvalStats>({ levelCounts: { A: 0, B: 0, C: 0, D: 0 }, avgScore: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [target, setTarget] = useState<ExpertListItem | null>(null);
  const [scores, setScores] = useState({ attendanceScore: 85, qualityScore: 85, disciplineScore: 90 });
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setExperts(await listExperts({ search: search || undefined }) as ExpertListItem[]); }
    catch { /* empty */ }
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getExpertEvalStats().then(setStats).catch(() => {}); }, [experts.length]);

  const overall = Math.round((scores.attendanceScore + scores.qualityScore + scores.disciplineScore) / 3);
  const previewLevel = overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 60 ? 'C' : 'D';

  const openModal = (e: ExpertListItem) => {
    setTarget(e);
    setScores({ attendanceScore: 85, qualityScore: 85, disciplineScore: 90 });
    setComment('');
  };

  const submit = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await createExpertEvaluation({ expertUserId: target.id, ...scores, comment: comment || undefined });
      setTarget(null); load();
      getExpertEvalStats().then(setStats).catch(() => {});
    } catch (e: any) { alert(e?.message || '评价失败'); }
    setSaving(false);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-end justify-between gap-4 mb-7 pb-4 border-b border-[#dce3eb]">
        <div>
          <div className="text-[11px] font-extrabold text-[#0756a5] uppercase tracking-[0.1em]">Expert Evaluation</div>
          <h1 className="mt-1 text-[22px] font-black tracking-[-0.03em] text-[#0f172a]">专家评价</h1>
          <p className="mt-1 text-[13px] text-[#64748b]">评审专家履职评价：出勤纪律 / 评审质量 / 廉洁纪律。</p>
        </div>
      </div>

      {/* Level distribution + stats */}
      <div className="grid grid-cols-4 gap-0 border border-[#dce3eb] bg-white mb-5">
        {(['A', 'B', 'C', 'D'] as const).map((lv, i) => (
          <div key={lv} className={`px-5 py-4 ${i < 3 ? 'border-r border-[#e9eef4]' : ''}`}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-5 h-5 flex items-center justify-center text-[11px] font-black text-white" style={{backgroundColor: levelColor[lv]}}>{lv}</span>
              <span className="text-[12px] font-semibold text-[#64748b]">{levelLabel[lv]}</span>
            </div>
            <div className="text-[26px] font-black tabular-nums" style={{color: levelColor[lv]}}>{stats.levelCounts[lv]}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-8 px-5 py-3 border border-[#dce3eb] bg-white mb-5 text-[13px]">
        <span className="text-[#64748b]">累计评价 <strong className="text-[#0f172a]">{stats.total}</strong> 次</span>
        <span className="text-[#64748b]">平均得分 <strong className="text-[#0756a5]">{stats.avgScore}</strong></span>
      </div>

      {/* Search + table */}
      <div className="flex items-center gap-3 px-4 py-2.5 border border-[#dce3eb] bg-white mb-0.5">
        <Search size={15} className="text-[#94a3b8] flex-shrink-0" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索专家姓名" className="flex-1 text-[13px] placeholder:text-[#94a3b8] border-none outline-none bg-transparent" />
      </div>

      <div className="border border-[#dce3eb] border-t-0 bg-white">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#e9eef4] text-left">
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#94a3b8]">专家</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#94a3b8]">专业</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#94a3b8]">工作单位</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#94a3b8]">获评次数</th>
              <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#94a3b8] text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-5 py-14 text-center text-[#94a3b8]">加载中...</td></tr>
            ) : experts.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-14 text-center text-[#94a3b8]">暂无专家</td></tr>
            ) : experts.map(e => (
              <tr key={e.id} className="border-b border-[#e9eef4] hover:bg-[#f8fafc] last:border-b-0">
                <td className="px-5 py-3 font-extrabold text-[#0f172a] cursor-pointer hover:text-[#0756a5]" onClick={() => router.push(`/expert/${e.id}`)}>{e.displayName}</td>
                <td className="px-5 py-3 text-[#64748b]">{e.expertProfile?.specialty || '—'}</td>
                <td className="px-5 py-3 text-[#64748b]">{e.expertProfile?.employer || '—'}</td>
                <td className="px-5 py-3"><span className="text-[11px] font-bold text-[#0756a5]">{e._count.expertEvaluations}</span></td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => openModal(e)} className="px-3 py-1.5 text-[12px] font-bold text-white bg-[#0756a5] hover:bg-[#06428a] transition">履职评价</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {target && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setTarget(null)}>
          <div className="bg-white w-full max-w-lg border border-[#dce3eb]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#dce3eb]">
              <div>
                <h3 className="text-[15px] font-extrabold text-[#0f172a]">专家履职评价</h3>
                <p className="text-[12px] text-[#64748b] mt-0.5">{target.displayName} · {target.expertProfile?.specialty}</p>
              </div>
              <button onClick={() => setTarget(null)} className="p-1 text-[#94a3b8] hover:text-[#64748b]"><X size={18} /></button>
            </div>

            <div className="p-6">
              <div className="space-y-5 mb-6">
                {DIMENSIONS.map(d => (
                  <div key={d.key}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <span className="text-[13px] font-bold text-[#0f172a]">{d.label}</span>
                        <span className="ml-2 text-[11px] text-[#94a3b8]">{d.hint}</span>
                      </div>
                      <span className="text-[14px] font-black text-[#0756a5] tabular-nums w-9 text-right">{scores[d.key]}</span>
                    </div>
                    <input type="range" min={0} max={100} step={1} value={scores[d.key]} onChange={e => setScores({ ...scores, [d.key]: Number(e.target.value) })} className="w-full accent-[#0756a5] h-1.5" />
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 px-4 py-3 border border-[#dce3eb] bg-[#f8fafc] mb-5">
                <span className="text-[12px] font-semibold text-[#64748b]">综合得分</span>
                <strong className="text-[20px] font-black text-[#0756a5] tabular-nums">{overall}</strong>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-bold" style={{color: levelColor[previewLevel], background: levelColor[previewLevel] + '14'}}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{background:levelColor[previewLevel]}} />
                  {levelLabel[previewLevel]}（{previewLevel}级）
                </span>
                <span className="ml-auto text-[11px] text-[#94a3b8]">A≥90 · B≥80 · C≥60 · D&lt;60</span>
              </div>

              <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="评价说明（可选）" className="w-full px-3 py-2 border border-[#dce3eb] text-[13px] placeholder:text-[#94a3b8] h-20 resize-none focus:outline-none focus:border-[#0756a5]" />
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#dce3eb]">
              <button onClick={() => setTarget(null)} className="px-4 py-2 text-[13px] font-semibold text-[#64748b] border border-[#dce3eb] hover:bg-[#f8fafc] transition">取消</button>
              <button onClick={submit} disabled={saving} className="px-4 py-2 text-[13px] font-bold text-white bg-[#0756a5] hover:bg-[#06428a] disabled:opacity-50 transition">{saving ? '提交中...' : '提交评价'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
