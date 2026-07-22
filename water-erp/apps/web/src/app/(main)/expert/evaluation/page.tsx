'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { listExperts, getExpertEvalStats, createExpertEvaluation, getExpertEvaluations, getExpertDimensionStats, getAiAdoptionRate } from '@/lib/api/expert';
import type { ExpertListItem, ExpertEvalStats } from '@/lib/api/expert';
import { StatusBadge, TableSkeleton, Modal } from '@/components/workbench';
import { SortableTh } from '@/lib/hooks/use-sort';
import { CheckCircle2, Search, X, RefreshCw, ChevronLeft, ChevronRight, Sparkles, Loader2, Brain } from 'lucide-react';

const levelLabel: Record<string, string> = { A: '优秀', B: '良好', C: '合格', D: '不合格' };
const DIMENSIONS: { key: 'attendanceScore' | 'qualityScore' | 'disciplineScore'; label: string; hint: string }[] = [
  { key: 'attendanceScore', label: '出勤纪律', hint: '按时签到、遵守评审纪律' },
  { key: 'qualityScore', label: '评审质量', hint: '评分客观、专业、有依据' },
  { key: 'disciplineScore', label: '廉洁纪律', hint: '无违规、无利益输送' },
];

type SortKey = 'name' | 'specialty' | 'evaluations';
type SortDir = 'asc' | 'desc';

