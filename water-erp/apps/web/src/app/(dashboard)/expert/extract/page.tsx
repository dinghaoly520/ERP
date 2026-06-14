'use client';

import { useEffect, useState, Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { listBidProjects, previewExtraction, confirmExtraction, listSpecialties, listExperts, getBidProjectDetail, type BidProjectOption, type BidProjectDetail } from '@/lib/api/expert';
import type { ExtractionPreview } from '@/lib/api/expert';
import { Sparkles, ShieldCheck, AlertTriangle, Check, Plus, X, ChevronDown, ChevronUp } from 'lucide-react';

const scoreColor = (s: number) => (s >= 85 ? '#059669' : s >= 70 ? '#0756a5' : s >= 55 ? '#d97706' : '#dc2626');
const scoreLabel = (s: number) => (s >= 85 ? '优秀' : s >= 70 ? '良好' : s >= 55 ? '合格' : '较低');

interface SpecialtyQuota { specialty: string; count: number; reason?: string; }

function ExpertExtractPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [projects, setProjects] = useState<BidProjectOption[]>([]);
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [projectId, setProjectId] = useState(searchParams.get('projectId') || '');
  const [projectDetail, setProjectDetail] = useState<BidProjectDetail | null>(null);
  const [specialtyPoolCounts, setSpecialtyPoolCounts] = useState<Map<string, number>>(new Map());

  const [showAdvanced, setShowAdvanced] = useState(true);
  const [totalNeeded, setTotalNeeded] = useState(5);
  const [alternatives, setAlternatives] = useState(2);
  const [mode, setMode] = useState<'weighted' | 'fair'>('weighted');
  const [preferHighEval, setPreferHighEval] = useState(true);
  const [avoidOverloaded, setAvoidOverloaded] = useState(true);

  const [useManualQuotas, setUseManualQuotas] = useState(false);
  const [manualQuotas, setManualQuotas] = useState<SpecialtyQuota[]>([{ specialty: '', count: 2 }]);

  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ExtractionPreview | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => { listBidProjects().then(setProjects).catch(() => {}); listSpecialties().then(setSpecialties).catch(() => {}); }, []);
  useEffect(() => {
    if (!projectId) { setProjectDetail(null); return; }
    getBidProjectDetail(projectId).then(setProjectDetail).catch(() => setProjectDetail(null));
  }, [projectId]);
  useEffect(() => {
    if (!projectId || specialties.length === 0) return;
    Promise.all(specialties.map(s => listExperts({ specialty: s }).then(list => ({ specialty: s, count: Array.isArray(list) ? list.length : 0 }))))
      .then(results => { const map = new Map<string, number>(); results.forEach(({ specialty, count }) => { if (count > 0) map.set(specialty, count); }); setSpecialtyPoolCounts(map); }).catch(() => {});
  }, [projectId, specialties]);

  const selectedProject = useMemo(() => projects.find(p => p.id === projectId), [projects, projectId]);

  const addQuota = () => setManualQuotas(prev => [...prev, { specialty: '', count: 1 }]);
  const removeQuota = (i: number) => { if (manualQuotas.length <= 1) return; setManualQuotas(prev => prev.filter((_, idx) => idx !== i)); };
  const updateQuota = (i: number, field: keyof SpecialtyQuota, value: string | number) => { setManualQuotas(prev => prev.map((q, idx) => idx === i ? { ...q, [field]: value } : q)); };
  const manualQuotaTotal = manualQuotas.reduce((s, q) => s + (q.specialty ? q.count : 0), 0);
  const quotaPayload = useManualQuotas ? manualQuotas.filter(q => q.specialty.trim()).map(q => ({ specialty: q.specialty, count: q.count })) : undefined;
  const effectiveTotal = useManualQuotas ? Math.max(manualQuotaTotal, 1) : totalNeeded;

  const run = async () => {
    if (!projectId) { setError('请选择招标项目'); return; }
    if (useManualQuotas && !manualQuotas.some(q => q.specialty.trim())) { setError('请至少配置一个专业配额'); return; }
    setError(''); setLoading(true); setPreview(null); setDone(false);
    try { setPreview(await previewExtraction({ projectId, totalNeeded: effectiveTotal, alternatives, mode, manualQuotas: quotaPayload })); }
    catch (e: any) { setError(e?.message || '抽取失败'); }
    setLoading(false);
  };

  const confirm = async () => {
    if (!preview || !projectId) return;
    setConfirming(true);
    try {
      const experts = preview.selected.map(s => ({ userId: s.userId, expertName: s.name, major: s.specialty }));
      if (experts.length === 0) { setError('没有可确认的正选专家'); setConfirming(false); return; }
      await confirmExtraction({ projectId, experts });
      setDone(true);
    } catch (e: any) { setError(e?.message || '确认失败'); }
    setConfirming(false);
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-7 pb-4 border-b border-[#dce3eb]">
        <div className="text-[11px] font-extrabold text-[#0756a5] uppercase tracking-[0.1em]">Expert Extraction</div>
        <h1 className="mt-1 text-[22px] font-black tracking-[-0.03em] text-[#0f172a]">专家智能抽取</h1>
        <p className="mt-1 text-[13px] text-[#64748b] max-w-2xl">
          基于项目评审需求，AI 分析专业构成并智能抽取专家组。支持多专业配额、供应商回避、专家负荷均衡与历史评价参考。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-4">
          {/* 1. Project selection */}
          <div className="border border-[#dce3eb] bg-white px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[12px] font-extrabold uppercase tracking-[0.04em] text-[#64748b]">招标项目 *</span>
            </div>
            <select value={projectId} onChange={e => setProjectId(e.target.value)}
              className="w-full px-3 py-2 border border-[#dce3eb] text-[13px] focus:outline-none focus:border-[#0756a5]">
              <option value="">请选择需要组建评审组的项目</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}（{p.projectCode} · {p.procurementMethod} · {p.stage} · {p._count?.suppliers ?? 0}家供应商）</option>
              ))}
            </select>
            {selectedProject && projectDetail && (
              <div className="mt-3 flex flex-wrap gap-2 text-[12px] text-[#64748b]">
                <span className="px-2 py-1 border border-[#e9eef4] bg-[#f8fafc]">采购方式：{selectedProject.procurementMethod}</span>
                <span className="px-2 py-1 border border-[#e9eef4] bg-[#f8fafc]">当前阶段：{selectedProject.stage}</span>
                <span className="px-2 py-1 border border-[#e9eef4] bg-[#f8fafc]">已分配专家：{projectDetail.experts?.length ?? 0} 人</span>
                {projectDetail.suppliers?.length > 0 && (
                  <div className="w-full mt-1 px-3 py-2 border border-[#fde68a] bg-[#fffbeb] text-[#92400e]">
                    <span className="font-bold">参与供应商（将自动回避）：</span> {projectDetail.suppliers.map(s => s.supplierName).join('、')}
                  </div>
                )}
                {projectDetail.experts?.length > 0 && (
                  <div className="w-full mt-0.5 px-3 py-2 border border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]">
                    <span className="font-bold">已分配专家：</span> {projectDetail.experts.map(e => `${e.expertName}（${e.major}）`).join('、')}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. Quota configuration */}
          <div className="border border-[#dce3eb] bg-white">
            <button onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-[#f8fafc] transition">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-extrabold text-[#0f172a]">专业配额与参数配置</span>
                <span className="text-[12px] text-[#94a3b8]">
                  {useManualQuotas ? `手动 · ${manualQuotaTotal}人` : `AI 推荐 · ${totalNeeded}人`}
                </span>
              </div>
              {showAdvanced ? <ChevronUp size={15} className="text-[#94a3b8]" /> : <ChevronDown size={15} className="text-[#94a3b8]" />}
            </button>

            {showAdvanced && (
              <div className="px-5 pb-5 space-y-5 border-t border-[#e9eef4] pt-4">
                {/* Mode switch */}
                <div className="flex items-center gap-4">
                  <span className="text-[12px] font-bold text-[#0f172a]">配额模式</span>
                  <div className="flex border border-[#dce3eb]">
                    <button onClick={() => setUseManualQuotas(false)}
                      className={`px-3 py-1.5 text-[12px] font-bold transition ${!useManualQuotas ? 'bg-[#0756a5] text-white' : 'text-[#64748b] hover:bg-[#f8fafc]'}`}>
                      AI 自动推荐
                    </button>
                    <button onClick={() => setUseManualQuotas(true)}
                      className={`px-3 py-1.5 text-[12px] font-bold transition ${useManualQuotas ? 'bg-[#0756a5] text-white' : 'text-[#64748b] hover:bg-[#f8fafc]'}`}>
                      手动配置专业配额
                    </button>
                  </div>
                </div>

                {/* AI mode */}
                {!useManualQuotas && (
                  <div className="grid grid-cols-3 gap-4">
                    <Field label="正选人数">
                      <select value={totalNeeded} onChange={e => setTotalNeeded(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-[#dce3eb] text-[13px] focus:outline-none focus:border-[#0756a5]">
                        {[1,2,3,5,7,9].map(n => <option key={n} value={n}>{n} 名</option>)}
                      </select>
                    </Field>
                    <Field label="候补人数">
                      <select value={alternatives} onChange={e => setAlternatives(Number(e.target.value))}
                        className="w-full px-3 py-2 border border-[#dce3eb] text-[13px] focus:outline-none focus:border-[#0756a5]">
                        {[0,1,2,3,5].map(n => <option key={n} value={n}>{n} 名</option>)}
                      </select>
                    </Field>
                    <Field label="抽取模式">
                      <select value={mode} onChange={e => setMode(e.target.value as 'weighted' | 'fair')}
                        className="w-full px-3 py-2 border border-[#dce3eb] text-[13px] focus:outline-none focus:border-[#0756a5]">
                        <option value="weighted">智能加权（AI 匹配度影响权重）</option>
                        <option value="fair">公平随机（纯随机抽取）</option>
                      </select>
                    </Field>
                  </div>
                )}

                {/* Manual mode */}
                {useManualQuotas && (
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-[12px] font-bold text-[#0f172a]">专业配额 <span className="font-normal text-[#94a3b8]">（正选合计 {manualQuotaTotal} 人）</span></span>
                      <button onClick={addQuota} className="inline-flex items-center gap-1 text-[12px] font-bold text-[#0756a5] hover:underline"><Plus size={12} />添加专业</button>
                    </div>
                    <div className="space-y-2">
                      {manualQuotas.map((q, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <select value={q.specialty} onChange={e => updateQuota(i, 'specialty', e.target.value)}
                            className="flex-1 px-3 py-2 border border-[#dce3eb] text-[13px] focus:outline-none focus:border-[#0756a5]">
                            <option value="">选择专业</option>
                            {specialties.map(s => (
                              <option key={s} value={s}>{s}{specialtyPoolCounts.has(s) ? `（${specialtyPoolCounts.get(s)}人可用）` : ''}</option>
                            ))}
                          </select>
                          <div className="flex items-center gap-1">
                            <button onClick={() => updateQuota(i, 'count', Math.max(1, q.count - 1))}
                              className="w-7 h-7 flex items-center justify-center border border-[#dce3eb] text-[#64748b] hover:bg-[#f8fafc] text-[13px] font-bold">−</button>
                            <span className="w-6 text-center text-[13px] font-bold text-[#0f172a] tabular-nums">{q.count}</span>
                            <button onClick={() => updateQuota(i, 'count', q.count + 1)}
                              className="w-7 h-7 flex items-center justify-center border border-[#dce3eb] text-[#64748b] hover:bg-[#f8fafc] text-[13px] font-bold">+</button>
                          </div>
                          <button onClick={() => removeQuota(i)} disabled={manualQuotas.length <= 1}
                            className="p-1 text-[#94a3b8] hover:text-[#dc2626] disabled:opacity-30"><X size={14} /></button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-4 mt-3">
                      <Field label="候补人数">
                        <select value={alternatives} onChange={e => setAlternatives(Number(e.target.value))}
                          className="px-3 py-2 border border-[#dce3eb] text-[13px] focus:outline-none focus:border-[#0756a5]">
                          {[0,1,2,3,5].map(n => <option key={n} value={n}>{n} 名</option>)}
                        </select>
                      </Field>
                      <Field label="抽取模式">
                        <select value={mode} onChange={e => setMode(e.target.value as 'weighted' | 'fair')}
                          className="px-3 py-2 border border-[#dce3eb] text-[13px] focus:outline-none focus:border-[#0756a5]">
                          <option value="weighted">智能加权</option>
                          <option value="fair">公平随机</option>
                        </select>
                      </Field>
                    </div>
                  </div>
                )}

                {/* Advanced options */}
                <div className="space-y-2 px-4 py-3 border border-[#e9eef4] bg-[#f8fafc]">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-[#64748b] mb-1">高级选项</p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={preferHighEval} onChange={e => setPreferHighEval(e.target.checked)} className="accent-[#0756a5]" />
                    <span className="text-[12px] text-[#64748b]">优先评价高分专家（历史评价 A 级权重 ×1.5）</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={avoidOverloaded} onChange={e => setAvoidOverloaded(e.target.checked)} className="accent-[#0756a5]" />
                    <span className="text-[12px] text-[#64748b]">回避已满负荷专家（当前参评 ≥3 个项目时降低权重）</span>
                  </label>
                </div>

                <button onClick={run} disabled={loading || !projectId}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-[13px] font-bold text-white bg-[#0756a5] hover:bg-[#06428a] disabled:opacity-50 transition">
                  <Sparkles size={15} />{loading ? 'AI 分析抽取中...' : '开始智能抽取'}
                </button>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-3 border border-[#fca5a5] bg-[#fef2f2] text-[13px] text-[#991b1b]">{error}</div>
          )}

          {/* Loading */}
          {loading && (
            <div className="border border-[#dce3eb] bg-white py-14 text-center">
              <div className="inline-flex items-center gap-2 text-[14px] font-extrabold text-[#0756a5]">
                <span className="w-2 h-2 bg-[#0756a5] animate-pulse" />
                AI 正在分析项目评审需求并智能抽取专家组...
              </div>
              <p className="text-[12px] text-[#94a3b8] mt-3 max-w-md mx-auto leading-relaxed">
                分析维度：项目专业需求 → 合规过滤（供应商回避+可用性）→ 专家匹配评分 → 加权/随机抽取
              </p>
            </div>
          )}

          {/* Results */}
          {preview && !loading && !done && (
            <div className="space-y-4">
              {/* Analysis summary */}
              <div className="border border-[#dce3eb] bg-white px-5 py-4">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={15} className="text-[#0756a5]" />
                  <h2 className="text-[13px] font-extrabold text-[#0f172a]">AI 评审组分析</h2>
                  <span className={`ml-auto text-[11px] font-bold px-2 py-0.5 ${preview.engine === 'deepseek' ? 'text-[#0756a5] bg-[#e8f4ff]' : 'text-[#64748b] bg-[#f1f5f9]'}`}>
                    {preview.engine === 'deepseek' ? `AI · ${preview.model}` : '规则引擎'}
                  </span>
                </div>
                <p className="text-[13px] text-[#64748b] leading-relaxed">{preview.analysis}</p>
                {preview.requiredSpecialties.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    <span className="text-[11px] font-semibold text-[#64748b]">专业构成：</span>
                    {preview.requiredSpecialties.map(q => (
                      <span key={q.specialty} className="text-[11px] font-semibold px-2 py-0.5 border border-[#dce3eb] text-[#0756a5] bg-[#e8f4ff] cursor-help" title={q.reason}>
                        {q.specialty} × {q.count}
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-4 mt-3 text-[12px] text-[#64748b]">
                  <span>合规候选池 <strong className="text-[#0f172a]">{preview.eligiblePool}</strong> 人</span>
                  <span>模式：{mode === 'weighted' ? '智能加权' : '公平随机'}</span>
                </div>
              </div>

              {/* Shortage warnings */}
              {preview.shortages.length > 0 && (
                <div className="px-4 py-3 border border-[#fcd34d] bg-[#fffbeb]">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={15} className="flex-shrink-0 mt-0.5 text-[#92400e]" />
                    <div>
                      <p className="text-[13px] font-extrabold text-[#92400e] mb-1">专业候选人不足</p>
                      {preview.shortages.map(s => (
                        <p key={s.specialty} className="text-[12px] text-[#92400e]">{s.specialty}：需要 {s.needed} 人，仅 {s.available} 人可用</p>
                      ))}
                      <p className="text-[11px] text-[#92400e] mt-1">建议调整配额或扩充专家库</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Selected experts */}
              <div>
                <h3 className="text-[13px] font-extrabold text-[#0f172a] mb-3">正选专家组（{preview.selected.length} 人）</h3>
                {preview.selected.length === 0 ? (
                  <p className="text-[13px] text-[#94a3b8] border border-[#dce3eb] bg-white px-5 py-8 text-center">合规候选不足，请调整专业配额或先录入更多专家</p>
                ) : (
                  <div className="border border-[#dce3eb] bg-white">
                    {preview.selected.map((s, idx) => (
                      <div key={s.userId} className={`px-5 py-4 ${idx < preview.selected.length - 1 ? 'border-b border-[#e9eef4]' : ''}`}>
                        <div className="flex items-start gap-3">
                          <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-[#0756a5] text-white text-[12px] font-black">{idx + 1}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-2">
                              <span className="text-[14px] font-extrabold text-[#0f172a] cursor-pointer hover:text-[#0756a5]" onClick={() => router.push('/expert/' + s.userId)}>{s.name}</span>
                              <span className="text-[11px] font-semibold px-2 py-0.5 border border-[#dce3eb] text-[#0756a5] bg-[#e8f4ff]">{s.specialty}</span>
                              {s.title && <span className="text-[11px] text-[#94a3b8]">{s.title}</span>}
                              <span className="text-[11px] font-bold text-[#059669]">正选</span>
                            </div>
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className="flex-1 h-1.5 bg-[#f1f5f9] overflow-hidden max-w-[240px]">
                                <div className="h-full transition-all duration-700" style={{width: `${s.matchScore}%`, backgroundColor: scoreColor(s.matchScore)}} />
                              </div>
                              <strong className="text-[13px] tabular-nums" style={{color: scoreColor(s.matchScore)}}>{s.matchScore}</strong>
                              <span className="text-[10px] font-bold px-1.5 py-0.5" style={{color: scoreColor(s.matchScore), background: scoreColor(s.matchScore) + '14'}}>{scoreLabel(s.matchScore)}</span>
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

              {/* Alternatives */}
              {preview.alternatives.length > 0 && (
                <div>
                  <h3 className="text-[13px] font-extrabold text-[#0f172a] mb-3">候补专家（{preview.alternatives.length} 人）</h3>
                  <div className="border border-[#dce3eb] bg-white">
                    {preview.alternatives.map((s, i) => (
                      <div key={s.userId} className={`flex items-center justify-between px-4 py-2.5 ${i < preview.alternatives.length - 1 ? 'border-b border-[#e9eef4]' : ''}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[13px] font-bold text-[#0f172a] truncate">{s.name}</span>
                          <span className="text-[11px] font-semibold text-[#0756a5]">{s.specialty}</span>
                          {s.employer && <span className="text-[11px] text-[#94a3b8] truncate hidden sm:inline">{s.employer}</span>}
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                          <span className="text-[12px] font-extrabold tabular-nums" style={{color: scoreColor(s.matchScore)}}>{s.matchScore}</span>
                          <span className="text-[10px] font-bold px-2 py-0.5 border border-[#fcd34d] text-[#92400e] bg-[#fef9c3]">候补</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Confirm */}
              {preview.selected.length > 0 && (
                <button onClick={confirm} disabled={confirming}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 text-[13px] font-bold text-white bg-[#059669] hover:bg-[#047857] disabled:opacity-60 transition">
                  <Check size={15} />{confirming ? '确认中...' : `确认组建专家组（${preview.selected.length} 人）`}
                </button>
              )}
            </div>
          )}

          {/* Done */}
          {done && (
            <div className="border border-[#bbf7d0] bg-[#f0fdf4] px-8 py-10 text-center">
              <ShieldCheck size={36} className="mx-auto text-[#059669] mb-3" />
              <h3 className="text-[16px] font-extrabold text-[#0f172a] mb-1">专家组已组建</h3>
              <p className="text-[13px] text-[#64748b] mb-1">已为「{selectedProject?.name}」分配 {preview?.selected.length} 位评审专家</p>
              <p className="text-[12px] text-[#94a3b8] mb-5">专家可在专家端（:3005）签到并参与评审</p>
              <div className="flex justify-center gap-3">
                <button onClick={() => router.push('/expert/repository')} className="px-5 py-2 text-[13px] font-bold text-white bg-[#0756a5] hover:bg-[#06428a] transition">返回专家库</button>
                <button onClick={() => router.push(`/expert/extract?projectId=${projectId}`)} className="px-5 py-2 text-[13px] font-bold text-[#0756a5] border border-[#0756a5] hover:bg-[#e8f4ff] transition">重新抽取</button>
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="lg:col-span-1">
          <div className="space-y-4 lg:sticky lg:top-20">
            {/* Pool preview */}
            <div className="border border-[#dce3eb] bg-white px-5 py-4">
              <h2 className="text-[12px] font-extrabold uppercase tracking-[0.04em] text-[#64748b] mb-3">专家库预览</h2>
              {specialtyPoolCounts.size === 0 ? (
                <p className="text-[12px] text-[#94a3b8] py-6 text-center">选择项目后显示各专业可用人数</p>
              ) : (
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                  {[...specialtyPoolCounts.entries()].sort((a, b) => b[1] - a[1]).map(([specialty, count]) => {
                    const isLow = count < 3;
                    return (
                      <div key={specialty} className="flex items-center justify-between text-[12px] py-1">
                        <span className="text-[#0f172a] font-semibold">{specialty}</span>
                        <span className={`font-extrabold tabular-nums ${isLow ? 'text-[#dc2626]' : 'text-[#0f172a]'}`}>
                          {count} 人{isLow && <span className="ml-1 text-[10px] text-[#dc2626]">⚠</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Rules */}
            <div className="border border-[#dce3eb] bg-white px-5 py-4">
              <h2 className="text-[12px] font-extrabold uppercase tracking-[0.04em] text-[#64748b] mb-3">抽取规则</h2>
              <ol className="space-y-2.5 text-[12px] text-[#64748b] leading-relaxed">
                {[
                  '合规过滤：仅「可用」状态专家，工作单位与项目参与供应商无关联（供应商回避），且未被重复分配至同一项目',
                  '专业匹配：AI 分析项目需求，推荐所需专业构成及人数配比；支持手动调整各专业配额',
                  '能力评估：综合专家历史评价等级、参与项目经验与专业匹配度，形成 0-100 匹配分',
                  '随机抽取：智能加权模式下 AI 匹配度影响权重但不决定结果；公平随机模式为纯 Fisher-Yates 随机',
                  '确认后建立 BidExpert 分配记录，专家即可在专家端（:3005）签到并参与评审',
                ].map((text, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-[#0756a5] font-extrabold flex-shrink-0">{i + 1}.</span>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-[#64748b] mb-1.5">{label}</label>
      {children}
    </div>
  );
}

export default function ExpertExtractPageWrapper() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[300px] text-[#94a3b8] text-[13px]">
        <div className="text-center">
          <div className="w-2 h-2 bg-[#0756a5] animate-pulse mx-auto mb-2" />
          加载抽取配置...
        </div>
      </div>
    }>
      <ExpertExtractPage />
    </Suspense>
  );
}
