'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { recommendSuppliers, getClassifications } from '@/lib/api/supplier';
import type { SupplierRecommendation, SupplierSelectionResult } from '@/lib/api/supplier';
import type { SupplierClassification } from '@/lib/types';
import { listBidProjects, getBidProjectDetail, type BidProjectOption, type BidProjectDetail } from '@/lib/api/expert';
import { Sparkles, Wand2, Copy, Download, X, Plus, FileSearch, ChevronDown, ChevronUp, Award, Zap, Building2 } from 'lucide-react';
import { PageHero, SectionCard, StatusBadge } from '@/components/workbench';

const scoreColor = (s: number) => (s >= 85 ? '#059669' : s >= 70 ? '#064ea2' : s >= 55 ? '#d97706' : '#dc2626');
const scoreLabel = (s: number) => (s >= 85 ? '强匹配' : s >= 70 ? '较匹配' : s >= 55 ? '可考虑' : '弱匹配');

const ENTERPRISE_TYPES = ['有限责任公司','股份有限公司','国有企业','集体企业','合伙企业','个人独资企业','外商投资企业','其他'];

const PROMPT_TEMPLATE = `【项目概况】
（描述项目名称、建设地点、规模、投资概算）

【采购范围】
（本次采购的具体范围和工作内容）

【资质要求】
（需要供应商具备的资质，如：建筑工程施工总承包一级、水利行业甲级等）

【特殊要求】
（工期要求、质量等级、环保要求、业绩门槛等）`;

