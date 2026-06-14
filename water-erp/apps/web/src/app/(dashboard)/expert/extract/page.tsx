'use client';

import { useEffect, useState, Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { listBidProjects, previewExtraction, confirmExtraction, listSpecialties, listExperts, getBidProjectDetail, type BidProjectOption, type BidProjectDetail } from '@/lib/api/expert';
import type { ExtractionPreview } from '@/lib/api/expert';
import { DataToolbar, MetricCard, PageHero, SectionCard, StatusBadge } from '@/components/workbench';
import { Sparkles, ShieldCheck, AlertTriangle, Check, Plus, X, ChevronDown, ChevronUp, UsersRound } from 'lucide-react';

const scoreColor = (s: number) => (s >= 85 ? '#059669' : s >= 70 ? '#064ea2' : s >= 55 ? '#d97706' : '#dc2626');
const scoreLabel = (s: number) => (s >= 85 ? '优秀' : s >= 70 ? '良好' : s >= 55 ? '合格' : '较低');

interface SpecialtyQuota { specialty: string; count: number; }

function ExpertExtractPage() {
  const router = useRouter();
  const q = useSearchParams();
  const [projects, setProjects] = useState<BidProjectOption[]>([]);
  const [specs, setSpecs] = useState<string[]>([]);
  const [pid, setPid] = useState(q.get('projectId') || '');
  const [pd, setPd] = useState<BidProjectDetail | null>(null);
  const [pool, setPool] = useState<Map<string, number>>(new Map());
  const [open, setOpen] = useState(true);
  const [tn, setTn] = useState(5);
  const [alt, setAlt] = useState(2);
  const [mode, setMode] = useState<'weighted' | 'fair'>('weighted');
  const [manual, setManual] = useState(false);
  const [quotas, setQuotas] = useState<SpecialtyQuota[]>([{ specialty: '', count: 2 }]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ExtractionPreview | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => { listBidProjects().then(setProjects).catch(() => {}); listSpecialties().then(setSpecs).catch(() => {}); }, []);
  useEffect(() => { if (!pid) { setPd(null); return; } getBidProjectDetail(pid).then(setPd).catch(() => setPd(null)); }, [pid]);
  useEffect(() => {
    if (!pid || specs.length === 0) return;
    Promise.all(specs.map(s => listExperts({ specialty: s }).then(l => ({ s, c: Array.isArray(l) ? l.length : 0 }))))
      .then(rs => { const m = new Map<string, number>(); rs.forEach(({ s, c }) => { if (c > 0) m.set(s, c); }); setPool(m); }).catch(() => {});
  }, [pid, specs]);

  const sel = useMemo(() => projects.find(p => p.id === pid), [projects, pid]);

  const addQ = () => setQuotas(p => [...p, { specialty: '', count: 1 }]);
  const rmQ = (i: number) => { if (quotas.length <= 1) return; setQuotas(p => p.filter((_, x) => x !== i)); };
  const upQ = (i: number, f: keyof SpecialtyQuota, v: string | number) => setQuotas(p => p.map((q, x) => x === i ? { ...q, [f]: v } : q));
  const qt = quotas.reduce((s, q) => s + (q.specialty ? q.count : 0), 0);
  const qp = manual ? quotas.filter(q => q.specialty.trim()).map(q => ({ specialty: q.specialty, count: q.count })) : undefined;
  const et = manual ? Math.max(qt, 1) : tn;

  const run = async () => {
    if (!pid) { setError('请选择招标项目'); return; }
    if (manual && !quotas.some(q => q.specialty.trim())) { setError('请至少配置一个专业配额'); return; }
    setError(''); setLoading(true); setPreview(null); setDone(false);
    try {
      setPreview(await previewExtraction({ projectId: pid, totalNeeded: et, alternatives: alt, mode, manualQuotas: qp }));
    } catch (e: any) { setError(e?.message || '抽取失败'); }
    setLoading(false);
  };

  const confirm = async () => {
    if (!preview || !pid) return;
    setConfirming(true);
    try {
      const exps = preview.selected.map(s => ({ userId: s.userId, expertName: s.name, major: s.specialty }));
      if (exps.length === 0) { setError('没有可确认的正选专家'); setConfirming(false); return; }
      await confirmExtraction({ projectId: pid, experts: exps });
      toast.success(`专家组已组建（${exps.length} 人）`);
      setDone(true);
    } catch (e: any) { toast.error(e?.message || '确认失败'); }
    setConfirming(false);
  };

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="专家管理中心" title="专家智能抽取"
        description="基于项目评审需求，AI 分析专业构成并智能抽取专家组。支持多专业配额配置、供应商回避与专家负荷均衡。"
        tone="blue" icon={<UsersRound size={14} />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ═══ 左列：配置 + 结果 ═══ */}
        <div className="lg:col-span-2 space-y-5">

          {/* ── 项目选择 ── */}
          <SectionCard title="招标项目 *">
            <select value={pid} onChange={e => setPid(e.target.value)} className="workbench-input text-sm w-full">
              <option value="">请选择需要组建评审组的项目</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}（{p.projectCode} · {p.procurementMethod} · {p.stage} · {p._count?.suppliers ?? 0}家供应商）
                </option>
              ))}
            </select>
            {sel && pd && (
              <div className="mt-4 space-y-2">
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-lg bg-[#f3f7fc] px-2 py-1 text-[#5a6d8a] font-medium">采购方式：{sel.procurementMethod}</span>
                  <span className="rounded-lg bg-[#f3f7fc] px-2 py-1 text-[#5a6d8a] font-medium">阶段：{sel.stage}</span>
                  <span className="rounded-lg bg-[#f3f7fc] px-2 py-1 text-[#5a6d8a] font-medium">已分配专家：{pd.experts?.length ?? 0} 人</span>
                </div>
                {pd.suppliers?.length > 0 && (
                  <div className="rounded-xl border border-[#fcd34d] bg-[#fffbeb] px-4 py-2.5 text-xs">
                    <strong className="text-[#92400e]">参与供应商（将自动回避）：</strong>
                    <span className="text-[#92400e]"> {pd.suppliers.map(s => s.supplierName).join('、')}</span>
                  </div>
                )}
                {pd.experts?.length > 0 && (
                  <div className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] px-4 py-2.5 text-xs">
                    <strong className="text-[#166534]">已分配专家：</strong>
                    <span className="text-[#166534]"> {pd.experts.map(e => `${e.expertName}（${e.major}）`).join('、')}</span>
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          {/* ── 配额与参数 ── */}
          <SectionCard
            title={manual ? `专业配额 · 手动 · 合计${qt}人` : `专业配额 · AI 推荐 · ${tn}人`}
            action={
              <button onClick={() => setOpen(!open)} className="rounded-lg p-1.5 text-[#8a99ad] hover:bg-[#f8fafc] transition">
                {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>
            }
          >
            {open && (
              <div className="space-y-5">
                {/* Quota mode switch */}
                <div className="flex items-center gap-4">
                  <span className="text-xs font-semibold text-[#5a6d8a]">配额模式</span>
                  <div className="flex rounded-xl border border-[#dce6f3] overflow-hidden">
                    <button onClick={() => setManual(false)}
                      className={`px-3 py-1.5 text-xs font-bold transition ${!manual ? 'bg-[#064ea2] text-white' : 'text-[#5a6d8a] hover:bg-[#f8fafc]'}`}>
                      AI 自动推荐
                    </button>
                    <button onClick={() => setManual(true)}
                      className={`px-3 py-1.5 text-xs font-bold transition ${manual ? 'bg-[#064ea2] text-white' : 'text-[#5a6d8a] hover:bg-[#f8fafc]'}`}>
                      手动配置
                    </button>
                  </div>
                </div>

                {/* AI mode */}
                {!manual && (
                  <div className="grid grid-cols-3 gap-4">
                    <label className="space-y-1 text-sm font-semibold text-[#5a6d8a]">
                      正选人数
                      <select value={tn} onChange={e => setTn(Number(e.target.value))} className="workbench-input text-sm w-full">
                        {[1,2,3,5,7,9].map(n => <option key={n} value={n}>{n} 名</option>)}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm font-semibold text-[#5a6d8a]">
                      候补人数
                      <select value={alt} onChange={e => setAlt(Number(e.target.value))} className="workbench-input text-sm w-full">
                        {[0,1,2,3,5].map(n => <option key={n} value={n}>{n} 名</option>)}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm font-semibold text-[#5a6d8a]">
                      抽取模式
                      <select value={mode} onChange={e => setMode(e.target.value as 'weighted' | 'fair')} className="workbench-input text-sm w-full">
                        <option value="weighted">智能加权</option>
                        <option value="fair">公平随机</option>
                      </select>
                    </label>
                  </div>
                )}

                {/* Manual quotas */}
                {manual && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-[#5a6d8a]">专业配额（正选合计 {qt} 人）</span>
                      <button onClick={addQ} className="inline-flex items-center gap-1 text-xs font-bold text-[#064ea2] hover:underline">
                        <Plus size={12} />添加专业
                      </button>
                    </div>
                    <div className="space-y-2">
                      {quotas.map((q, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <select value={q.specialty} onChange={e => upQ(i, 'specialty', e.target.value)}
                            className="workbench-input text-sm flex-1">
                            <option value="">选择专业</option>
                            {specs.map(s => (
                              <option key={s} value={s}>{s}{pool.has(s) ? `（${pool.get(s)}人可用）` : ''}</option>
                            ))}
                          </select>
                          <div className="flex items-center gap-1">
                            <button onClick={() => upQ(i, 'count', Math.max(1, q.count - 1))}
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#dce6f3] text-sm text-[#5a6d8a] hover:bg-[#f8fafc]">−</button>
                            <span className="w-6 text-center text-sm font-extrabold tabular-nums text-[#18243a]">{q.count}</span>
                            <button onClick={() => upQ(i, 'count', q.count + 1)}
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#dce6f3] text-sm text-[#5a6d8a] hover:bg-[#f8fafc]">+</button>
                          </div>
                          <button onClick={() => rmQ(i)} disabled={quotas.length <= 1}
                            className="p-1 text-[#8a99ad] hover:text-red-500 disabled:opacity-30 transition">
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-4 mt-3">
                      <label className="space-y-1 text-sm font-semibold text-[#5a6d8a]">
                        候补人数
                        <select value={alt} onChange={e => setAlt(Number(e.target.value))} className="workbench-input text-sm w-full">
                          {[0,1,2,3,5].map(n => <option key={n} value={n}>{n} 名</option>)}
                        </select>
                      </label>
                      <label className="space-y-1 text-sm font-semibold text-[#5a6d8a]">
                        抽取模式
                        <select value={mode} onChange={e => setMode(e.target.value as 'weighted' | 'fair')} className="workbench-input text-sm w-full">
                          <option value="weighted">智能加权</option>
                          <option value="fair">公平随机</option>
                        </select>
                      </label>
                    </div>
                  </div>
                )}

                <button onClick={run} disabled={loading || !pid}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#064ea2] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#054280] disabled:opacity-50 transition">
                  <Sparkles size={15} />
                  {loading ? 'AI 分析抽取中...' : '开始智能抽取'}
                </button>
              </div>
            )}
          </SectionCard>

          {/* ── Error ── */}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
          )}

          {/* ── Loading ── */}
          {loading && (
            <div className="rounded-2xl border border-[#dce6f3] bg-white py-14 text-center">
              <div className="inline-flex items-center gap-2 text-sm font-bold text-[#064ea2]">
                <span className="h-2 w-2 rounded-full bg-[#064ea2] animate-pulse" />
                AI 正在分析项目需求并抽取专家组...
              </div>
              <p className="mt-3 text-xs text-[#8a99ad] max-w-md mx-auto leading-relaxed">
                分析维度：项目专业需求 → 合规过滤（供应商回避+可用性）→ 专家匹配评分 → 加权/随机抽取
              </p>
            </div>
          )}

          {/* ── 结果 ── */}
          {preview && !loading && !done && (
            <div className="space-y-5">
              {/* Analysis summary */}
              <div className="rounded-2xl border border-[#dce6f3] bg-white p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={16} className="text-[#064ea2]" />
                  <h2 className="text-sm font-bold text-[#18243a]">AI 评审组分析</h2>
                  <StatusBadge tone={preview.engine === 'deepseek' ? 'purple' : 'gray'} className="ml-auto">
                    {preview.engine === 'deepseek' ? `AI · ${preview.model}` : '规则引擎'}
                  </StatusBadge>
                </div>
                <p className="text-sm text-[#5a6d8a] leading-relaxed">{preview.analysis}</p>
                {preview.requiredSpecialties.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span className="text-xs text-[#5a6d8a]">专业构成：</span>
                    {preview.requiredSpecialties.map(q => (
                      <span key={q.specialty} className="rounded-full bg-[#e8f4ff] px-2.5 py-0.5 text-xs font-semibold text-[#064ea2]" title={q.reason}>
                        {q.specialty} × {q.count}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-4 mt-3 text-xs text-[#5a6d8a]">
                  <span>合规候选池 <strong className="text-[#18243a]">{preview.eligiblePool}</strong> 人</span>
                  <span>模式：{mode === 'weighted' ? '智能加权' : '公平随机'}</span>
                </div>
              </div>

              {/* Shortages warning */}
              {preview.shortages.length > 0 && (
                <div className="rounded-xl border border-[#fcd34d] bg-[#fffbeb] px-4 py-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-[#92400e]" />
                    <div>
                      <p className="text-sm font-semibold text-[#92400e] mb-1">专业候选人不足</p>
                      {preview.shortages.map(s => (
                        <p key={s.specialty} className="text-xs text-[#92400e]">
                          {s.specialty}：需要 {s.needed} 人，仅 {s.available} 人可用
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Selected experts */}
              <SectionCard title={`正选专家组 · ${preview.selected.length} 人`} className="overflow-hidden p-0">
                {preview.selected.length === 0 ? (
                  <div className="py-12 text-center text-sm text-[#8a99ad]">
                    合规候选不足，请调整专业配额或先录入更多专家
                  </div>
                ) : (
                  <div>
                    {preview.selected.map((s, i) => (
                      <div key={s.userId} className={`px-5 py-4 ${i < preview.selected.length - 1 ? 'border-b border-[#edf2f7]' : ''}`}>
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#064ea2] text-sm font-extrabold text-white">
                            {i + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1.5">
                              <span className="text-sm font-bold text-[#18243a] cursor-pointer hover:text-[#064ea2] transition"
                                onClick={() => router.push('/expert/' + s.userId)}>{s.name}</span>
                              <StatusBadge tone="blue">{s.specialty}</StatusBadge>
                              {s.title && <span className="text-xs text-[#5a6d8a]">{s.title}</span>}
                              <StatusBadge tone="green">正选</StatusBadge>
                            </div>
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className="flex-1 h-2 rounded-full bg-[#f1f5f9] overflow-hidden max-w-[240px]">
                                <div className="h-full rounded-full transition-all duration-700"
                                  style={{ width: `${s.matchScore}%`, backgroundColor: scoreColor(s.matchScore) }} />
                              </div>
                              <strong className="text-sm tabular-nums" style={{ color: scoreColor(s.matchScore) }}>{s.matchScore}</strong>
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                                style={{ color: scoreColor(s.matchScore), backgroundColor: scoreColor(s.matchScore) + '14' }}>
                                {scoreLabel(s.matchScore)}
                              </span>
                            </div>
                            <p className="text-sm text-[#5a6d8a] leading-relaxed">{s.reason}</p>
                            {s.employer && <p className="text-xs text-[#8a99ad] mt-1">工作单位：{s.employer}</p>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              {/* Alternatives */}
              {preview.alternatives.length > 0 && (
                <SectionCard title={`候补专家 · ${preview.alternatives.length} 人`} className="overflow-hidden p-0">
                  {preview.alternatives.map((s, i) => (
                    <div key={s.userId} className={`flex items-center justify-between px-4 py-2.5 ${i < preview.alternatives.length - 1 ? 'border-b border-[#edf2f7]' : ''}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-semibold text-[#18243a] truncate">{s.name}</span>
                        <span className="text-xs text-[#064ea2] font-medium">{s.specialty}</span>
                        {s.employer && <span className="text-xs text-[#8a99ad] truncate hidden sm:inline">{s.employer}</span>}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                        <span className="text-sm font-extrabold tabular-nums" style={{ color: scoreColor(s.matchScore) }}>{s.matchScore}</span>
                        <StatusBadge tone="orange">候补</StatusBadge>
                      </div>
                    </div>
                  ))}
                </SectionCard>
              )}

              {/* Confirm */}
              {preview.selected.length > 0 && (
                <button onClick={confirm} disabled={confirming}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#11a874] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#0e8c5f] disabled:opacity-60 transition">
                  <Check size={16} />{confirming ? '确认中...' : `确认组建专家组（${preview.selected.length} 人）`}
                </button>
              )}
            </div>
          )}

          {/* ── Done ── */}
          {done && (
            <div className="rounded-2xl border border-[#bbf7d0] bg-[#f0fdf4] px-8 py-12 text-center">
              <ShieldCheck size={40} className="mx-auto text-[#11a874] mb-3" />
              <h3 className="text-lg font-bold text-[#18243a] mb-1">专家组已组建</h3>
              <p className="text-sm text-[#5a6d8a] mb-1">已为「{sel?.name}」分配 {preview?.selected.length} 位评审专家</p>
              <p className="text-xs text-[#8a99ad] mb-5">专家可在专家端（:3005）签到并参与评审</p>
              <div className="flex justify-center gap-3">
                <button onClick={() => router.push('/expert/repository')}
                  className="rounded-xl bg-[#064ea2] px-5 py-2 text-sm font-bold text-white hover:bg-[#054280] transition">返回专家库</button>
                <button onClick={() => { setDone(false); setPreview(null); }}
                  className="rounded-xl border border-[#064ea2] px-5 py-2 text-sm font-bold text-[#064ea2] hover:bg-[#f0f5ff] transition">重新抽取</button>
              </div>
            </div>
          )}
        </div>

        {/* ═══ 右列：侧栏 ═══ */}
        <div className="lg:col-span-1 space-y-4">
          {/* Expert pool preview */}
          <div className="rounded-2xl border border-[#dce6f3] bg-white p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#5a6d8a] mb-3">专家库预览</h3>
            {pool.size === 0 ? (
              <p className="py-6 text-center text-xs text-[#8a99ad]">选择项目后显示各专业可用人数</p>
            ) : (
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                {[...pool.entries()].sort((a, b) => b[1] - a[1]).map(([specialty, count]) => {
                  const isLow = count < 3;
                  return (
                    <div key={specialty} className="flex items-center justify-between py-1 text-xs">
                      <span className="font-medium text-[#18243a]">{specialty}</span>
                      <span className={`font-bold tabular-nums ${isLow ? 'text-red-500' : 'text-[#18243a]'}`}>
                        {count} 人{isLow && <span className="ml-1 text-[10px] text-red-400">⚠</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Rules */}
          <div className="rounded-2xl border border-[#dce6f3] bg-white p-5">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#5a6d8a] mb-3">抽取规则</h3>
            <ol className="space-y-2.5 text-xs text-[#5a6d8a] leading-relaxed">
              <li className="flex gap-2">
                <span className="flex-shrink-0 font-extrabold text-[#064ea2]">1.</span>
                合规过滤：仅「可用」状态专家，工作单位与供应商无关联，未被重复分配至同一项目
              </li>
              <li className="flex gap-2">
                <span className="flex-shrink-0 font-extrabold text-[#064ea2]">2.</span>
                专业匹配：AI 分析项目需求，推荐所需专业构成及人数配比；支持手动调整各专业配额
              </li>
              <li className="flex gap-2">
                <span className="flex-shrink-0 font-extrabold text-[#064ea2]">3.</span>
                能力评估：综合专家历史评价等级、参与项目经验与专业匹配度，形成 0-100 匹配分
              </li>
              <li className="flex gap-2">
                <span className="flex-shrink-0 font-extrabold text-[#064ea2]">4.</span>
                随机抽取：智能加权下 AI 匹配度影响权重；公平随机为 Fisher-Yates 完全随机
              </li>
              <li className="flex gap-2">
                <span className="flex-shrink-0 font-extrabold text-[#064ea2]">5.</span>
                确认后建立 BidExpert 分配记录，专家在专家端签到后即可参与评审
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ExpertExtractPageWrapper() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[300px] items-center justify-center text-sm text-[#8a99ad]">
        <div className="text-center">
          <div className="mx-auto mb-2 h-2 w-2 animate-pulse rounded-full bg-[#064ea2]" />
          加载抽取配置...
        </div>
      </div>
    }>
      <ExpertExtractPage />
    </Suspense>
  );
}
