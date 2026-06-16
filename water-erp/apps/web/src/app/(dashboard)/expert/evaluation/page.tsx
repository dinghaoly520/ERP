'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { listExperts, getExpertEvalStats, createExpertEvaluation } from '@/lib/api/expert';
import type { ExpertListItem, ExpertEvalStats } from '@/lib/api/expert';
import { DataToolbar, MetricCard, PageHero, SectionCard, StatusBadge, TableSkeleton, EmptyState } from '@/components/workbench';
import { CheckCircle2, Search, X } from 'lucide-react';

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
    try { setExperts(await listExperts({ search: search || undefined }) as ExpertListItem[]); } catch { /* */ }
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { getExpertEvalStats().then(setStats).catch(() => {}); }, [experts.length]);

  const overall = Math.round((scores.attendanceScore + scores.qualityScore + scores.disciplineScore) / 3);
  const previewLevel = overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 60 ? 'C' : 'D';

  const openModal = (e: ExpertListItem) => { setTarget(e); setScores({ attendanceScore: 85, qualityScore: 85, disciplineScore: 90 }); setComment(''); };
  const closeModal = () => setTarget(null);

  const submit = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await createExpertEvaluation({ expertUserId: target.id, ...scores, comment: comment || undefined });
      toast.success('评价已提交');
      closeModal(); load();
      getExpertEvalStats().then(setStats).catch(() => {});
    } catch (e: any) { toast.error(e?.message || '评价失败'); }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <PageHero
         title="专家评价"
        description="评审专家履职评价：出勤纪律、评审质量、廉洁纪律。评价结果用于后续随机抽取权重参考。"
        tone="blue" icon={<CheckCircle2 size={14} />}
      />

      {/* Level distribution */}
      <div className="grid gap-4 md:grid-cols-4">
        {(['A','B','C','D'] as const).map(lv => (
          <MetricCard
            key={lv}
            label={`${lv}级 · ${levelLabel[lv]}`}
            value={stats.levelCounts[lv]}
            tone={lv === 'A' ? 'green' : lv === 'B' ? 'blue' : lv === 'C' ? 'orange' : 'red'}
          />
        ))}
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-6 rounded-2xl border border-[#dce6f3] bg-white px-5 py-3 text-sm">
        <span className="text-[#5a6d8a]">累计评价 <strong className="text-[#18243a] tabular-nums">{stats.total}</strong> 次</span>
        <span className="text-[#5a6d8a]">平均得分 <strong className="text-[#064ea2] tabular-nums">{stats.avgScore}</strong></span>
      </div>

      <DataToolbar>
        <div className="flex items-center gap-2 flex-1">
          <Search size={15} className="text-[#94a3b8] flex-shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索专家姓名" className="workbench-input flex-1 text-sm" />
        </div>
      </DataToolbar>

      <SectionCard className="overflow-hidden p-0">
        <table className="workbench-table">
          <thead className="bg-[#f3f7fc] text-[#5a6d8a]">
            <tr>
              <th className="px-4 py-3">专家</th>
              <th className="px-4 py-3 text-center">专业</th>
              <th className="px-4 py-3 text-center">工作单位</th>
              <th className="px-4 py-3 text-center">获评次数</th>
              <th className="px-4 py-3 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <TableSkeleton cols={5} rows={5} />
            ) : experts.length === 0 ? (
              <tr><td colSpan={5}><EmptyState title="暂无评审专家" description="录入专家后方可进行履职评价" action={<button onClick={() => router.push('/expert/entry')} className="text-sm font-bold text-[#064ea2] hover:underline">前往录入专家 →</button>} /></td></tr>
            ) : experts.map(e => (
              <tr key={e.id} className="row-clickable" onClick={() => openModal(e)}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#064ea2] text-xs font-extrabold text-white">
                      {e.displayName[0]}
                    </div>
                    <span className="text-sm font-bold text-[#18243a] cursor-pointer hover:text-[#064ea2] transition" onClick={() => router.push(`/expert/${e.id}`)}>
                      {e.displayName}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  {e.expertProfile?.specialty && <StatusBadge tone="blue">{e.expertProfile.specialty}</StatusBadge>}
                </td>
                <td className="px-4 py-3 text-center text-sm text-[#5a6d8a]">{e.expertProfile?.employer || '—'}</td>
                <td className="px-4 py-3 text-center text-sm font-semibold tabular-nums">{e._count.expertEvaluations}</td>
                <td className="px-4 py-3 text-center">
                  <button onClick={(ev) => { ev.stopPropagation(); openModal(e); }} className="btn-press rounded-lg bg-[#064ea2] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#054280] transition">
                    履职评价
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      {/* Evaluation Modal */}
      {target && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={closeModal}>
          <div className="modal-content w-full max-w-lg overflow-hidden rounded-2xl border border-[#dce6f3] bg-white shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-[#edf2f7] px-6 py-4">
              <div>
                <h3 className="text-base font-bold text-[#18243a]">专家履职评价</h3>
                <p className="mt-0.5 text-xs text-[#5a6d8a]">{target.displayName} · {target.expertProfile?.specialty}</p>
              </div>
              <button onClick={closeModal} className="rounded-lg p-1 text-[#8a99ad] hover:bg-[#f8fafc] hover:text-[#5a6d8a] transition">
                <X size={18} />
              </button>
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
                    <input type="range" min={0} max={100} step={1} value={scores[d.key]}
                      onChange={e => setScores({ ...scores, [d.key]: Number(e.target.value) })}
                      className="w-full range-enhanced accent-[#064ea2]" />
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-[#bcd0e8] bg-[#f0f6ff] p-3 mb-5">
                <span className="text-xs font-bold text-[#5a6d8a]">综合得分</span>
                <strong className="text-xl font-black text-[#064ea2] tabular-nums">{overall}</strong>
                <StatusBadge tone={previewLevel === 'A' ? 'green' : previewLevel === 'B' ? 'blue' : previewLevel === 'C' ? 'orange' : 'red'}>
                  {levelLabel[previewLevel]}（{previewLevel}级）
                </StatusBadge>
                <span className="ml-auto text-xs text-[#8a99ad]">A≥90 · B≥80 · C≥60 · D&lt;60</span>
              </div>

              <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="评价说明（可选）"
                className="w-full rounded-xl border border-[#dce6f3] px-3 py-2 text-sm placeholder-[#94a3b8] h-20 resize-none focus:outline-none focus:border-[#064ea2]" />
            </div>

            <div className="flex justify-end gap-3 border-t border-[#edf2f7] px-6 py-4">
              <button onClick={closeModal} className="rounded-xl border border-[#dce3eb] px-4 py-2 text-sm font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition">取消</button>
              <button onClick={submit} disabled={saving} className="rounded-xl bg-[#064ea2] px-4 py-2 text-sm font-bold text-white hover:bg-[#054280] disabled:opacity-50 transition">
                {saving ? '提交中...' : '提交评价'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
