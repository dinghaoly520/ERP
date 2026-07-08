'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { listExperts, getExpertEvalStats, createExpertEvaluation } from '@/lib/api/expert';
import type { ExpertListItem, ExpertEvalStats } from '@/lib/api/expert';
import { StatusBadge } from '@/components/workbench';
import { CheckCircle2, Search, X, RefreshCw, ChevronUp } from 'lucide-react';

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

  const load = useCallback(async () => { setLoading(true); try { setExperts(await listExperts({ search: search || undefined }) as ExpertListItem[]); } catch {} setLoading(false); }, [search]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { getExpertEvalStats().then(setStats).catch(() => {}); }, [experts.length]);

  const overall = Math.round((scores.attendanceScore + scores.qualityScore + scores.disciplineScore) / 3);
  const previewLevel = overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 60 ? 'C' : 'D';
  const openModal = (e: ExpertListItem) => { setTarget(e); setScores({ attendanceScore: 85, qualityScore: 85, disciplineScore: 90 }); setComment(''); };
  const submit = async () => { if (!target) return; setSaving(true); try { await createExpertEvaluation({ expertUserId: target.id, ...scores, comment: comment || undefined }); toast.success('评价已提交'); setTarget(null); load(); getExpertEvalStats().then(setStats).catch(() => {}); } catch (e: any) { toast.error(e?.message || '评价失败'); } setSaving(false); };

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><CheckCircle2 size={17} /></div>
            <div><div className="page-hero__title">专家评价</div><div className="page-hero__sub">评审专家履职评价：出勤纪律、评审质量、廉洁纪律，评价结果用于后续抽取权重参考</div></div>
          </div>
          <div className="page-hero__right"><button onClick={load} disabled={loading} className="neu-btn-xs"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button></div>
        </div>
        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 items-stretch">
          {(['A','B','C','D'] as const).map(lv => (
            <div key={lv} className="kpi-card group flex h-full flex-col gap-1.5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">{lv}级 · {levelLabel[lv]}</span>
              <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{stats.levelCounts[lv]}</span>
              <span className="min-h-[14px] text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">&nbsp;</span>
            </div>
          ))}
        </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-[color-mix(in_oklch,var(--border)_80%,transparent)] bg-[var(--surface)] px-4 py-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.65),2px_2px_6px_oklch(0.55_0.03_258/0.08),-1px_-1px_3px_oklch(1_0_0/0.85)]">
        <div className="flex items-center gap-4 text-sm mr-auto">
          <span className="text-[var(--muted-foreground)]">累计评价 <strong className="tabular-nums text-[var(--foreground)]">{stats.total}</strong> 次</span>
          <span className="text-[var(--muted-foreground)]">平均得分 <strong className="tabular-nums text-[var(--accent)]">{stats.avgScore}</strong></span>
        </div>
        <div className="relative min-w-[140px] xl:min-w-[200px] flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索专家姓名" className="neu-input !pl-9" /></div>
      </div>

      <div className="neu-table-card">
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[550px]">
            <thead><tr><th>专家</th><th className="text-center">专业</th><th className="text-center">工作单位</th><th className="text-center">获评次数</th><th className="text-center">操作</th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-4 py-16 text-center text-sm text-[var(--muted-foreground)]">加载中...</td></tr>
              ) : experts.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-16"><div className="flex flex-col items-center gap-3"><div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><CheckCircle2 size={22} className="text-[var(--muted-foreground)]" /></div><p className="text-sm text-[var(--muted-foreground)]">暂无评审专家</p><button onClick={() => router.push('/expert/entry')} className="neu-btn-xs is-info">前往录入专家 →</button></div></td></tr>
              ) : experts.map(e => (
                <tr key={e.id} className="row-clickable" onClick={() => openModal(e)}>
                  <td><div className="flex items-center gap-2.5"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{e.displayName[0]}</div><span className="text-sm font-bold text-[var(--foreground)] hover:text-[var(--accent)] transition-colors">{e.displayName}</span></div></td>
                  <td className="text-center">{e.expertProfile?.specialty && <StatusBadge tone="blue">{e.expertProfile.specialty}</StatusBadge>}</td>
                  <td className="text-center text-sm text-[var(--muted-foreground)]">{e.expertProfile?.employer || '—'}</td>
                  <td className="text-center text-sm font-semibold tabular-nums">{e._count.expertEvaluations}</td>
                  <td onClick={e => e.stopPropagation()} className="text-center"><button onClick={() => openModal(e)} className="neu-btn-xs is-info">履职评价</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {target && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setTarget(null)}>
          <div className="absolute inset-0 bg-[var(--background)]/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-[min(540px,92vw)] max-h-[90vh] overflow-y-auto rounded-[20px] bg-[var(--background)] p-0 shadow-[0_20px_60px_oklch(0.24_0.038_258/0.12)]" role="dialog" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 px-6 py-4"><div><h2 className="text-lg font-bold tracking-[-0.02em] text-[var(--foreground)]">专家履职评价</h2><p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{target.displayName} · {target.expertProfile?.specialty}</p></div><button onClick={() => setTarget(null)} className="neu-btn-xs"><X size={16} /></button></div>
            <div className="px-6 pb-6 space-y-5">
              {DIMENSIONS.map(d => (
                <div key={d.key}>
                  <div className="flex items-center justify-between mb-1.5"><div><span className="text-sm font-bold text-[var(--foreground)]">{d.label}</span><span className="ml-2 text-xs text-[var(--muted-foreground)]">{d.hint}</span></div><span className="text-sm font-extrabold text-[var(--accent)] tabular-nums min-w-[2rem] text-right">{scores[d.key]}</span></div>
                  <input type="range" min={0} max={100} step={1} value={scores[d.key]} onChange={e => setScores({ ...scores, [d.key]: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
                </div>
              ))}
              <div className="flex items-center gap-3 rounded-xl bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] p-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">
                <span className="text-xs font-bold text-[var(--muted-foreground)]">综合得分</span><strong className="text-xl font-black text-[var(--accent)] tabular-nums">{overall}</strong>
                <StatusBadge tone={previewLevel === 'A' ? 'green' : previewLevel === 'B' ? 'blue' : previewLevel === 'C' ? 'orange' : 'red'}>{levelLabel[previewLevel]}（{previewLevel}级）</StatusBadge>
                <span className="ml-auto text-xs text-[var(--muted-foreground)]">A≥90 · B≥80 · C≥60 · D&lt;60</span>
              </div>
              <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="评价说明（可选）" className="neu-input w-full h-20 resize-none text-sm" />
            </div>
            <hr className="wb-section-rule mx-6" />
            <div className="flex justify-end gap-3 px-6 py-4">
              <button onClick={() => setTarget(null)} className="neu-btn-soft">取消</button>
              <button onClick={submit} disabled={saving} className="neu-btn-soft is-success">{saving ? '提交中...' : '提交评价'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
