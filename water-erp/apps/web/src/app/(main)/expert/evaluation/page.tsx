'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { listExperts, getExpertEvalStats, createExpertEvaluation, aiSuggestEvaluation } from '@/lib/api/expert';
import type { ExpertListItem, ExpertEvalStats } from '@/lib/api/expert';
import { StatusBadge, TableSkeleton, Modal } from '@/components/workbench';
import { SortableTh } from '@/lib/hooks/use-sort';
import { CheckCircle2, Search, X, RefreshCw, ChevronLeft, ChevronRight, Sparkles, Loader2, Brain } from 'lucide-react';
import { LEVEL_LABEL, LEVEL_COLOR, LEVEL_WEIGHT } from '@water-erp/shared';

const GRADE_OPTIONS = ['A', 'B', 'C', 'D', 'E'] as const;
const GRADE_COLOR: Record<string, string> = { A: '#059669', B: '#0a5eb8', C: '#d97706', D: '#ca8a04', E: '#dc2626' };
const GRADE_BG: Record<string, string> = { A: 'oklch(0.96 0.05 164 / 0.45)', B: 'oklch(0.96 0.04 251 / 0.45)', C: 'oklch(0.96 0.06 80 / 0.4)', D: 'oklch(0.96 0.06 80 / 0.25)', E: 'oklch(0.96 0.05 27 / 0.35)' };
const DIMENSIONS: { key: 'attendanceGrade' | 'qualityGrade' | 'disciplineGrade'; label: string; hint: string; weight: number }[] = [
  { key: 'attendanceGrade', label: '出勤纪律', hint: '按时签到、遵守评审纪律', weight: LEVEL_WEIGHT.attendanceGrade },
  { key: 'qualityGrade', label: '评审质量', hint: '评分客观、专业、有依据', weight: LEVEL_WEIGHT.qualityGrade },
  { key: 'disciplineGrade', label: '廉洁纪律', hint: '无违规、无利益输送', weight: LEVEL_WEIGHT.disciplineGrade },
];

type SortKey = 'name' | 'specialty' | 'evaluations';
type SortDir = 'asc' | 'desc';

