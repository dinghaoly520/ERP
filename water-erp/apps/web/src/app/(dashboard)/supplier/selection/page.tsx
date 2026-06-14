'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { recommendSuppliers, getClassifications, getSupplierList } from '@/lib/api/supplier';
import type { SupplierRecommendation, SupplierSelectionResult } from '@/lib/api/supplier';
import type { SupplierClassification, Supplier } from '@/lib/types';
import { listBidProjects, getBidProjectDetail, type BidProjectOption, type BidProjectDetail } from '@/lib/api/expert';
import { Sparkles, Wand2, Copy, Download, X, Plus, FileSearch, ChevronDown, ChevronUp, Filter, Target, Award, Zap, Building2, Briefcase, GripVertical } from 'lucide-react';
import { PageHero } from '@/components/workbench';

const scoreColor = (s: number) => (s >= 85 ? '#11a874' : s >= 70 ? '#064ea2' : s >= 55 ? '#f5a623' : '#e74c3c');
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

  // ── State ──
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

  // ── Init ──
  useEffect(() => {
    getClassifications().then(setClassifications).catch(() => {});
    listBidProjects().then(setProjects).catch(() => {});
  }, []);

  // Load project detail when selected
  useEffect(() => {
    if (!projectId) { setProjectDetail(null); return; }
    getBidProjectDetail(projectId).then(setProjectDetail).catch(() => setProjectDetail(null));
  }, [projectId]);

  const selectedProject = useMemo(() => projects.find(p => p.id === projectId), [projects, projectId]);

  // ── Actions ──
  const run = async () => {
    if (!requirement.trim()) { setError('请先描述采购需求'); return; }
    setError(''); setLoading(true); setResult(null);
    try {
      // Prepend project context to requirement if a project is selected
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
      const res = await recommendSuppliers({
        requirement: fullReq,
        classificationId: classificationId || undefined,
        maxCount,
      });
      setResult(res);
      if (res.recommendations.length === 0) setError('未找到匹配的候选供应商，请调整需求描述或筛选条件');
    } catch (e: any) {
      setError(e?.message || '智能推荐失败，请稍后重试');
    }
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

  const toggleEnterpriseFilter = (type: string) => {
    setEnterpriseFilter(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  // ── Export ──
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
    try { await navigator.clipboard.writeText(buildExportText()); }
    catch { /* fallback */ }
  };
  const downloadList = () => {
    if (shortlist.size === 0) return;
    const blob = new Blob([buildExportText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `供应商候选名单_${new Date().toISOString().slice(0, 10)}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ──
  return (
    <div>
      <PageHero
        eyebrow="供应商管理中心" title="供应商智能选取"
        description="基于采购需求多维度分析，AI 从供应商库中智能匹配并推荐最优候选，支持项目关联、资质过滤、候选对比与结构化导出。"
        tone="green" icon={<Building2 size={14} />}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ═══ 左列：配置 + 结果 ═══ */}
        <div className="lg:col-span-2 space-y-5">

          {/* ── 1. 项目关联 ── */}
          <div className="bg-white rounded-2xl border border-[#e5ecf4] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Briefcase size={15} className="text-[#5a6d8a]" />
              <h2 className="font-bold text-[#18243a] text-sm">项目关联 <span className="text-xs font-normal text-[#5a6d8a]">（可选，用于丰富 AI 上下文）</span></h2>
            </div>
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]"
            >
              <option value="">不关联项目（仅基于需求文本分析）</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}（{p.projectCode} · {p.procurementMethod} · {p.stage}）</option>
              ))}
            </select>
            {selectedProject && projectDetail && (
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-[#5a6d8a]">
                <span className="rounded-md bg-[#f1f5f9] px-2 py-1">采购方式：{selectedProject.procurementMethod}</span>
                <span className="rounded-md bg-[#f1f5f9] px-2 py-1">阶段：{selectedProject.stage}</span>
                <span className="rounded-md bg-[#f1f5f9] px-2 py-1">已参与供应商：{projectDetail.suppliers?.length ?? 0} 家</span>
                {projectDetail.suppliers?.length > 0 && (
                  <span className="rounded-md bg-[#fef9c3] px-2 py-1 text-[#854d0e]">
                    已有：{projectDetail.suppliers.map(s => s.supplierName).join('、')}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ── 2. 采购需求 ── */}
          <div className="bg-white rounded-2xl border border-[#e5ecf4] p-5">
            <div className="flex items-center gap-2 mb-3">
              <Target size={15} className="text-[#064ea2]" />
              <h2 className="font-bold text-[#18243a] text-sm">采购需求描述 *</h2>
              <span className="text-xs text-[#5a6d8a]">描述越详细，AI 匹配越精准</span>
            </div>
            <textarea
              value={requirement}
              onChange={e => setRequirement(e.target.value)}
              placeholder={PROMPT_TEMPLATE}
              className="w-full px-3 py-2.5 border border-[#e5ecf4] rounded-lg text-sm h-40 resize-y focus:outline-none focus:border-[#064ea2] mb-3 font-mono text-xs leading-relaxed"
            />
            <div className="flex items-center justify-between">
              <button
                onClick={() => setRequirement(PROMPT_TEMPLATE)}
                className="text-xs text-[#064ea2] hover:underline"
              >
                填充结构化模板
              </button>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-xs text-[#5a6d8a]">
                  推荐数量
                  <select value={maxCount} onChange={e => setMaxCount(Number(e.target.value))}
                    className="px-2 py-1.5 border border-[#e5ecf4] rounded-lg text-xs focus:outline-none focus:border-[#064ea2]">
                    {[5, 8, 10, 15, 20].map(n => <option key={n} value={n}>{n} 家</option>)}
                  </select>
                </div>
                <button
                  onClick={run}
                  disabled={loading || !requirement.trim()}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-semibold text-white bg-[#064ea2] hover:bg-[#054280] rounded-lg disabled:opacity-50 transition"
                >
                  <Wand2 size={15} />{loading ? '智能匹配中...' : '智能推荐'}
                </button>
              </div>
            </div>
          </div>

          {/* ── 3. 高级筛选 ── */}
          <div className="bg-white rounded-2xl border border-[#e5ecf4] overflow-hidden">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-[#f8fafc] transition"
            >
              <div className="flex items-center gap-2">
                <Filter size={14} className="text-[#5a6d8a]" />
                <span className="font-bold text-[#18243a] text-sm">高级筛选</span>
                <span className="text-xs text-[#5a6d8a]">分类 · 企业类型 · 评分门槛</span>
              </div>
              {showAdvanced ? <ChevronUp size={16} className="text-[#5a6d8a]" /> : <ChevronDown size={16} className="text-[#5a6d8a]" />}
            </button>
            {showAdvanced && (
              <div className="px-5 pb-5 space-y-4 border-t border-[#e5ecf4] pt-4">
                {/* 供应商分类 */}
                <div>
                  <label className="block text-xs font-semibold text-[#18243a] mb-2">供应商分类</label>
                  <select
                    value={classificationId}
                    onChange={e => setClassificationId(e.target.value)}
                    className="w-full px-3 py-2 border border-[#e5ecf4] rounded-lg text-sm focus:outline-none focus:border-[#064ea2]"
                  >
                    <option value="">全部分类（AI 自动匹配）</option>
                    {classifications.map(c => <option key={c.id} value={c.id}>{c.name}（{c.code}）</option>)}
                  </select>
                </div>

                {/* 企业类型 */}
                <div>
                  <label className="block text-xs font-semibold text-[#18243a] mb-2">企业类型偏好（可多选）</label>
                  <div className="flex flex-wrap gap-2">
                    {ENTERPRISE_TYPES.map(t => (
                      <button
                        key={t}
                        onClick={() => toggleEnterpriseFilter(t)}
                        className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                          enterpriseFilter.includes(t)
                            ? 'border-[#064ea2] bg-[#eff6ff] text-[#064ea2] font-semibold'
                            : 'border-[#e5ecf4] text-[#5a6d8a] hover:border-[#bcd0e8]'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 评价门槛 */}
                <div>
                  <label className="block text-xs font-semibold text-[#18243a] mb-2">
                    最低历史评价分数：<span className="font-bold text-[#064ea2]">{minScore > 0 ? `≥ ${minScore} 分` : '不限'}</span>
                  </label>
                  <input
                    type="range" min={0} max={100} step={5} value={minScore}
                    onChange={e => setMinScore(Number(e.target.value))}
                    className="w-full accent-[#064ea2]"
                  />
                  <div className="flex justify-between text-[10px] text-[#5a6d8a]">
                    <span>不限</span><span>60 (C级)</span><span>80 (B级)</span><span>90 (A级)</span><span>100</span>
                  </div>
                </div>

                <p className="text-xs text-[#5a6d8a] bg-[#f8fafc] rounded-lg p-2.5">
                  当前筛选条件用于缩小 AI 候选池范围。企业类型偏好和评分门槛会作为 AI 排序的参考因素。
                </p>
              </div>
            )}
          </div>

          {/* ── Error ── */}
          {error && (
            <div className="rounded-xl border border-[#fca5a5] bg-[#fef2f2] px-4 py-3 text-sm text-[#c0392b]">{error}</div>
          )}

          {/* ── Loading ── */}
          {loading && (
            <div className="bg-white rounded-2xl border border-[#e5ecf4] p-10 text-center">
              <div className="inline-flex items-center gap-2 text-[#064ea2] font-semibold">
                <span className="h-2 w-2 rounded-full bg-[#064ea2] animate-pulse" />
                AI 正在分析采购需求，从供应商库中匹配候选……
              </div>
              <p className="text-xs text-[#5a6d8a] mt-3 leading-relaxed max-w-md mx-auto">
                分析维度：需求关键词提取→候选池粗筛→资质与能力评分→综合排序
              </p>
            </div>
          )}

          {/* ── 4. 推荐结果 ── */}
          {result && !loading && (
            <div className="space-y-4">
              {/* 分析摘要 */}
              <div className="rounded-2xl border border-[#e5ecf4] bg-white p-5">
                <div className="flex items-center gap-2 mb-3">
                  <FileSearch size={16} className="text-[#064ea2]" />
                  <h2 className="font-bold text-[#18243a] text-sm">智能分析摘要</h2>
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-semibold ${
                    result.engine === 'deepseek' ? 'bg-[#ede9fe] text-[#7c3aed]' : 'bg-[#f1f5f9] text-[#5a6d8a]'
                  }`}>
                    {result.engine === 'deepseek' ? `AI · ${result.model}` : '规则引擎'}
                  </span>
                </div>
                <p className="text-sm text-[#5a6d8a] leading-relaxed">{result.summary}</p>
                <div className="flex gap-4 mt-3 text-xs text-[#5a6d8a]">
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#064ea2]" />候选池 {result.candidatePool} 家</span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#11a874]" />推荐 {result.recommendations.length} 家</span>
                </div>
              </div>

              {/* 推荐列表 */}
              {result.recommendations.map((r, idx) => {
                const inList = shortlist.has(r.supplierId);
                const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
                return (
                  <div key={r.supplierId} className={`rounded-2xl border bg-white p-4 transition ${inList ? 'border-[#11a874] ring-1 ring-[#11a874]/20' : 'border-[#e5ecf4]'}`}>
                    <div className="flex items-start gap-3">
                      {/* 排名序号 */}
                      <div className="flex-shrink-0 h-9 w-9 rounded-full bg-[#064ea2] text-white flex items-center justify-center text-sm font-bold">
                        {idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        {/* 名称 + 标签 */}
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span
                            className="font-bold text-[#18243a] cursor-pointer hover:text-[#064ea2] transition"
                            onClick={() => router.push(`/supplier/${r.supplierId}`)}
                          >
                            {r.name}
                          </span>
                          {r.classification && (
                            <span className="text-xs text-[#064ea2] bg-[#eff6ff] rounded-full px-2 py-0.5 font-medium">{r.classification}</span>
                          )}
                          {r.enterpriseType && (
                            <span className="text-xs text-[#5a6d8a] bg-[#f1f5f9] rounded-full px-2 py-0.5">{r.enterpriseType}</span>
                          )}
                          {inList && (
                            <span className="text-xs text-[#11a874] bg-[#ecfdf5] rounded-full px-2 py-0.5 font-semibold">已入选</span>
                          )}
                        </div>

                        {/* 匹配度条 */}
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex-1 h-2 rounded-full bg-[#f1f5f9] overflow-hidden max-w-[280px]">
                            <div className="h-full rounded-full transition-all duration-700" style={{
                              width: `${r.matchScore}%`,
                              backgroundColor: scoreColor(r.matchScore),
                            }} />
                          </div>
                          <strong className="text-sm min-w-[2rem] text-right" style={{ color: scoreColor(r.matchScore) }}>
                            {r.matchScore}
                          </strong>
                          <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{
                            color: scoreColor(r.matchScore),
                            backgroundColor: scoreColor(r.matchScore) + '18',
                          }}>
                            {scoreLabel(r.matchScore)}
                          </span>
                        </div>

                        {/* 推荐理由 */}
                        <p className="text-sm text-[#5a6d8a] leading-relaxed">{r.reason}</p>

                        {/* 联系信息 */}
                        {contact && (
                          <p className="text-xs text-[#5a6d8a] mt-1.5">
                            联系人：{contact.name}{contact.phone ? ` · ${contact.phone}` : ''}
                            {r.legalPerson ? ` ｜ 法定代表人：${r.legalPerson}` : ''}
                          </p>
                        )}
                      </div>

                      {/* 操作按钮组 */}
                      <div className="flex flex-col gap-2 flex-shrink-0">
                        <button
                          onClick={() => router.push(`/supplier/${r.supplierId}`)}
                          className="px-3 py-1.5 text-xs text-[#064ea2] border border-[#e5ecf4] rounded-lg hover:bg-[#f0f6ff] transition"
                        >
                          详情
                        </button>
                        <button
                          onClick={() => toggleShortlist(r)}
                          className={`inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs rounded-lg font-medium transition ${
                            inList
                              ? 'text-white bg-[#11a874] hover:bg-[#0e8c5f]'
                              : 'text-[#064ea2] border border-[#e5ecf4] hover:bg-[#f0f6ff]'
                          }`}
                        >
                          {inList ? <><X size={12} />移除</> : <><Plus size={12} />加入候选</>}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ═══ 右列：候选名单 ═══ */}
        <div className="lg:col-span-1">
          <div className="bg-white rounded-2xl border border-[#e5ecf4] p-5 sticky top-20">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Award size={15} className="text-[#064ea2]" />
                <h2 className="font-bold text-[#18243a] text-sm">
                  候选名单
                  <span className="ml-1.5 text-xs font-normal text-[#5a6d8a]">({shortlist.size})</span>
                </h2>
              </div>
              {shortlist.size > 0 && (
                <div className="flex gap-1">
                  <button onClick={copyList} title="复制名单" className="p-1.5 text-[#5a6d8a] hover:text-[#064ea2] hover:bg-[#f0f6ff] rounded-lg transition">
                    <Copy size={14} />
                  </button>
                  <button onClick={downloadList} title="导出名单" className="p-1.5 text-[#5a6d8a] hover:text-[#064ea2] hover:bg-[#f0f6ff] rounded-lg transition">
                    <Download size={14} />
                  </button>
                </div>
              )}
            </div>

            {shortlist.size === 0 ? (
              <div className="py-10 text-center">
                <Zap size={28} className="mx-auto text-[#d4d8e0] mb-3" />
                <p className="text-sm text-[#5a6d8a] leading-relaxed">
                  点击推荐结果中的<br />
                  <span className="text-[#064ea2] font-semibold">「加入候选」</span> 构建邀请名单
                </p>
                <p className="text-xs text-[#a1a1aa] mt-1.5">支持拖拽排序、添加备注、导出名单</p>
              </div>
            ) : (
              <div className="space-y-2">
                {[...shortlist.entries()].map(([sid, { item: r, note }], idx) => {
                  const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
                  const total = shortlist.size;
                  return (
                    <div key={sid} className="rounded-lg border border-[#e5ecf4] p-2.5 group">
                      <div className="flex items-center gap-2">
                        {/* 拖拽排序 */}
                        <div className="flex flex-col gap-0.5 flex-shrink-0">
                          <button
                            onClick={() => moveShortlistItem(idx, idx - 1)}
                            disabled={idx === 0}
                            className="text-[#d4d8e0] hover:text-[#5a6d8a] disabled:opacity-30 transition"
                          >
                            <ChevronUp size={10} />
                          </button>
                          <button
                            onClick={() => moveShortlistItem(idx, idx + 1)}
                            disabled={idx === total - 1}
                            className="text-[#d4d8e0] hover:text-[#5a6d8a] disabled:opacity-30 transition"
                          >
                            <ChevronDown size={10} />
                          </button>
                        </div>
                        {/* 优先级序号 */}
                        <span className="flex-shrink-0 h-5 w-5 rounded-md bg-[#064ea2] text-white flex items-center justify-center text-[10px] font-bold">
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-[#18243a] truncate">{r.name}</span>
                            <button
                              onClick={() => toggleShortlist(r)}
                              className="text-[#d4d8e0] hover:text-[#e74c3c] flex-shrink-0 ml-1 opacity-0 group-hover:opacity-100 transition"
                            >
                              <X size={13} />
                            </button>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-bold" style={{ color: scoreColor(r.matchScore) }}>
                              {r.matchScore}
                            </span>
                            {contact && <span className="text-[10px] text-[#5a6d8a] truncate">{contact.name} · {contact.phone}</span>}
                          </div>
                        </div>
                      </div>
                      {/* 备注 */}
                      <input
                        value={note}
                        onChange={e => updateNote(sid, e.target.value)}
                        placeholder="添加备注（如：优先邀请、需核实资质）"
                        className="w-full mt-2 px-2 py-1 text-[11px] border border-[#e5ecf4] rounded-md focus:outline-none focus:border-[#064ea2] bg-[#fafbfc]"
                      />
                    </div>
                  );
                })}
                <button
                  onClick={() => setShortlist(new Map())}
                  className="w-full mt-2 text-xs text-[#5a6d8a] hover:text-[#e74c3c] py-1.5 rounded-lg hover:bg-[#fef2f2] transition"
                >
                  清空名单
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