export default function ExpertEvaluationPage() {
  const router = useRouter();
  const [experts, setExperts] = useState<ExpertListItem[]>([]);
  const [stats, setStats] = useState<ExpertEvalStats>({ levelCounts: { A: 0, B: 0, C: 0, D: 0 }, avgScore: 0, total: 0 });
  const [dimStats, setDimStats] = useState<{ attendanceAvg: number; qualityAvg: number; disciplineAvg: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [target, setTarget] = useState<ExpertListItem | null>(null);
  const [scores, setScores] = useState({ attendanceScore: 85, qualityScore: 85, disciplineScore: 90 });
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [errored, setErrored] = useState(false);
  // AI 辅助评价
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuggested, setAiSuggested] = useState(false);

  // 搜索防抖：停止击键 300ms 后才发起请求，避免每次击键触发查询
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);
  // 搜索竞态守卫：递增 requestId，过期响应直接丢弃，避免旧结果覆盖新结果
  const loadReqIdRef = useRef(0);
  const load = useCallback(async () => {
    const rid = ++loadReqIdRef.current;
    setLoading(true); setErrored(false);
    try {
      const list = await listExperts({ search: debouncedSearch || undefined }) as ExpertListItem[];
      if (rid !== loadReqIdRef.current) return;
      setExperts(list);
    } catch (e: any) {
      if (rid !== loadReqIdRef.current) return;
      setErrored(true); toast.error(e?.message || '加载专家列表失败');
    }
    setLoading(false);
  }, [debouncedSearch]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { getExpertEvalStats().then(setStats).catch(() => toast.error('加载评价统计失败')); }, [experts.length]);
  useEffect(() => { getExpertDimensionStats().then(setDimStats).catch(() => toast.error('加载维度分布失败')); }, [experts.length]);

  const totalPages = Math.max(1, Math.ceil(experts.length / PAGE_SIZE));
  const sortedExperts = useMemo(() => {
    if (!sortKey) return experts;
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...experts].sort((a, b) => {
      let av: string | number = '', bv: string | number = '';
      if (sortKey === 'name') { av = a.displayName; bv = b.displayName; }
      else if (sortKey === 'specialty') { av = a.expertProfile?.specialty || ''; bv = b.expertProfile?.specialty || ''; }
      else if (sortKey === 'evaluations') { av = a._count.expertEvaluations; bv = b._count.expertEvaluations; }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [experts, sortKey, sortDir]);
  const pagedExperts = useMemo(() => sortedExperts.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [sortedExperts, page]);

  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('desc'); }
    else if (sortDir === 'desc') setSortDir('asc');
    else { setSortKey(null); setSortDir('desc'); }
  };

  const overall = Math.round((scores.attendanceScore + scores.qualityScore + scores.disciplineScore) / 3);
  const previewLevel = overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 60 ? 'C' : 'D';
  const openModal = (e: ExpertListItem) => { setTarget(e); setScores({ attendanceScore: 85, qualityScore: 85, disciplineScore: 90 }); setComment(''); setAiLoading(false); setAiError(''); setAiSuggested(false); };
  const submit = async () => { if (!target) return; setSaving(true); try { await createExpertEvaluation({ expertUserId: target.id, ...scores, comment: comment || undefined }); toast.success('评价已提交'); setTarget(null); load(); getExpertEvalStats().then(setStats).catch(() => {}); } catch (e: any) { toast.error(e?.message || '评价失败'); } setSaving(false); };

  const runAiAnalysis = async () => {
    if (!target) return;
    setAiLoading(true); setAiError(''); setAiSuggested(false);
    try {
      const [evals, adoption] = await Promise.all([
        getExpertEvaluations(target.id).catch(() => [] as any[]),
        getAiAdoptionRate(target.id).catch(() => null),
      ]);
      // 从历史评价计算各维度均分，作为 AI 建议
      if (evals.length > 0) {
        const attAvg = Math.round(evals.reduce((s: number, e: any) => s + e.attendanceScore, 0) / evals.length);
        const qualAvg = Math.round(evals.reduce((s: number, e: any) => s + e.qualityScore, 0) / evals.length);
        const discAvg = Math.round(evals.reduce((s: number, e: any) => s + e.disciplineScore, 0) / evals.length);
        // 如果采纳率低，适当降低建议分数
        const adoptionRate = adoption?.overall?.adoptionRate ?? 100;
        const penalty = adoptionRate < 50 ? 8 : adoptionRate < 70 ? 4 : adoptionRate < 85 ? 2 : 0;
        setScores({
          attendanceScore: Math.max(50, attAvg - penalty),
          qualityScore: Math.max(50, qualAvg - penalty),
          disciplineScore: Math.max(50, discAvg - penalty),
        });
        setComment(`AI 辅助参考：近 ${evals.length} 次评价均分（出勤 ${attAvg} / 质量 ${qualAvg} / 廉洁 ${discAvg}），AI 采纳率 ${adoptionRate}%。建议根据专家履职表现调整。`);
      }
      setAiSuggested(true);
      toast.success('AI 分析完成，已自动填入建议分数');
    } catch (e: any) {
      setAiError(e?.message || 'AI 分析失败');
    }
    setAiLoading(false);
  };

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
        <div className="page-hero__divider">
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

      <div className="wb-toolbar">
        <div className="flex items-center gap-4 text-sm mr-auto">
          <span className="text-[var(--muted-foreground)]">累计评价 <strong className="tabular-nums text-[var(--foreground)]">{stats.total}</strong> 次</span>
          <span className="text-[var(--muted-foreground)]">平均得分 <strong className="tabular-nums text-[var(--accent)]">{stats.avgScore}</strong></span>
        </div>
        <div className="relative min-w-[140px] xl:min-w-[200px] flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索专家姓名" className="neu-input !pl-9" />{search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] text-[var(--muted-foreground)] z-10" aria-label="清除搜索"><X size={14} /></button>}</div>
      </div>

      {/* ════ 三维评分分布 ════ */}
      {dimStats && dimStats.total > 0 && (
        <div className="neu-table-card p-5">
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-4">三维评分分布（全局均分）</h3>
          <div className="space-y-2">
            {[
              { label: '出勤纪律', value: dimStats.attendanceAvg, max: 100 },
              { label: '评审质量', value: dimStats.qualityAvg, max: 100 },
              { label: '廉洁纪律', value: dimStats.disciplineAvg, max: 100 },
            ].map(d => {
              const pct = (d.value / d.max) * 100;
              const color = pct >= 80 ? 'var(--success)' : pct >= 60 ? 'var(--accent)' : pct >= 40 ? 'var(--warning)' : 'var(--danger)';
              return (
                <div key={d.label} className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold text-[var(--foreground)] w-16">{d.label}</span>
                  <div className="flex-1 h-5 rounded-md bg-[var(--muted)]/20 overflow-hidden">
                    <div className="h-full rounded-md transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color, opacity: 0.6 }} />
                  </div>
                  <span className="text-[11px] tabular-nums font-semibold text-[var(--muted-foreground)] w-14 text-right">{d.value}/{d.max}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="neu-table-card">
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[700px]">
            <thead>
              <tr>
                <SortableTh label="专家" field="name" sortKey={sortKey ?? ''} sortDir={sortDir} onToggle={(f) => toggleSort(f as SortKey)} />
                <SortableTh label="专业" field="specialty" sortKey={sortKey ?? ''} sortDir={sortDir} onToggle={(f) => toggleSort(f as SortKey)} />
                <th className="text-center">工作单位</th>
                <SortableTh label="获评次数" field="evaluations" sortKey={sortKey ?? ''} sortDir={sortDir} onToggle={(f) => toggleSort(f as SortKey)} />
                <th className="text-center" style={{ width: 60 }}>平均评分</th>
                <th className="text-center" style={{ width: 100 }}>最新评分</th>
                <th className="text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton cols={7} rows={5} />
              ) : errored ? (
                <tr><td colSpan={7} className="px-4 py-16">
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-sm font-semibold text-[var(--danger)]">专家列表加载失败</p>
                    <button onClick={load} className="neu-btn-soft">重试</button>
                  </div>
                </td></tr>
              ) : sortedExperts.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-16"><div className="flex flex-col items-center gap-3"><div className="neu-icon-well flex h-14 w-14 items-center justify-center rounded-2xl"><CheckCircle2 size={22} className="text-[var(--muted-foreground)]" /></div><p className="text-sm text-[var(--muted-foreground)]">暂无评审专家</p><button onClick={() => router.push('/expert/entry')} className="neu-btn-xs is-info">前往录入专家 →</button></div></td></tr>
              ) : pagedExperts.map(e => {
                const avgScore = (e as any).avgEvalScore;
                const latest = (e as any).latestEval;
                const levelTone = latest?.level === 'A' ? 'green' : latest?.level === 'B' ? 'blue' : latest?.level === 'D' ? 'red' : 'orange';
                return (
                <tr key={e.id} className="row-clickable" onClick={() => openModal(e)}>
                  <td><div className="flex items-center gap-2.5"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{e.displayName[0]}</div><span className="text-sm font-bold text-[var(--foreground)] hover:text-[var(--accent)] transition-colors">{e.displayName}</span></div></td>
                  <td className="text-center">{e.expertProfile?.specialty && <StatusBadge tone="blue">{e.expertProfile.specialty}</StatusBadge>}</td>
                  <td className="text-center text-sm text-[var(--muted-foreground)]">{e.expertProfile?.employer || '—'}</td>
                  <td className="text-center text-sm font-semibold tabular-nums">{e._count.expertEvaluations}</td>
                  <td className="text-center">
                    {avgScore != null ? <span className="text-sm font-extrabold text-[var(--accent)] tabular-nums">{avgScore}</span> : <span className="text-sm text-[var(--muted-foreground)]">—</span>}
                  </td>
                  <td className="text-center">
                    {latest ? (
                      <div className="flex items-center justify-center gap-1.5">
                        <span className="text-sm font-extrabold text-[var(--foreground)] tabular-nums">{latest.overallScore}</span>
                        <StatusBadge tone={levelTone as any}>{latest.level}</StatusBadge>
                      </div>
                    ) : <span className="text-sm text-[var(--muted-foreground)]">—</span>}
                  </td>
                  <td onClick={e => e.stopPropagation()} className="text-center"><button onClick={() => openModal(e)} className="neu-btn-xs is-info">履职评价</button></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {experts.length > 0 && (
          <div className="neu-table-card-footer flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[0.8rem] text-[var(--muted-foreground)] tabular-nums">共 <strong className="font-semibold text-[var(--foreground)]">{experts.length}</strong> 位专家 · 第 {page}/{totalPages} 页</span>
            <div className="flex gap-1.5">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="neu-btn-xs disabled:opacity-30"><ChevronLeft size={14} /></button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="neu-btn-xs disabled:opacity-30"><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>

      {target && (
        <Modal
          open
          onClose={() => setTarget(null)}
          size="md"
          title="专家履职评价"
          description={`${target.displayName} · ${target.expertProfile?.specialty}`}
          footer={
            <>
              <button onClick={() => setTarget(null)} className="neu-btn-soft">取消</button>
              <button onClick={submit} disabled={saving} className="neu-btn-soft is-success">{saving ? '提交中...' : '提交评价'}</button>
            </>
          }
        >
          {/* ══ AI 辅助分析栏 ══ */}
          <div className="flex items-center gap-3 rounded-xl p-3 bg-[var(--surface)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {aiLoading ? (
                <><Loader2 size={14} className="animate-spin text-[var(--accent)]" /><span className="text-xs text-[var(--muted-foreground)]">AI 正在分析历史评价与评分偏离数据…</span></>
              ) : aiSuggested ? (
                <><Brain size={14} className="text-[var(--accent)] flex-shrink-0" /><span className="text-xs text-[var(--accent)] font-semibold">AI 已分析</span><span className="text-xs text-[var(--muted-foreground)] truncate">基于历史数据给出建议分数，可手动调整</span></>
              ) : (
                <><Brain size={14} className="text-[var(--muted-foreground)]/40 flex-shrink-0" /><span className="text-xs text-[var(--muted-foreground)]">AI 可基于历史评价均分与评分采纳率自动填入建议分数</span></>
              )}
            </div>
            <button onClick={runAiAnalysis} disabled={aiLoading} className="neu-btn-soft flex-shrink-0">
              {aiLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={13} />}
              {aiLoading ? '分析中' : aiSuggested ? '重新分析' : 'AI 分析'}
            </button>
          </div>
          {aiError && <p className="text-xs font-semibold text-[var(--danger)]">{aiError}</p>}

          {/* ══ 三维评分 ══ */}
          {DIMENSIONS.map(d => (
            <div key={d.key} className="rounded-xl p-4 bg-[var(--surface)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
              <div className="flex items-center justify-between mb-1">
                <div><span className="text-sm font-bold text-[var(--foreground)]">{d.label}</span><span className="ml-2 text-xs text-[var(--muted-foreground)] hidden sm:inline">{d.hint}</span></div>
                <span className="text-sm font-extrabold text-[var(--accent)] tabular-nums min-w-[2rem] text-right">{scores[d.key]}</span>
              </div>
              {aiSuggested && (
                <div className="flex items-center gap-1 mb-2 -mt-0.5"><span className="text-[10px] text-[var(--accent)]/70">AI 建议区间：历史均分 ± 采纳率修正</span></div>
              )}
              <input type="range" min={0} max={100} step={1} value={scores[d.key]} onChange={e => setScores({ ...scores, [d.key]: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
            </div>
          ))}

          {/* ══ 总分预览 ══ */}
          <div className="flex items-center gap-3 rounded-xl bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] p-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">
            <span className="text-xs font-bold text-[var(--muted-foreground)]">综合得分</span><strong className="text-xl font-black text-[var(--accent)] tabular-nums">{overall}</strong>
            <StatusBadge tone={previewLevel === 'A' ? 'green' : previewLevel === 'B' ? 'blue' : previewLevel === 'C' ? 'orange' : 'red'}>{levelLabel[previewLevel]}（{previewLevel}级）</StatusBadge>
            <span className="ml-auto text-xs text-[var(--muted-foreground)]">A≥90 · B≥80 · C≥60 · D&lt;60</span>
          </div>

          {/* ══ 评价说明 ══ */}
          <div>
            <span className="text-xs font-semibold text-[var(--muted-foreground)] block mb-1.5">评价说明</span>
            <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder={aiSuggested ? 'AI 已填入参考说明，可编辑或补充...' : '评价说明（可选）'} className="neu-input w-full h-20 resize-none text-sm" />
          </div>
        </Modal>
      )}
    </div>
  );
}
