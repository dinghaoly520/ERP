'use client';

import { useEffect, useState, Suspense, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { listBidProjects, previewExtraction, confirmExtraction, listSpecialties, listExperts, getBidProjectDetail, type BidProjectOption, type BidProjectDetail, type ExpertListItem, type ExtractionPreview } from '@/lib/api/expert';
import { StatusBadge } from '@/components/workbench';
import { RulesPopover } from '@/components/rules-popover';
import { Sparkles, ShieldCheck, AlertTriangle, Check, Plus, X, UsersRound, Search, Upload, RefreshCw } from 'lucide-react';

const scoreVar = (s: number): string => (s >= 85 ? 'var(--success)' : s >= 70 ? 'var(--accent)' : s >= 55 ? 'var(--warning)' : 'var(--danger)');
const scoreLabel = (s: number) => (s >= 85 ? '优秀' : s >= 70 ? '良好' : s >= 55 ? '合格' : '较低');
interface SpecialtyQuota { specialty: string; count: number; }

function ExpertExtractPage() {
  const router = useRouter(); const q = useSearchParams();
  const [projects, setProjects] = useState<BidProjectOption[]>([]);
  const [specs, setSpecs] = useState<string[]>([]);
  const [pid, setPid] = useState(q.get('projectId') || '');
  const [pd, setPd] = useState<BidProjectDetail | null>(null);
  const [pool, setPool] = useState<Map<string, number>>(new Map());
  const [tn, setTn] = useState(5); const [alt, setAlt] = useState(2);
  const [mode, setMode] = useState<'ai' | 'manual' | 'upload'>('ai');
  const [extractMode, setExtractMode] = useState<'weighted' | 'fair'>('weighted');
  const [quotas, setQuotas] = useState<SpecialtyQuota[]>([{ specialty: '', count: 2 }]);
  const [loading, setLoading] = useState(false); const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(''); const [preview, setPreview] = useState<ExtractionPreview | null>(null); const [done, setDone] = useState(false);
  const [searchQuery, setSearchQuery] = useState(''); const [searchSpecialty, setSearchSpecialty] = useState('');
  const [searchResults, setSearchResults] = useState<ExpertListItem[]>([]); const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Map<string, ExpertListItem>>(new Map());

  useEffect(() => { listBidProjects().then(setProjects).catch(() => {}); listSpecialties().then(setSpecs).catch(() => {}); }, []);
  useEffect(() => { if (!pid) { setPd(null); return; } getBidProjectDetail(pid).then(setPd).catch(() => setPd(null)); }, [pid]);
  useEffect(() => { if (!pid || specs.length === 0) return; Promise.all(specs.map(s => listExperts({ specialty: s }).then(l => ({ s, c: Array.isArray(l) ? l.length : 0 })))).then(rs => { const m = new Map<string, number>(); rs.forEach(({ s, c }) => { if (c > 0) m.set(s, c); }); setPool(m); }).catch(() => {}); }, [pid, specs]);

  const sel = useMemo(() => projects.find(p => p.id === pid), [projects, pid]);
  const addQ = () => setQuotas(p => [...p, { specialty: '', count: 1 }]);
  const rmQ = (i: number) => { if (quotas.length <= 1) return; setQuotas(p => p.filter((_, x) => x !== i)); };
  const upQ = (i: number, f: keyof SpecialtyQuota, v: string | number) => setQuotas(p => p.map((q, x) => x === i ? { ...q, [f]: v } : q));
  const qt = quotas.reduce((s, q) => s + (q.specialty ? q.count : 0), 0);
  const qp = mode === 'manual' ? quotas.filter(q => q.specialty.trim()).map(q => ({ specialty: q.specialty, count: q.count })) : undefined;
  const et = mode === 'manual' ? Math.max(qt, 1) : tn;
  const modeLabel = mode === 'manual' ? `手动 · 合计${qt}人` : mode === 'upload' ? '上传 · 手动选聘' : `AI 推荐 · ${tn}人`;
  const hasResults = preview !== null || loading || done;

  const run = async () => { if (!pid) { setError('请选择招标项目'); return; } if (mode === 'manual' && !quotas.some(q => q.specialty.trim())) { setError('请至少配置一个专业配额'); return; } setError(''); setLoading(true); setPreview(null); setDone(false); try { setPreview(await previewExtraction({ projectId: pid, totalNeeded: et, alternatives: alt, mode: extractMode, manualQuotas: qp })); } catch (e: any) { setError(e?.message || '抽取失败'); } setLoading(false); };
  const confirm = async () => { if (!preview || !pid) return; setConfirming(true); try { const exps = preview.selected.map(s => ({ userId: s.userId, expertName: s.name, major: s.specialty })); if (exps.length === 0) { setError('没有可确认的正选专家'); setConfirming(false); return; } await confirmExtraction({ projectId: pid, experts: exps }); toast.success(`专家组已组建（${exps.length} 人）`); setDone(true); } catch (e: any) { toast.error(e?.message || '确认失败'); } setConfirming(false); };
  const doSearch = useCallback(async () => { setSearching(true); try { setSearchResults((await listExperts({ search: searchQuery.trim() || undefined, specialty: searchSpecialty || undefined })) as ExpertListItem[] || []); } catch { setSearchResults([]); } setSearching(false); }, [searchQuery, searchSpecialty]);
  const addExpert = (e: ExpertListItem) => setSelected(prev => new Map(prev).set(e.id, e));
  const removeExpert = (id: string) => setSelected(prev => { const n = new Map(prev); n.delete(id); return n; });
  const confirmUpload = async () => { if (!pid || selected.size === 0) return; setConfirming(true); try { await confirmExtraction({ projectId: pid, experts: [...selected.values()].map(e => ({ userId: e.id, expertName: e.displayName, major: e.expertProfile?.specialty || '' })) }); toast.success(`专家组已上传（${selected.size} 人）`); setDone(true); } catch (e: any) { toast.error(e?.message || '上传失败'); } setConfirming(false); };
  const reset = () => { setDone(false); setPreview(null); setSelected(new Map()); setSearchResults([]); setSearchQuery(''); setSearchSpecialty(''); };

  const configCard = (
    <div className="neu-table-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="neu-icon-well flex h-8 w-8 items-center justify-center rounded-[10px]"><Sparkles size={14} className="text-[var(--accent)]" /></div>
        <div><span className="text-sm font-bold text-[var(--foreground)]">抽取配置</span><span className="ml-2 text-xs text-[var(--muted-foreground)]">{modeLabel}</span></div>
      </div>
      <div>
        <label className="text-xs font-semibold text-[var(--muted-foreground)] block mb-1.5">招标项目 *</label>
        <select value={pid} onChange={e => setPid(e.target.value)} className="neu-input text-sm w-full"><option value="">请选择需要组建评审组的项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}（{p.projectCode}）</option>)}</select>
      </div>
      {sel && pd && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-lg bg-[var(--surface)] px-2 py-1 text-[var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">采购方式：{sel.procurementMethod}</span>
          <span className="rounded-lg bg-[var(--surface)] px-2 py-1 text-[var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">阶段：{sel.stage}</span>
          {pd.suppliers?.length > 0 && <span className="w-full rounded-lg bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-3 py-2 text-xs text-[var(--warning)]">参与供应商（将自动回避）：{pd.suppliers.map(s => s.supplierName).join('、')}</span>}
          {pd.experts?.length > 0 && <span className="w-full rounded-lg bg-[color-mix(in_oklch,var(--success)_8%,transparent)] px-3 py-2 text-xs text-[var(--success)]">已分配专家：{pd.experts.map(e => `${e.expertName}（${e.major}）`).join('、')}</span>}
        </div>
      )}
      <hr className="wb-section-rule" />

      <div className="neu-tab-bar">
        <button onClick={() => setMode('ai')} className={`neu-tab ${mode === 'ai' ? 'is-active' : ''}`}>AI 自动推荐</button>
        <button onClick={() => setMode('manual')} className={`neu-tab ${mode === 'manual' ? 'is-active' : ''}`}>手动配置</button>
        <button onClick={() => setMode('upload')} className={`neu-tab ${mode === 'upload' ? 'is-active' : ''}`}>推荐上传</button>
      </div>

      {mode === 'ai' && (
        <div className="grid grid-cols-3 gap-4">
          <label className="space-y-1 text-xs font-semibold text-[var(--muted-foreground)]">正选人数<select value={tn} onChange={e => setTn(Number(e.target.value))} className="neu-input text-sm w-full">{[1,2,3,5,7,9].map(n => <option key={n} value={n}>{n} 名</option>)}</select></label>
          <label className="space-y-1 text-xs font-semibold text-[var(--muted-foreground)]">候补人数<select value={alt} onChange={e => setAlt(Number(e.target.value))} className="neu-input text-sm w-full">{[0,1,2,3,5].map(n => <option key={n} value={n}>{n} 名</option>)}</select></label>
          <label className="space-y-1 text-xs font-semibold text-[var(--muted-foreground)]">抽取模式<select value={extractMode} onChange={e => setExtractMode(e.target.value as 'weighted' | 'fair')} className="neu-input text-sm w-full"><option value="weighted">智能加权</option><option value="fair">公平随机</option></select></label>
        </div>
      )}
      {mode === 'manual' && (
        <div>
          <div className="flex items-center justify-between mb-3"><span className="text-xs font-semibold text-[var(--muted-foreground)]">专业配额（正选合计 {qt} 人）</span><button onClick={addQ} className="neu-btn-xs"><Plus size={12} />添加专业</button></div>
          {quotas.map((q, i) => (
            <div key={i} className="flex items-center gap-2 mb-2">
              <select value={q.specialty} onChange={e => upQ(i, 'specialty', e.target.value)} className="neu-input text-sm flex-1"><option value="">选择专业</option>{specs.map(s => <option key={s} value={s}>{s}{pool.has(s) ? `（${pool.get(s)}人可用）` : ''}</option>)}</select>
              <div className="flex items-center gap-1"><button onClick={() => upQ(i, 'count', Math.max(1, q.count - 1))} className="neu-btn-xs">−</button><span className="w-6 text-center text-sm font-extrabold tabular-nums text-[var(--foreground)]">{q.count}</span><button onClick={() => upQ(i, 'count', q.count + 1)} className="neu-btn-xs">+</button></div>
              <button onClick={() => rmQ(i)} disabled={quotas.length <= 1} className="neu-btn-xs is-danger">×</button>
            </div>
          ))}
          <div className="flex gap-4 mt-3">
            <label className="space-y-1 text-xs font-semibold text-[var(--muted-foreground)]">候补人数<select value={alt} onChange={e => setAlt(Number(e.target.value))} className="neu-input text-sm w-full">{[0,1,2,3,5].map(n => <option key={n} value={n}>{n} 名</option>)}</select></label>
            <label className="space-y-1 text-xs font-semibold text-[var(--muted-foreground)]">抽取模式<select value={extractMode} onChange={e => setExtractMode(e.target.value as 'weighted' | 'fair')} className="neu-input text-sm w-full"><option value="weighted">智能加权</option><option value="fair">公平随机</option></select></label>
          </div>
        </div>
      )}
      {mode === 'upload' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜索专家姓名..." className="neu-input flex-1 min-w-[180px] text-sm" onKeyDown={e => e.key === 'Enter' && doSearch()} />
            <select value={searchSpecialty} onChange={e => setSearchSpecialty(e.target.value)} className="workbench-input !w-auto min-w-[110px]"><option value="">全部专业</option>{specs.map(s => <option key={s} value={s}>{s}</option>)}</select>
            <button onClick={doSearch} disabled={searching} className="neu-btn-xs">{searching ? '搜索中...' : '搜索'}</button>
          </div>
          {searchResults.length > 0 && (
            <div className="max-h-[320px] overflow-y-auto rounded-lg bg-[var(--surface)] shadow-[inset_1px_1px_3px_oklch(0.55_0.03_258/0.08)]">
              {searchResults.map(exp => {
                const isSel = selected.has(exp.id); const assigned = pd?.experts?.some(ex => ex.userId === exp.id);
                return (
                  <div key={exp.id} className={`flex items-center justify-between px-3 py-2 ${isSel ? 'bg-[color-mix(in_oklch,var(--accent)_8%,transparent)]' : ''}`} style={{ borderBottom: '1px solid oklch(0.55 0.03 258 / 0.04)' }}>
                    <div className="min-w-0"><div className="text-sm font-bold text-[var(--foreground)] truncate">{exp.displayName}</div><div className="text-xs text-[var(--muted-foreground)] truncate">{exp.expertProfile?.specialty}{exp.expertProfile?.title ? ` · ${exp.expertProfile.title}` : ''}</div></div>
                    {assigned ? <span className="text-xs text-[var(--muted-foreground)]">—</span> : <button onClick={() => isSel ? removeExpert(exp.id) : addExpert(exp)} disabled={!exp.isActive} className={`neu-btn-xs ${isSel ? 'is-danger' : ''}`}>{isSel ? '移除' : '选择'}</button>}
                  </div>
                );
              })}
            </div>
          )}
          {selected.size > 0 && (
            <div>
              <div className="text-xs font-semibold text-[var(--muted-foreground)] mb-2">已选 · {selected.size} 人</div>
              {[...selected.values()].map((exp, i) => (
                <div key={exp.id} className="flex items-center justify-between rounded-[8px] bg-[var(--surface)] px-3 py-2 mb-1.5 shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">
                  <div className="min-w-0"><span className="text-sm font-bold text-[var(--foreground)]">{exp.displayName}</span><span className="text-xs text-[var(--muted-foreground)] ml-2">{exp.expertProfile?.specialty}</span></div>
                  <button onClick={() => removeExpert(exp.id)} className="neu-btn-xs is-danger"><X size={12} /></button>
                </div>
              ))}
              <button onClick={confirmUpload} disabled={confirming || selected.size === 0 || !pid} className="neu-btn-soft is-success w-full justify-center mt-2">{confirming ? '确认中...' : `确认上传（${selected.size} 人）`}</button>
            </div>
          )}
        </div>
      )}
      {(mode === 'ai' || mode === 'manual') && (
        <button onClick={run} disabled={loading || !pid} className="neu-btn-soft w-full justify-center"><Sparkles size={15} />{loading ? 'AI 分析抽取中...' : '开始智能抽取'}</button>
      )}
    </div>
  );

  const poolCard = pool.size > 0 ? (
    <div className="neu-table-card p-4 text-sm">
      <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">专家库各专业可用人数</span>
      <div className="mt-3 space-y-1.5">
        {[...pool.entries()].sort((a, b) => b[1] - a[1]).map(([specialty, count]) => (
          <div key={specialty} className="flex items-center justify-between text-xs">
            <span className="font-medium text-[var(--foreground)]">{specialty}</span>
            <span className={`font-bold tabular-nums ${count < 3 ? 'text-[var(--danger)]' : 'text-[var(--foreground)]'}`}>{count} 人{count < 3 && <span className="ml-1 text-[10px] text-[var(--danger)]">⚠</span>}</span>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><UsersRound size={17} /></div>
            <div><div className="page-hero__title">专家智能抽取</div><div className="page-hero__sub">基于项目评审需求，AI 分析专业构成并智能抽取专家组，支持多专业配额、供应商回避与专家负荷均衡</div></div>
          </div>
          <div className="page-hero__right">
            <RulesPopover>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-3">专家抽取规则</h3>
              <ol className="space-y-2 text-xs text-[var(--muted-foreground)] leading-relaxed">
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">1.</span>合规过滤：仅「可用」状态专家，工作单位与供应商无关联，未被重复分配至同一项目</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">2.</span>专业匹配：AI 分析项目需求，推荐所需专业构成及人数配比</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">3.</span>能力评估：综合专家历史评价等级、参与项目经验与专业匹配度</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">4.</span>随机抽取：智能加权下 AI 匹配度影响权重；公平随机为 Fisher-Yates 完全随机</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">5.</span>推荐上传：管理员手动搜索并选择专家，确认后直接分配</li>
              </ol>
            </RulesPopover>
          </div>
        </div>
      </div>

      {hasResults ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          <div className="lg:col-span-2 space-y-4">
            {configCard}
            {error && <div className="rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">{error}</div>}
            {loading && <div className="neu-table-card py-14 text-center"><div className="inline-flex items-center gap-2 text-sm font-bold text-[var(--accent)]"><RefreshCw size={14} className="animate-spin" />AI 正在分析项目需求并抽取专家组...</div></div>}

            {preview && !loading && !done && (
              <div className="space-y-4">
                <div className="neu-table-card p-4">
                  <div className="flex items-center gap-2 mb-3"><Sparkles size={16} className="text-[var(--accent)]" /><h2 className="text-sm font-bold text-[var(--foreground)]">AI 评审组分析</h2><StatusBadge tone={preview.engine === 'deepseek' ? 'purple' : 'gray'} className="ml-auto">{preview.engine === 'deepseek' ? `AI · ${preview.model}` : '规则引擎'}</StatusBadge></div>
                  <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">{preview.analysis}</p>
                  {preview.requiredSpecialties.length > 0 && <div className="flex flex-wrap items-center gap-2 mt-3">{preview.requiredSpecialties.map(q => <span key={q.specialty} className="neu-tab-count">{q.specialty} × {q.count}</span>)}</div>}
                </div>
                {preview.shortages.length > 0 && <div className="rounded-xl bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] px-4 py-3 text-sm text-[var(--warning)]"><AlertTriangle size={16} className="inline mr-2" />专业候选人不足{preview.shortages.map(s => `：${s.specialty} 需${s.needed}人/仅${s.available}人`).join('')}</div>}
                <div className="neu-table-card p-4">
                  <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">正选专家组 · {preview.selected.length} 人</span>
                  {preview.selected.map((s, i) => (
                    <div key={s.userId} className="flex items-start gap-3 mt-3" style={i > 0 ? { borderTop: "1px solid oklch(0.55 0.03 258 / 0.06)", paddingTop: "0.75rem" } : {}}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-bold text-[var(--foreground)] cursor-pointer hover:text-[var(--accent)]" onClick={() => router.push('/expert/' + s.userId)}>{s.name}</span><StatusBadge tone="blue">{s.specialty}</StatusBadge><StatusBadge tone="green">正选</StatusBadge></div>
                        <div className="flex items-center gap-2 my-1.5"><div className="flex-1 h-2 rounded-full bg-[var(--muted)]/50 overflow-hidden max-w-[200px]"><div className="h-full rounded-full" style={{ width: `${s.matchScore}%`, backgroundColor: scoreVar(s.matchScore) }} /></div><strong className="text-xs tabular-nums" style={{ color: scoreVar(s.matchScore) }}>{s.matchScore}</strong></div>
                        <p className="text-xs text-[var(--muted-foreground)]">{s.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {preview.alternatives.length > 0 && (
                  <div className="neu-table-card p-4">
                    <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">候补专家 · {preview.alternatives.length} 人</span>
                    {preview.alternatives.map(s => (<div key={s.userId} className="flex items-center justify-between mt-2 text-xs"><span className="font-semibold text-[var(--foreground)]">{s.name}</span><span className="text-[var(--muted-foreground)]">{s.specialty}</span><span className="font-bold" style={{ color: scoreVar(s.matchScore) }}>{s.matchScore}</span></div>))}
                  </div>
                )}
                <button onClick={confirm} disabled={confirming} className="neu-btn-soft is-success w-full justify-center"><Check size={16} />{confirming ? '确认中...' : `确认组建专家组（${preview.selected.length} 人）`}</button>
              </div>
            )}
            {done && (
              <div className="neu-table-card p-10 text-center">
                <ShieldCheck size={40} className="mx-auto text-[var(--success)] mb-3" />
                <h3 className="text-lg font-bold text-[var(--foreground)] mb-1">专家组已组建</h3><p className="text-sm text-[var(--muted-foreground)]">已为「{sel?.name}」分配专家</p>
                <div className="flex justify-center gap-3 mt-6"><button onClick={() => router.push('/expert/repository')} className="neu-btn-soft">返回专家库</button><button onClick={reset} className="neu-btn-soft">重新抽取</button></div>
              </div>
            )}
          </div>
          <div className="lg:col-span-1 space-y-4">{poolCard}</div>
        </div>
      ) : (
        <div className="space-y-5">
          {configCard}
          {error && <div className="rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">{error}</div>}
        </div>
      )}
    </div>
  );
}

export default function ExpertExtractPageWrapper() {
  return <Suspense fallback={<div className="flex min-h-[300px] items-center justify-center text-sm text-[var(--muted-foreground)]">加载抽取配置...</div>}><ExpertExtractPage /></Suspense>;
}
