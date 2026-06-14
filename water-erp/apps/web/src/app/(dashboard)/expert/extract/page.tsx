'use client';

import { useEffect, useState, Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { listBidProjects, previewExtraction, confirmExtraction, listSpecialties, listExperts, getBidProjectDetail, type BidProjectOption, type BidProjectDetail } from '@/lib/api/expert';
import type { ExtractionPreview } from '@/lib/api/expert';
import { Sparkles, ShieldCheck, AlertTriangle, Check, Plus, X, ChevronDown, ChevronUp } from 'lucide-react';

const sc = (s: number) => (s >= 85 ? '#059669' : s >= 70 ? '#0756a5' : s >= 55 ? '#d97706' : '#dc2626');
const sl = (s: number) => (s >= 85 ? '优秀' : s >= 70 ? '良好' : s >= 55 ? '合格' : '较低');

interface SQ { specialty: string; count: number; }

function ExpertExtractPage() {
  const r = useRouter();
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
  const [quotas, setQuotas] = useState<SQ[]>([{ specialty: '', count: 2 }]);
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
  const upQ = (i: number, f: keyof SQ, v: string | number) => { setQuotas(p => p.map((q, x) => x === i ? { ...q, [f]: v } : q)); };
  const qt = quotas.reduce((s, q) => s + (q.specialty ? q.count : 0), 0);
  const qp = manual ? quotas.filter(q => q.specialty.trim()).map(q => ({ specialty: q.specialty, count: q.count })) : undefined;
  const et = manual ? Math.max(qt, 1) : tn;

  const run = async () => {
    if (!pid) { setError('请选择招标项目'); return; }
    if (manual && !quotas.some(q => q.specialty.trim())) { setError('请至少配置一个专业配额'); return; }
    setError(''); setLoading(true); setPreview(null); setDone(false);
    try { setPreview(await previewExtraction({ projectId: pid, totalNeeded: et, alternatives: alt, mode, manualQuotas: qp })); } catch (e: any) { setError(e?.message || '抽取失败'); }
    setLoading(false);
  };

  const confirm = async () => {
    if (!preview || !pid) return;
    setConfirming(true);
    try {
      const exps = preview.selected.map(s => ({ userId: s.userId, expertName: s.name, major: s.specialty }));
      if (exps.length === 0) { setError('没有可确认的正选专家'); setConfirming(false); return; }
      await confirmExtraction({ projectId: pid, experts: exps }); setDone(true);
    } catch (e: any) { setError(e?.message || '确认失败'); }
    setConfirming(false);
  };

  const L = ({ children }: { children: React.ReactNode }) => <label className="block text-[11px] font-bold text-[#64748b] mb-1.5">{children}</label>;
  const S = (p: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className="w-full px-3 py-2 border border-[#dce3eb] text-[13px] focus:outline-none focus:border-[#0756a5]" />;
  const H = ({ text }: { text: string }) => <h3 className="text-[12px] font-extrabold uppercase tracking-[0.04em] text-[#64748b] mb-3">{text}</h3>;

  return (
    <div>
      <div className="mb-7 pb-4 border-b border-[#dce3eb]">
        <div className="text-[11px] font-extrabold text-[#0756a5] uppercase tracking-[0.1em]">Expert Extraction</div>
        <h1 className="mt-1 text-[24px] font-black tracking-[-0.03em] text-[#0f172a]">专家智能抽取</h1>
        <p className="mt-1 text-[13px] text-[#64748b]">AI 分析专业构成并智能抽取专家组，支持多专业配额、供应商回避与专家负荷均衡。</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          {/* Project */}
          <div className="border border-[#dce3eb] bg-white px-5 py-4">
            <div className="text-[12px] font-extrabold uppercase tracking-[0.04em] text-[#64748b] mb-3">招标项目 *</div>
            <S value={pid} onChange={e => setPid(e.target.value)}>
              <option value="">请选择需要组建评审组的项目</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}（{p.projectCode} · {p.procurementMethod} · {p.stage} · {p._count?.suppliers ?? 0}家供应商）</option>)}
            </S>
            {sel && pd && (
              <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
                <span className="px-2 py-1 border border-[#e9eef4] bg-[#f8fafc] text-[#64748b]">采购方式：{sel.procurementMethod}</span>
                <span className="px-2 py-1 border border-[#e9eef4] bg-[#f8fafc] text-[#64748b]">阶段：{sel.stage}</span>
                <span className="px-2 py-1 border border-[#e9eef4] bg-[#f8fafc] text-[#64748b]">已分配专家：{pd.experts?.length ?? 0} 人</span>
                {pd.suppliers?.length > 0 && (
                  <div className="w-full mt-1 px-3 py-2 border border-[#fcd34d] bg-[#fffbeb] text-[12px] text-[#92400e]"><strong>参与供应商（将自动回避）：</strong> {pd.suppliers.map(s => s.supplierName).join('、')}</div>
                )}
                {pd.experts?.length > 0 && (
                  <div className="w-full mt-0.5 px-3 py-2 border border-[#bbf7d0] bg-[#f0fdf4] text-[12px] text-[#166534]"><strong>已分配专家：</strong> {pd.experts.map(e => `${e.expertName}（${e.major}）`).join('、')}</div>
                )}
              </div>
            )}
          </div>

          {/* Config */}
          <div className="border border-[#dce3eb] bg-white">
            <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-3 hover:bg-[#f8fafc]">
              <div className="flex items-center gap-2"><span className="text-[13px] font-extrabold text-[#0f172a]">专业配额与参数配置</span><span className="text-[12px] text-[#94a3b8]">{manual ? `手动 · ${qt}人` : `AI · ${tn}人`}</span></div>
              {open ? <ChevronUp size={15} className="text-[#94a3b8]" /> : <ChevronDown size={15} className="text-[#94a3b8]" />}
            </button>
            {open && (
              <div className="px-5 pb-5 space-y-5 border-t border-[#e9eef4] pt-4">
                <div className="flex items-center gap-4">
                  <span className="text-[12px] font-extrabold text-[#0f172a]">配额模式</span>
                  <div className="flex border border-[#dce3eb]">
                    <button onClick={() => setManual(false)} className={`px-3 py-1.5 text-[12px] font-bold ${!manual ? 'bg-[#0756a5] text-white' : 'text-[#64748b] hover:bg-[#f8fafc]'}`}>AI 自动推荐</button>
                    <button onClick={() => setManual(true)} className={`px-3 py-1.5 text-[12px] font-bold ${manual ? 'bg-[#0756a5] text-white' : 'text-[#64748b] hover:bg-[#f8fafc]'}`}>手动配置专业配额</button>
                  </div>
                </div>
                {!manual && (
                  <div className="grid grid-cols-3 gap-4">
                    <div><L>正选人数</L><S value={tn} onChange={e => setTn(Number(e.target.value))}>{[1,2,3,5,7,9].map(n => <option key={n} value={n}>{n} 名</option>)}</S></div>
                    <div><L>候补人数</L><S value={alt} onChange={e => setAlt(Number(e.target.value))}>{[0,1,2,3,5].map(n => <option key={n} value={n}>{n} 名</option>)}</S></div>
                    <div><L>抽取模式</L><S value={mode} onChange={e => setMode(e.target.value as 'weighted' | 'fair')}><option value="weighted">智能加权</option><option value="fair">公平随机</option></S></div>
                  </div>
                )}
                {manual && (
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-[12px] font-extrabold text-[#0f172a]">专业配额 <span className="font-normal text-[#94a3b8]">（正选合计 {qt} 人）</span></span>
                      <button onClick={addQ} className="inline-flex items-center gap-1 text-[12px] font-bold text-[#0756a5]"><Plus size={12} />添加专业</button>
                    </div>
                    <div className="space-y-2">
                      {quotas.map((q, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <S value={q.specialty} onChange={e => upQ(i, 'specialty', e.target.value)}>
                            <option value="">选择专业</option>
                            {specs.map(s => <option key={s} value={s}>{s}{pool.has(s) ? `（${pool.get(s)}人可用）` : ''}</option>)}
                          </S>
                          <div className="flex items-center gap-1">
                            <button onClick={() => upQ(i, 'count', Math.max(1, q.count - 1))} className="w-7 h-7 flex items-center justify-center border border-[#dce3eb] text-[#64748b] hover:bg-[#f8fafc] text-[13px] font-bold">−</button>
                            <span className="w-6 text-center text-[13px] font-extrabold tabular-nums text-[#0f172a]">{q.count}</span>
                            <button onClick={() => upQ(i, 'count', q.count + 1)} className="w-7 h-7 flex items-center justify-center border border-[#dce3eb] text-[#64748b] hover:bg-[#f8fafc] text-[13px] font-bold">+</button>
                          </div>
                          <button onClick={() => rmQ(i)} disabled={quotas.length <= 1} className="p-1 text-[#94a3b8] hover:text-[#dc2626] disabled:opacity-30"><X size={14} /></button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-4 mt-3">
                      <div><L>候补人数</L><S value={alt} onChange={e => setAlt(Number(e.target.value))}>{[0,1,2,3,5].map(n => <option key={n} value={n}>{n} 名</option>)}</S></div>
                      <div><L>抽取模式</L><S value={mode} onChange={e => setMode(e.target.value as 'weighted' | 'fair')}><option value="weighted">智能加权</option><option value="fair">公平随机</option></S></div>
                    </div>
                  </div>
                )}
                <button onClick={run} disabled={loading || !pid} className="inline-flex items-center gap-1.5 px-5 py-2 text-[13px] font-bold text-white bg-[#0756a5] hover:bg-[#06428a] disabled:opacity-50"><Sparkles size={15} />{loading ? 'AI 分析抽取中...' : '开始智能抽取'}</button>
              </div>
            )}
          </div>

          {error && <div className="px-4 py-3 border border-[#fca5a5] bg-[#fef2f2] text-[13px] font-bold text-[#991b1b]">{error}</div>}

          {loading && (
            <div className="border border-[#dce3eb] bg-white py-14 text-center">
              <div className="inline-flex items-center gap-2 text-[14px] font-extrabold text-[#0756a5]"><span className="w-2 h-2 bg-[#0756a5] animate-pulse" />AI 正在分析项目需求并抽取专家组...</div>
              <p className="text-[12px] text-[#94a3b8] mt-3">分析维度：项目专业需求 → 合规过滤 → 专家匹配评分 → 加权/随机抽取</p>
            </div>
          )}

          {preview && !loading && !done && (
            <div className="space-y-4">
              <div className="border border-[#dce3eb] bg-white px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={15} className="text-[#0756a5]" /><h2 className="text-[13px] font-extrabold text-[#0f172a]">AI 评审组分析</h2>
                  <span className={`ml-auto text-[11px] font-bold px-2 py-0.5 ${preview.engine === 'deepseek' ? 'text-[#0756a5] bg-[#e8f4ff]' : 'text-[#64748b] bg-[#f1f5f9]'}`}>{preview.engine === 'deepseek' ? `AI · ${preview.model}` : '规则引擎'}</span>
                </div>
                <p className="text-[13px] text-[#64748b] leading-relaxed">{preview.analysis}</p>
                {preview.requiredSpecialties.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span className="text-[11px] font-bold text-[#64748b]">专业构成：</span>
                    {preview.requiredSpecialties.map(q => <span key={q.specialty} className="text-[11px] font-semibold px-2 py-0.5 border border-[#dce3eb] text-[#0756a5] bg-[#e8f4ff]">{q.specialty} × {q.count}</span>)}
                  </div>
                )}
                <div className="flex gap-4 mt-3 text-[12px] text-[#64748b]"><span>合规候选池 <strong className="text-[#0f172a]">{preview.eligiblePool}</strong> 人</span><span>模式：{mode === 'weighted' ? '智能加权' : '公平随机'}</span></div>
              </div>

              {preview.shortages.length > 0 && (
                <div className="px-4 py-3 border border-[#fcd34d] bg-[#fffbeb]">
                  <div className="flex items-start gap-2"><AlertTriangle size={15} className="flex-shrink-0 mt-0.5 text-[#92400e]" /><div><p className="text-[13px] font-extrabold text-[#92400e] mb-1">专业候选人不足</p>{preview.shortages.map(s => <p key={s.specialty} className="text-[12px] text-[#92400e]">{s.specialty}：需要 {s.needed} 人，仅 {s.available} 人可用</p>)}</div></div>
                </div>
              )}

              <div>
                <H text={`正选专家组 · ${preview.selected.length} 人`} />
                {preview.selected.length === 0 ? (
                  <div className="border border-[#dce3eb] bg-white py-12 text-center text-[13px] text-[#94a3b8]">合规候选不足，请调整专业配额或先录入更多专家</div>
                ) : (
                  <div className="border border-[#dce3eb] bg-white">
                    {preview.selected.map((s, i) => (
                      <div key={s.userId} className={`px-5 py-4 ${i < preview.selected.length - 1 ? 'border-b border-[#e9eef4]' : ''}`}>
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-[#0756a5] text-white text-[12px] font-black">{i + 1}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <span className="text-[14px] font-extrabold text-[#0f172a] cursor-pointer hover:text-[#0756a5]" onClick={() => r.push('/expert/' + s.userId)}>{s.name}</span>
                              <span className="text-[11px] font-semibold px-2 py-0.5 border border-[#dce3eb] text-[#0756a5] bg-[#e8f4ff]">{s.specialty}</span>
                              {s.title && <span className="text-[11px] text-[#94a3b8]">{s.title}</span>}<span className="text-[11px] font-bold text-[#059669]">正选</span>
                            </div>
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className="flex-1 h-1.5 bg-[#f1f5f9] overflow-hidden max-w-[240px]"><div className="h-full transition-all duration-700" style={{width: `${s.matchScore}%`, backgroundColor: sc(s.matchScore)}} /></div>
                              <strong className="text-[13px] tabular-nums" style={{color: sc(s.matchScore)}}>{s.matchScore}</strong>
                              <span className="text-[10px] font-bold px-1.5 py-0.5" style={{color: sc(s.matchScore), background: sc(s.matchScore) + '14'}}>{sl(s.matchScore)}</span>
                            </div>
                            <p className="text-[12px] text-[#64748b] leading-relaxed">{s.reason}</p>
                            {s.employer && <p className="text-[11px] text-[#94a3b8] mt-1">工作单位：{s.employer}</p>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {preview.alternatives.length > 0 && (
                <div>
                  <H text={`候补专家 · ${preview.alternatives.length} 人`} />
                  <div className="border border-[#dce3eb] bg-white">
                    {preview.alternatives.map((s, i) => (
                      <div key={s.userId} className={`flex items-center justify-between px-4 py-2.5 ${i < preview.alternatives.length - 1 ? 'border-b border-[#e9eef4]' : ''}`}>
                        <div className="flex items-center gap-2 min-w-0"><span className="text-[13px] font-bold text-[#0f172a] truncate">{s.name}</span><span className="text-[11px] font-semibold text-[#0756a5]">{s.specialty}</span>{s.employer && <span className="text-[11px] text-[#94a3b8] truncate hidden sm:inline">{s.employer}</span>}</div>
                        <div className="flex items-center gap-3 flex-shrink-0 ml-2"><span className="text-[12px] font-extrabold tabular-nums" style={{color: sc(s.matchScore)}}>{s.matchScore}</span><span className="text-[10px] font-bold px-2 py-0.5 border border-[#fcd34d] text-[#92400e] bg-[#fffbeb]">候补</span></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {preview.selected.length > 0 && (
                <button onClick={confirm} disabled={confirming} className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-bold text-white bg-[#059669] hover:bg-[#047857] disabled:opacity-60"><Check size={15} />{confirming ? '确认中...' : `确认组建专家组（${preview.selected.length} 人）`}</button>
              )}
            </div>
          )}

          {done && (
            <div className="border border-[#bbf7d0] bg-[#f0fdf4] px-8 py-12 text-center">
              <ShieldCheck size={36} className="mx-auto text-[#059669] mb-3" /><h3 className="text-[16px] font-extrabold text-[#0f172a] mb-1">专家组已组建</h3>
              <p className="text-[13px] text-[#64748b] mb-1">已为「{sel?.name}」分配 {preview?.selected.length} 位评审专家</p>
              <p className="text-[12px] text-[#94a3b8] mb-5">专家可在专家端（:3005）签到并参与评审</p>
              <div className="flex justify-center gap-3">
                <button onClick={() => r.push('/expert/repository')} className="px-5 py-2 text-[13px] font-bold text-white bg-[#0756a5] hover:bg-[#06428a]">返回专家库</button>
                <button onClick={() => { setDone(false); setPreview(null); }} className="px-5 py-2 text-[13px] font-bold text-[#0756a5] border border-[#0756a5] hover:bg-[#e8f4ff]">重新抽取</button>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-1"><div className="space-y-4 lg:sticky lg:top-20">
          <div className="border border-[#dce3eb] bg-white px-5 py-4">
            <h2 className="text-[12px] font-extrabold uppercase tracking-[0.04em] text-[#64748b] mb-3">专家库预览</h2>
            {pool.size === 0 ? <p className="text-[12px] text-[#94a3b8] py-6 text-center">选择项目后显示各专业可用人数</p> : (
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                {[...pool.entries()].sort((a, b) => b[1] - a[1]).map(([s, c]) => { const lo = c < 3; return <div key={s} className="flex items-center justify-between text-[12px] py-1"><span className="text-[#0f172a] font-semibold">{s}</span><span className={`font-extrabold tabular-nums ${lo ? 'text-[#dc2626]' : 'text-[#0f172a]'}`}>{c} 人{lo && <span className="ml-1 text-[10px] text-[#dc2626]">⚠</span>}</span></div>; })}
              </div>
            )}
          </div>
          <div className="border border-[#dce3eb] bg-white px-5 py-4">
            <h2 className="text-[12px] font-extrabold uppercase tracking-[0.04em] text-[#64748b] mb-3">抽取规则</h2>
            <ol className="space-y-2.5 text-[12px] text-[#64748b] leading-relaxed">
              {['合规过滤：仅「可用」状态专家，工作单位与供应商无关联，未被重复分配','专业匹配：AI 分析项目需求，推荐专业构成及人数配比','能力评估：综合历史评价等级、项目经验与匹配度，形成 0-100 匹配分','随机抽取：加权模式 AI 影响权重但不决定结果；公平模式为 Fisher-Yates 随机','确认后建立 BidExpert 记录，专家即可在专家端签到参与评审'].map((t, i) => <li key={i} className="flex gap-2"><span className="text-[#0756a5] font-extrabold flex-shrink-0">{i + 1}.</span><span>{t}</span></li>)}
            </ol>
          </div>
        </div></div>
      </div>
    </div>
  );
}

export default function ExpertExtractPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[300px] text-[#94a3b8] text-[13px]"><div className="text-center"><div className="w-2 h-2 bg-[#0756a5] animate-pulse mx-auto mb-2" />加载抽取配置...</div></div>}>
      <ExpertExtractPage />
    </Suspense>
  );
}