export default function ExpertEvaluationPage() {
  const router = useRouter();
  const [experts, setExperts] = useState<ExpertListItem[]>([]);
  const [stats, setStats] = useState<ExpertEvalStats>({ levelCounts: { A: 0, B: 0, C: 0, D: 0, E: 0 }, excellentRatio: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;
  const [target, setTarget] = useState<ExpertListItem | null>(null);
  const [projectId, setProjectId] = useState('');
  const [grades, setGrades] = useState({ attendanceGrade: 'B', qualityGrade: 'B', disciplineGrade: 'A' });
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [errored, setErrored] = useState(false);
  // AI 辅助评价
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiSuggested, setAiSuggested] = useState(false);
  const [aiEngine, setAiEngine] = useState<'ai' | 'rules'>('ai');

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

  const GRADE_VALUE: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };
  const VALUE_GRADE: Record<number, string> = { 5: 'A', 4: 'B', 3: 'C', 2: 'D', 1: 'E' };
  const previewLevel = (() => {
    const w = LEVEL_WEIGHT;
    const weighted = GRADE_VALUE[grades.qualityGrade] * w.qualityGrade + GRADE_VALUE[grades.disciplineGrade] * w.disciplineGrade + GRADE_VALUE[grades.attendanceGrade] * w.attendanceGrade;
    const rounded = Math.round(weighted);
    return VALUE_GRADE[Math.max(1, Math.min(5, rounded))] || 'C';
  })();
  const openModal = (e: ExpertListItem) => { setTarget(e); setProjectId(''); setGrades({ attendanceGrade: 'B', qualityGrade: 'B', disciplineGrade: 'A' }); setEvidence({}); setComment(''); setAiLoading(false); setAiError(''); setAiSuggested(false); setAiEngine('ai'); };
  const submit = async () => { if (!target) return; if (!projectId) { toast.error('请选择本次评价对应的评审项目'); return; } setSaving(true); try { await createExpertEvaluation({ expertUserId: target.id, projectId, ...grades, comment: comment || undefined }); toast.success('评价已提交'); setTarget(null); load(); getExpertEvalStats().then(setStats).catch(() => {}); } catch (e: any) { toast.error(e?.message || '评价失败'); } setSaving(false); };

  // 真实 AI 分析：调用后端 LLM 综合历史评价/偏离度/违规/负荷给出建议，失败走规则兜底（engine 字段标识）
  const runAiAnalysis = async () => {
    if (!target) return;
    setAiLoading(true); setAiError(''); setAiSuggested(false);
    try {
      const res = await aiSuggestEvaluation(target.id);
      // AI 自动选择等级 + 每项评价依据 + 评价说明
      setGrades({ attendanceGrade: res.attendanceGrade, qualityGrade: res.qualityGrade, disciplineGrade: res.disciplineGrade });
      setEvidence({
        attendanceGrade: `【出勤纪律·${LEVEL_LABEL[res.attendanceGrade] || res.attendanceGrade}级】${res.analysis}`,
        qualityGrade: `【评审质量·${LEVEL_LABEL[res.qualityGrade] || res.qualityGrade}级】${res.analysis}`,
        disciplineGrade: `【廉洁纪律·${LEVEL_LABEL[res.disciplineGrade] || res.disciplineGrade}级】${res.analysis}`,
      });
      setComment(res.analysis);
      setAiEngine(res.engine);
      setAiSuggested(true);
      toast.success(res.engine === 'ai' ? 'AI 分析完成，已自动选择等级并写入评价说明' : '规则兜底已写入评价说明（AI 暂不可用）');
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 items-stretch">
          {(['A','B','C','D','E'] as const).map(lv => {
            const count = stats.levelCounts[lv];
            const percent = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
            return (
            <div key={lv} className="kpi-card group relative flex h-full flex-col gap-2 overflow-hidden p-3">
              {/* 顶部等级色条 */}
              <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: GRADE_COLOR[lv] }} />
              {/* 等级字母 + 标签 */}
              <div className="flex items-center gap-1.5">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md text-[10px] font-black text-white" style={{ backgroundColor: GRADE_COLOR[lv] }}>{lv}</span>
                <span className="truncate text-[10px] font-semibold tracking-wide text-[var(--muted-foreground)]">{LEVEL_LABEL[lv]}</span>
              </div>
              {/* 大号彩色数字 */}
              <div className="flex items-baseline gap-1">
                <span className="text-[1.6rem] font-black leading-none tracking-[-0.04em] tabular-nums" style={{ color: GRADE_COLOR[lv] }}>{count}</span>
                <span className="text-[10px] font-medium text-[var(--muted-foreground)]">人</span>
              </div>
              {/* 占比 + 迷你进度条 */}
              <div className="mt-auto">
                <div className="mb-1 flex items-center justify-between text-[9px] font-medium tabular-nums text-[var(--muted-foreground)]">
                  <span>占比</span>
                  <span>{percent}%</span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)]">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${percent}%`, backgroundColor: GRADE_COLOR[lv] }} />
                </div>
              </div>
            </div>
            );
          })}
        </div>
        </div>
      </div>

      <div className="wb-toolbar">
        <div className="flex items-center gap-4 text-sm mr-auto">
          <span className="text-[var(--muted-foreground)]">累计评价 <strong className="tabular-nums text-[var(--foreground)]">{stats.total}</strong> 次<span className="mx-2">·</span>优良率 <strong className="tabular-nums text-[var(--accent)]">{stats.excellentRatio}%</strong></span>
        </div>
        <div className="relative min-w-[140px] xl:min-w-[200px] flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="搜索专家姓名" className="neu-input !pl-9" />{search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] text-[var(--muted-foreground)] z-10" aria-label="清除搜索"><X size={14} /></button>}</div>
      </div>

      <div className="neu-table-card">
        <div className="overflow-x-auto">
          <table className="neu-table w-full min-w-[600px]">
            <thead>
              <tr>
                <SortableTh label="专家" field="name" sortKey={sortKey ?? ''} sortDir={sortDir} onToggle={(f) => toggleSort(f as SortKey)} />
                <SortableTh label="专业" field="specialty" sortKey={sortKey ?? ''} sortDir={sortDir} onToggle={(f) => toggleSort(f as SortKey)} />
                <th className="text-center">工作单位</th>
                <SortableTh label="获评次数" field="evaluations" sortKey={sortKey ?? ''} sortDir={sortDir} onToggle={(f) => toggleSort(f as SortKey)} />
                <th className="text-center" style={{ width: 100 }}>平均等级</th>
                <th className="text-center" style={{ width: 100 }}>最新评价</th>
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
                const latest = (e as any).latestEval;
                const tone = latest?.level === 'A' ? 'green' : latest?.level === 'B' ? 'blue' : latest?.level === 'C' ? 'orange' : latest?.level === 'D' ? 'orange' : 'red';
                return (
                <tr key={e.id} className="row-clickable" onClick={() => router.push(`/expert/${e.id}`)}>
                  <td><div className="flex items-center gap-2.5"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{e.displayName[0]}</div><span className="text-sm font-bold text-[var(--foreground)] hover:text-[var(--accent)] transition-colors">{e.displayName}</span></div></td>
                  <td className="text-center">{e.expertProfile?.specialty && <StatusBadge tone="blue">{e.expertProfile.specialty}</StatusBadge>}</td>
                  <td className="text-center text-sm text-[var(--muted-foreground)]">{e.expertProfile?.employer || '—'}</td>
                  <td className="text-center text-sm font-semibold tabular-nums">{e._count.expertEvaluations}</td>
                  <td className="text-center">
                    {((e as any).avgGrade) ? (
                      <StatusBadge tone={((e as any).avgGrade === 'A' ? 'green' : (e as any).avgGrade === 'B' ? 'blue' : (e as any).avgGrade === 'C' ? 'orange' : (e as any).avgGrade === 'D' ? 'orange' : 'red') as any}>{LEVEL_LABEL[(e as any).avgGrade]}</StatusBadge>
                    ) : <span className="text-sm text-[var(--muted-foreground)]">—</span>}
                  </td>
                  <td className="text-center">
                    {latest ? (
                      <StatusBadge tone={tone as any}>{LEVEL_LABEL[latest.level]}</StatusBadge>
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
          {/* ══ 关联项目（本次评价对应的评审）══ */}
          <div>
            <span className="text-xs font-semibold text-[var(--muted-foreground)] block mb-1.5">关联项目 <span className="text-[var(--danger)]">*</span></span>
            {target.bidExperts.length === 0 ? (
              <div className="rounded-xl bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-3 py-2 text-xs text-[var(--warning)]">该专家尚未参与任何评审项目，无法发起履职评价</div>
            ) : (
              <select value={projectId} onChange={e => setProjectId(e.target.value)} className="neu-input text-sm w-full">
                <option value="">请选择本次评价对应的评审项目</option>
                {target.bidExperts.map(b => (
                  <option key={b.project.id} value={b.project.id}>{b.project.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* ══ AI 辅助分析栏 ══ */}
          <div className="flex items-center gap-3 rounded-xl p-3 bg-[var(--surface)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {aiLoading ? (
                <><Loader2 size={14} className="animate-spin text-[var(--accent)]" /><span className="text-xs text-[var(--muted-foreground)]">AI 正在分析 {target.displayName} 的历史评价、偏离度与履职数据…</span></>
              ) : aiSuggested ? (
                <><Brain size={14} className="text-[var(--accent)] flex-shrink-0" /><span className={`text-xs font-semibold flex-shrink-0 ${aiEngine === 'ai' ? 'text-[var(--accent)]' : 'text-[var(--warning)]'}`}>{aiEngine === 'ai' ? 'AI 已分析' : '规则兜底'}</span><span className="text-xs text-[var(--muted-foreground)] leading-relaxed">{aiEngine === 'ai' ? 'LLM 综合历史评价、偏离度、违规与负荷给出建议，已自动选择各维度等级并填入评价说明' : '基于历史数据与违规记录综合得出，AI 暂不可用'}</span></>
              ) : (
                <><Brain size={14} className="text-[var(--muted-foreground)]/40 flex-shrink-0" /><span className="text-xs text-[var(--muted-foreground)]">AI 可自动分析专家履职数据，完成后将直接填入各维度等级与评价说明</span></>
              )}
            </div>
            <button onClick={runAiAnalysis} disabled={aiLoading} className="neu-btn-soft flex-shrink-0">
              {aiLoading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={13} />}
              {aiLoading ? '分析中' : aiSuggested ? '重新分析' : 'AI 分析'}
            </button>
          </div>
          {aiError && <p className="text-xs font-semibold text-[var(--danger)]">{aiError}</p>}

          {/* ══ 三维等级评价 ══ */}
          {DIMENSIONS.map(d => (
            <div key={d.key} className="rounded-xl p-4 bg-[var(--surface)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-[var(--foreground)]">{d.label}</span>
                  <span className="text-[11px] text-[var(--muted-foreground)] hidden sm:inline">{d.hint}</span>
                </div>
                <span className="text-xs font-bold text-[var(--muted-foreground)]">权重 ×{d.weight}</span>
              </div>
              <div className="flex gap-1.5">
                {GRADE_OPTIONS.map(g => {
                  const selected = grades[d.key] === g;
                  return (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setGrades({ ...grades, [d.key]: g })}
                      style={selected ? { backgroundColor: GRADE_BG[g], color: GRADE_COLOR[g], fontWeight: 700 } : undefined}
                      className={`neu-btn-soft flex-1 text-xs font-semibold transition-colors`}
                    >
                      {g} · {LEVEL_LABEL[g]}
                    </button>
                  );
                })}
              </div>
              {/* 评价依据 */}
              <textarea
                value={evidence[d.key] || ''}
                onChange={e => setEvidence(prev => ({ ...prev, [d.key]: e.target.value }))}
                placeholder="评价依据（必填）：基于哪些具体事实或数据得出此等级？"
                className="neu-input w-full h-14 resize-none text-xs mt-2"
              />
            </div>
          ))}

          {/* ══ 综合等级预览 ══ */}
          <div className="flex items-center gap-3 rounded-xl bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] p-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">
            <span className="text-xs font-bold text-[var(--muted-foreground)]">综合等级</span>
            <StatusBadge tone={previewLevel === 'A' ? 'green' : previewLevel === 'B' ? 'blue' : previewLevel === 'C' ? 'orange' : previewLevel === 'D' ? 'orange' : 'red'}>{LEVEL_LABEL[previewLevel]}</StatusBadge>
            <span className="ml-auto text-xs text-[var(--muted-foreground)]">质量×0.5 + 廉洁×0.3 + 出勤×0.2</span>
          </div>

          {/* ══ 评价说明 ══ */}
          <div>
            <span className="text-xs font-semibold text-[var(--muted-foreground)] block mb-1.5">评价说明</span>
            <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder={aiSuggested ? `${aiEngine === 'ai' ? 'AI' : '规则兜底'}已填入参考说明，可编辑或补充...` : '评价说明（可选）'} className="neu-input w-full h-20 resize-none text-sm" />
          </div>
        </Modal>
      )}
    </div>
  );
}
