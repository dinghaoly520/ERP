'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { listExperts, getExpertEvalStats, createExpertEvaluation } from '@/lib/api/expert';
import type { ExpertListItem, ExpertEvalStats } from '@/lib/api/expert';

const levelColor: Record<string, { label: string; color: string }> = {
  A: { label: '优秀', color: '#11a874' },
  B: { label: '良好', color: '#7c3aed' },
  C: { label: '合格', color: '#f5a623' },
  D: { label: '不合格', color: '#e74c3c' },
};

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
    try {
      const res = await listExperts({ search: search || undefined });
      setExperts(res as ExpertListItem[]);
    } catch { /* empty */ }
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
      setTarget(null);
      load();
      getExpertEvalStats().then(setStats).catch(() => {});
    } catch (e: any) { alert(e?.message || '评价失败'); }
    setSaving(false);
  };

  return (
    <div>
      <div className="mb-6">
        <div className="mb-2 inline-flex rounded-full border border-[#ddd6fe] bg-[#f5f3ff] px-3 py-1 text-xs font-semibold text-[#7c3aed]">专家管理中心</div>
        <h1 className="text-2xl font-bold text-[#0f2f57]">专家评价</h1>
        <p className="text-sm text-[#5a6d8a] mt-1">评审专家履职评价：出勤纪律 / 评审质量 / 廉洁纪律</p>
      </div>

      {/* 等级分布 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {(['A', 'B', 'C', 'D'] as const).map(lv => (
          <div key={lv} className="bg-white rounded-xl border border-[#e5ecf4] p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-[#5a6d8a]">{lv}级 · {levelColor[lv].label}</span>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: levelColor[lv].color }} />
            </div>
            <p className="text-3xl font-bold mt-1" style={{ color: levelColor[lv].color }}>{stats.levelCounts[lv]}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-[#e5ecf4] p-4 mb-6 flex items-center gap-6 text-sm">
        <span className="text-[#5a6d8a]">累计评价 <strong className="text-[#18243a] text-base">{stats.total}</strong> 次</span>
        <span className="text-[#5a6d8a]">平均得分 <strong className="text-[#7c3aed] text-base">{stats.avgScore}</strong></span>
      </div>

      <div className="bg-white rounded-xl border border-[#e5ecf4] p-4 mb-4 flex gap-3 items-center">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索专家姓名" className="flex-1 px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#7c3aed]" />
      </div>

      <div className="bg-white rounded-xl border border-[#e5ecf4]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e5ecf4] text-left text-[#5a6d8a]">
              <th className="px-5 py-3">专家</th>
              <th className="px-5 py-3">专业</th>
              <th className="px-5 py-3">工作单位</th>
              <th className="px-5 py-3">获评次数</th>
              <th className="px-5 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-[#5a6d8a]">加载中...</td></tr>
            ) : experts.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-[#5a6d8a]">暂无专家</td></tr>
            ) : experts.map(e => (
              <tr key={e.id} className="border-b border-[#e5ecf4] hover:bg-[#f8fafc]">
                <td className="px-5 py-3 font-semibold text-[#7c3aed] cursor-pointer" onClick={() => router.push(`/expert/${e.id}`)}>{e.displayName}</td>
                <td className="px-5 py-3 text-[#5a6d8a]">{e.expertProfile?.specialty || '—'}</td>
                <td className="px-5 py-3 text-[#5a6d8a]">{e.expertProfile?.employer || '—'}</td>
                <td className="px-5 py-3"><span className="rounded-full bg-[#f5f3ff] px-2 py-1 text-xs font-semibold text-[#7c3aed]">{e._count.expertEvaluations} 次</span></td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => openModal(e)} className="px-3 py-1 text-xs text-white bg-[#7c3aed] hover:bg-[#6d28d9] rounded transition">履职评价</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 评价弹窗 */}
      {target && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4" onClick={() => setTarget(null)}>
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-[#e5ecf4]">
              <h3 className="text-lg font-bold text-[#18243a]">专家履职评价</h3>
              <p className="text-sm text-[#5a6d8a] mt-1">{target.displayName} · {target.expertProfile?.specialty}</p>
            </div>
            <div className="p-6">
              <div className="space-y-4 mb-5">
                {DIMENSIONS.map(d => (
                  <div key={d.key}>
                    <div className="flex items-center justify-between mb-1">
                      <div>
                        <span className="text-sm font-semibold text-[#18243a]">{d.label}</span>
                        <span className="ml-2 text-xs text-[#5a6d8a]">{d.hint}</span>
                      </div>
                      <span className="text-sm font-bold text-[#7c3aed] w-8 text-right">{scores[d.key]}</span>
                    </div>
                    <input type="range" min={0} max={100} step={1} value={scores[d.key]} onChange={e => setScores({ ...scores, [d.key]: Number(e.target.value) })} className="w-full accent-[#7c3aed]" />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-[#f5f3ff] border border-[#ddd6fe] p-3 mb-4">
                <span className="text-sm text-[#5a6d8a]">综合得分</span>
                <strong className="text-xl text-[#7c3aed]">{overall}</strong>
                <span className="px-2 py-0.5 rounded text-xs font-semibold" style={{ color: levelColor[previewLevel].color, backgroundColor: levelColor[previewLevel].color + '18' }}>{levelColor[previewLevel].label}（{previewLevel}级）</span>
                <span className="ml-auto text-xs text-[#5a6d8a]">A≥90 · B≥80 · C≥60 · D&lt;60</span>
              </div>
              <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="评价说明（可选）" className="w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm h-20 resize-none focus:outline-none focus:border-[#7c3aed]" />
            </div>
            <div className="p-6 border-t border-[#e5ecf4] flex justify-end gap-3">
              <button onClick={() => setTarget(null)} className="px-4 py-2 text-sm text-[#5a6d8a] hover:bg-[#f8fafc] rounded-lg transition">取消</button>
              <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm text-white bg-[#7c3aed] hover:bg-[#6d28d9] rounded-lg disabled:opacity-50 transition">{saving ? '提交中...' : '提交评价'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