export default function SupplierSelectionPage() {
  const router = useRouter();

  const [classifications, setClassifications] = useState<SupplierClassification[]>([]);
  const [projects, setProjects] = useState<BidProjectOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [projectDetail, setProjectDetail] = useState<BidProjectDetail | null>(null);

  const [requirement, setRequirement] = useState('');
  const [classificationId, setClassificationId] = useState('');
  const [enterpriseFilter, setEnterpriseFilter] = useState<string[]>([]);
  const [minScore, setMinScore] = useState(0);
  const [maxCount, setMaxCount] = useState(10);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SupplierSelectionResult | null>(null);
  const [shortlist, setShortlist] = useState<Map<string, { item: SupplierRecommendation; note: string }>>(new Map());

  useEffect(() => {
    getClassifications().then(setClassifications).catch(() => {});
    listBidProjects().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    if (!projectId) { setProjectDetail(null); return; }
    getBidProjectDetail(projectId).then(setProjectDetail).catch(() => setProjectDetail(null));
  }, [projectId]);

  const selectedProject = useMemo(() => projects.find(p => p.id === projectId), [projects, projectId]);

  const run = async () => {
    if (!requirement.trim()) { setError('请先描述采购需求'); return; }
    setError(''); setLoading(true); setResult(null);
    try {
      let fullReq = requirement.trim();
      if (selectedProject && projectDetail) {
        const ctx = [
          `关联项目：${selectedProject.name}（${selectedProject.projectCode}）`,
          `采购方式：${selectedProject.procurementMethod}`,
          `项目阶段：${selectedProject.stage}`,
          projectDetail.suppliers?.length
            ? `已有参与供应商：${projectDetail.suppliers.map(s => s.supplierName).join('、')}`
            : '',
        ].filter(Boolean).join('；');
        fullReq = `${ctx}\n${fullReq}`;
      }
      const res = await recommendSuppliers({ requirement: fullReq, classificationId: classificationId || undefined, maxCount });
      setResult(res);
      if (res.recommendations.length === 0) setError('未找到匹配的候选供应商，请调整需求描述或筛选条件');
    } catch (e: any) { toast.error(e?.message || '智能推荐失败'); }
    setLoading(false);
  };

  const toggleShortlist = (r: SupplierRecommendation) => {
    setShortlist(prev => {
      const next = new Map(prev);
      if (next.has(r.supplierId)) next.delete(r.supplierId);
      else next.set(r.supplierId, { item: r, note: '' });
      return next;
    });
  };

  const updateNote = (supplierId: string, note: string) => {
    setShortlist(prev => {
      const next = new Map(prev);
      const entry = next.get(supplierId);
      if (entry) next.set(supplierId, { ...entry, note });
      return next;
    });
  };

  const moveShortlistItem = (from: number, to: number) => {
    const entries = [...shortlist.entries()];
    if (to < 0 || to >= entries.length) return;
    const [moved] = entries.splice(from, 1);
    entries.splice(to, 0, moved);
    setShortlist(new Map(entries));
  };

  const buildExportText = () =>
    [...shortlist.entries()]
      .map(([_, { item: r, note }], i) => {
        const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
        return [
          `${i + 1}. ${r.name}`,
          `   分类：${r.classification || '—'}  企业类型：${r.enterpriseType || '—'}`,
          `   匹配度：${r.matchScore}  ${r.reason}`,
          contact ? `   联系人：${contact.name} ${contact.phone}` : '',
          note ? `   备注：${note}` : '',
        ].filter(Boolean).join('\n');
      })
      .join('\n\n');

  const copyList = async () => {
    if (shortlist.size === 0) return;
    try { await navigator.clipboard.writeText(buildExportText()); toast.success('已复制到剪贴板'); }
    catch { toast.error('复制失败'); }
  };
  const downloadList = () => {
    if (shortlist.size === 0) return;
    const blob = new Blob([buildExportText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `供应商候选名单_${new Date().toISOString().slice(0, 10)}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Rules popover (used in PageHero actions) ──
  const rulesPopover = (
    <div className="relative group">
      <button className="inline-flex items-center gap-1.5 rounded-xl border border-[#e5ecf4] bg-white px-3 py-1.5 text-xs font-bold text-[#5a6d8a] hover:border-[#11a874] hover:text-[#11a874] transition">
        <Sparkles size={12} />规则
      </button>
      <div className="absolute right-0 top-full mt-2 w-[380px] glass-card glass-card-lighter rounded-2xl p-5 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition duration-150 z-50">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#5a6d8a] mb-3">供应商 AI 匹配规则</h3>
        <ol className="space-y-2 text-xs text-[#5a6d8a] leading-relaxed">
          <li className="flex gap-2">
            <span className="flex-shrink-0 font-extrabold text-[#11a874]">1.</span>
            需求关键词提取：从采购需求描述中提取项目类型、资质要求、技术参数等关键维度
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 font-extrabold text-[#11a874]">2.</span>
            候选池粗筛：按供应商分类、企业类型、历史评价分数进行合规过滤
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 font-extrabold text-[#11a874]">3.</span>
            资质与能力评分：综合资质匹配度、历史履约评价、经营范围与项目契合度，形成 0-100 匹配分
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 font-extrabold text-[#11a874]">4.</span>
            综合排序：按匹配度降序输出推荐列表，≥85 强匹配 / ≥70 较匹配 / ≥55 可考虑 / 弱匹配
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 font-extrabold text-[#11a874]">5.</span>
            候选管理：支持加入/移除候选名单，拖拽排序，添加备注，导出为 TXT 名单
          </li>
        </ol>
      </div>
    </div>
  );

  // ── Shared input card (reused in both layout states) ──
  const inputCard = (
    <SectionCard title="需求配置" description="描述采购需求，关联项目，配置 AI 匹配参数" className="p-5">
      {/* Project association */}
      <div className="mb-4">
        <label className="text-sm font-semibold text-[#5a6d8a] block mb-1.5">项目关联（可选，用于丰富 AI 上下文）</label>
        <select value={projectId} onChange={e => setProjectId(e.target.value)}
          className="workbench-input text-sm w-full">
          <option value="">不关联项目（仅基于需求文本分析）</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}（{p.projectCode} · {p.procurementMethod} · {p.stage}）</option>
          ))}
        </select>
        {selectedProject && projectDetail && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="rounded-lg bg-[#f3f7fc] px-2 py-1 text-[#5a6d8a] font-medium">采购方式：{selectedProject.procurementMethod}</span>
            <span className="rounded-lg bg-[#f3f7fc] px-2 py-1 text-[#5a6d8a] font-medium">阶段：{selectedProject.stage}</span>
            <span className="rounded-lg bg-[#f3f7fc] px-2 py-1 text-[#5a6d8a] font-medium">已参与供应商：{projectDetail.suppliers?.length ?? 0} 家</span>
            {projectDetail.suppliers?.length > 0 && (
              <span className="w-full rounded-xl border border-[#fcd34d] bg-[#fffbeb] px-3 py-2 text-xs text-[#92400e]">
                已有：{projectDetail.suppliers.map(s => s.supplierName).join('、')}
              </span>
            )}
          </div>
        )}
      </div>

      <hr className="border-[#e5ecf4] mb-4" />

      {/* Requirement */}
      <div className="mb-3">
        <label className="text-sm font-semibold text-[#5a6d8a] block mb-1.5">采购需求描述 *</label>
        <textarea value={requirement} onChange={e => setRequirement(e.target.value)}
          placeholder={PROMPT_TEMPLATE}
          className="w-full rounded-xl border border-[#dce6f3] px-3 py-2.5 text-sm h-28 resize-y focus:outline-none focus:border-[#064ea2] font-mono text-xs leading-relaxed placeholder-[#94a3b8]" />
      </div>

      <div className="flex items-center justify-between">
        <button onClick={() => setRequirement(PROMPT_TEMPLATE)}
          className="text-xs font-semibold text-[#064ea2] hover:underline">填充结构化模板</button>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-[#5a6d8a]">
            推荐数量
            <select value={maxCount} onChange={e => setMaxCount(Number(e.target.value))}
              className="workbench-input text-xs py-1.5">
              {[5, 8, 10, 15, 20].map(n => <option key={n} value={n}>{n} 家</option>)}
            </select>
          </div>
          <button onClick={run} disabled={loading || !requirement.trim()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#064ea2] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#054280] disabled:opacity-50 transition">
            <Wand2 size={15} />{loading ? '智能匹配中...' : '智能推荐'}
          </button>
        </div>
      </div>

      {/* Advanced filters */}
      <div className="mt-4 border-t border-[#e5ecf4] pt-4">
        <button onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#5a6d8a] hover:text-[#18243a] transition">
          {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          高级筛选 · 分类 · 企业类型 · 评分门槛
        </button>
        {showAdvanced && (
          <div className="mt-4 space-y-4">
            <label className="space-y-1 text-sm font-semibold text-[#5a6d8a] block">
              供应商分类
              <select value={classificationId} onChange={e => setClassificationId(e.target.value)}
                className="workbench-input text-sm w-full">
                <option value="">全部分类（AI 自动匹配）</option>
                {classifications.map(c => <option key={c.id} value={c.id}>{c.name}（{c.code}）</option>)}
              </select>
            </label>

            <div>
              <span className="text-sm font-semibold text-[#5a6d8a] block mb-2">企业类型偏好（可多选）</span>
              <div className="flex flex-wrap gap-2">
                {ENTERPRISE_TYPES.map(t => (
                  <button key={t} onClick={() => setEnterpriseFilter(prev =>
                    prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold border transition ${
                      enterpriseFilter.includes(t)
                        ? 'border-[#064ea2] bg-[#eff6ff] text-[#064ea2]'
                        : 'border-[#dce6f3] text-[#5a6d8a] hover:border-[#bcd0e8]'
                    }`}>{t}</button>
                ))}
              </div>
            </div>

            <div>
              <span className="text-sm font-semibold text-[#5a6d8a] block mb-2">
                最低历史评价分数：<strong className="text-[#064ea2]">{minScore > 0 ? `≥ ${minScore} 分` : '不限'}</strong>
              </span>
              <input type="range" min={0} max={100} step={5} value={minScore}
                onChange={e => setMinScore(Number(e.target.value))} className="w-full range-enhanced accent-[#064ea2]" />
              <div className="flex justify-between text-[10px] text-[#8a99ad]">
                <span>不限</span><span>60 (C级)</span><span>80 (B级)</span><span>90 (A级)</span><span>100</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );

  // ── Shortlist panel (only shown when results are present) ──
  const shortlistPanel = (
    <div className="glass-card glass-card-lighter rounded-2xl p-5 lg:sticky lg:top-20">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Award size={15} className="text-[#064ea2]" />
          <h2 className="text-sm font-bold text-[#18243a]">
            候选名单 <span className="text-xs font-normal text-[#5a6d8a]">({shortlist.size})</span>
          </h2>
        </div>
        {shortlist.size > 0 && (
          <div className="flex gap-1">
            <button onClick={copyList} title="复制名单"
              className="rounded-lg p-1.5 text-[#8a99ad] hover:bg-[#f0f5ff] hover:text-[#064ea2] transition"><Copy size={14} /></button>
            <button onClick={downloadList} title="导出名单"
              className="rounded-lg p-1.5 text-[#8a99ad] hover:bg-[#f0f5ff] hover:text-[#064ea2] transition"><Download size={14} /></button>
          </div>
        )}
      </div>

      {shortlist.size === 0 ? (
        <div className="py-6 text-center">
          <Zap size={28} className="mx-auto text-[#d4d8e0] mb-3" />
          <p className="text-sm text-[#5a6d8a] leading-relaxed">
            点击推荐结果中的<br />
            <span className="font-semibold text-[#064ea2]">「加入候选」</span> 构建邀请名单
          </p>
          <p className="mt-1.5 text-xs text-[#8a99ad]">支持排序、备注、导出名单</p>
        </div>
      ) : (
        <div className="space-y-2">
          {[...shortlist.entries()].map(([sid, { item: r, note }], idx) => {
            const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
            const total = shortlist.size;
            return (
              <div key={sid} className="rounded-lg border border-[#dce6f3] p-2.5 group">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col gap-0.5 flex-shrink-0">
                    <button onClick={() => moveShortlistItem(idx, idx - 1)} disabled={idx === 0}
                      className="text-[#d4d8e0] hover:text-[#5a6d8a] disabled:opacity-30 transition"><ChevronUp size={10} /></button>
                    <button onClick={() => moveShortlistItem(idx, idx + 1)} disabled={idx === total - 1}
                      className="text-[#d4d8e0] hover:text-[#5a6d8a] disabled:opacity-30 transition"><ChevronDown size={10} /></button>
                  </div>
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-[#064ea2] text-[10px] font-extrabold text-white">
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-[#18243a] truncate">{r.name}</span>
                      <button onClick={() => toggleShortlist(r)}
                        className="ml-1 flex-shrink-0 text-[#d4d8e0] hover:text-red-500 opacity-0 group-hover:opacity-100 transition"><X size={13} /></button>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-[10px] font-bold" style={{ color: scoreColor(r.matchScore) }}>{r.matchScore}</span>
                      {contact && <span className="text-[10px] text-[#8a99ad] truncate">{contact.name} · {contact.phone}</span>}
                    </div>
                  </div>
                </div>
                <input value={note} onChange={e => updateNote(sid, e.target.value)}
                  placeholder="添加备注（如：优先邀请、需核实资质）"
                  className="w-full mt-2 rounded-md border border-[#dce6f3] px-2 py-1 text-[11px] focus:outline-none focus:border-[#064ea2] bg-[#fafbfc] placeholder-[#94a3b8]" />
              </div>
            );
          })}
          <button onClick={() => setShortlist(new Map())}
            className="w-full rounded-lg py-1.5 text-xs text-[#5a6d8a] hover:bg-red-50 hover:text-red-600 transition">
            清空名单
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      <PageHero
        title="供应商智能选取"
        description="基于采购需求多维度分析，AI 从供应商库中智能匹配并推荐最优候选。支持项目关联、资质过滤、候选对比与结构化导出。"
        tone="green" icon={<Building2 size={14} />}
        actions={rulesPopover}
      />

      {result !== null && !loading ? (
        /* ── 有结果：候选名单非空时双栏，否则全宽 ── */
        <div className={`grid grid-cols-1 gap-5 ${shortlist.size > 0 ? 'lg:grid-cols-3' : ''}`}>
          {/* Left: input + results */}
          <div className={`space-y-3 ${shortlist.size > 0 ? 'lg:col-span-2' : ''}`}>
            {inputCard}

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
            )}

            {/* AI Summary */}
            <div className="glass-card glass-card-lighter rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <FileSearch size={16} className="text-[#064ea2]" />
                <h2 className="text-sm font-bold text-[#18243a]">智能分析摘要</h2>
                <StatusBadge tone={result.engine === 'deepseek' ? 'purple' : 'gray'} className="ml-auto">
                  {result.engine === 'deepseek' ? `AI · ${result.model}` : '规则引擎'}
                </StatusBadge>
              </div>
              <p className="text-sm text-[#5a6d8a] leading-relaxed">{result.summary}</p>
              <div className="flex gap-4 mt-3 text-xs text-[#5a6d8a]">
                <span>候选池 <strong className="text-[#18243a]">{result.candidatePool}</strong> 家</span>
                <span>推荐 <strong className="text-[#18243a]">{result.recommendations.length}</strong> 家</span>
              </div>
            </div>

            {/* Recommendation cards */}
            {result.recommendations.map((r, idx) => {
              const inList = shortlist.has(r.supplierId);
              const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
              return (
                <div key={r.supplierId} className={`glass-card glass-card-lighter rounded-2xl p-4 transition ${
                  inList ? 'border-[#11a874] ring-1 ring-[#11a874]/20' : 'border-[#dce6f3]'
                }`}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#064ea2] text-sm font-extrabold text-white">
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <span className="text-sm font-bold text-[#18243a] cursor-pointer hover:text-[#064ea2] transition"
                          onClick={() => router.push(`/supplier/${r.supplierId}`)}>{r.name}</span>
                        {r.classification && <StatusBadge tone="blue">{r.classification}</StatusBadge>}
                        {r.enterpriseType && <span className="rounded-full bg-[#f1f5f9] px-2 py-0.5 text-xs text-[#5a6d8a]">{r.enterpriseType}</span>}
                        {inList && <StatusBadge tone="green">已入选</StatusBadge>}
                      </div>

                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 h-2 rounded-full bg-[#f1f5f9] overflow-hidden max-w-[280px]">
                          <div className="h-full rounded-full transition-all duration-700"
                            style={{ width: `${r.matchScore}%`, backgroundColor: scoreColor(r.matchScore) }} />
                        </div>
                        <strong className="text-sm tabular-nums min-w-[2rem] text-right"
                          style={{ color: scoreColor(r.matchScore) }}>{r.matchScore}</strong>
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
                          style={{ color: scoreColor(r.matchScore), backgroundColor: scoreColor(r.matchScore) + '14' }}>
                          {scoreLabel(r.matchScore)}
                        </span>
                      </div>

                      <p className="text-sm text-[#5a6d8a] leading-relaxed">{r.reason}</p>
                      {contact && (
                        <p className="mt-1.5 text-xs text-[#8a99ad]">
                          联系人：{contact.name}{contact.phone ? ` · ${contact.phone}` : ''}
                          {r.legalPerson ? ` ｜ 法定代表人：${r.legalPerson}` : ''}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <button onClick={() => router.push(`/supplier/${r.supplierId}`)}
                        className="rounded-lg border border-[#dce6f3] px-3 py-1.5 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition">详情</button>
                      <button onClick={() => toggleShortlist(r)}
                        className={`inline-flex items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                          inList ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'border border-[#dce6f3] text-[#064ea2] hover:bg-[#f0f5ff]'
                        }`}>
                        {inList ? <><X size={12} />移除</> : <><Plus size={12} />加入候选</>}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: shortlist — only rendered when non-empty */}
          {shortlist.size > 0 && (
            <div className="lg:col-span-1">
              {shortlistPanel}
            </div>
          )}
        </div>
      ) : (
        /* ── 无结果：单栏输入布局，全宽 ── */
        <div>
          {inputCard}

          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
          )}

          {loading && (
            <div className="mt-4 rounded-2xl border border-[#dce6f3] bg-white py-14 text-center">
              <div className="inline-flex items-center gap-2 text-sm font-bold text-[#064ea2]">
                <span className="h-2 w-2 rounded-full bg-[#064ea2] animate-pulse" />
                AI 正在分析采购需求，从供应商库中匹配候选...
              </div>
              <p className="mt-3 text-xs text-[#8a99ad] max-w-md mx-auto leading-relaxed">
                分析维度：需求关键词提取 → 候选池粗筛 → 资质与能力评分 → 综合排序
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
