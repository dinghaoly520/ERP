'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { recommendSuppliers, getClassifications, polishRequirement, inviteSuppliers, shareShortlist, updateSelectionShortlist } from '@/lib/api/supplier';
import type { SupplierRecommendation, SupplierSelectionResult } from '@/lib/api/supplier';
import type { SupplierSelectionHistoryRecord } from '@/lib/api/supplier';
import type { SupplierClassification } from '@/lib/types';
import { listBidProjects, getBidProjectDetail, type BidProjectOption, type BidProjectDetail } from '@/lib/api/expert';
import { Wand2, Copy, Download, X, Plus, FileSearch, ChevronDown, ChevronUp, Award, Zap, Building2, RefreshCw, Sparkles, Clock3, Columns3, FileSpreadsheet, Send, Share2, ListPlus } from 'lucide-react';
import { StatusBadge } from '@/components/workbench';
import { RulesPopover } from '@/components/rules-popover';
import { SelectionHistoryDialog } from '@/components/supplier/selection-history-dialog';
import { ComparePanel } from '@/components/supplier/compare-panel';
import { exportShortlistToExcel } from '@/lib/excel-export';

const scoreVar = (s: number): string => (s >= 85 ? 'var(--success)' : s >= 70 ? 'var(--accent)' : s >= 55 ? 'var(--warning)' : 'var(--danger)');
const scoreLabel = (s: number) => (s >= 85 ? '强匹配' : s >= 70 ? '较匹配' : s >= 55 ? '可考虑' : '弱匹配');

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
  const [maxCount, setMaxCount] = useState(10);
  const [loading, setLoading] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [savedHistoryId, setSavedHistoryId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SupplierSelectionResult | null>(null);
  const [shortlist, setShortlist] = useState<Map<string, { item: SupplierRecommendation; note: string }>>(new Map());

  useEffect(() => { getClassifications().then(setClassifications).catch(() => {}); listBidProjects().then(setProjects).catch(() => {}); }, []);
  useEffect(() => { if (!projectId) { setProjectDetail(null); return; } getBidProjectDetail(projectId).then(setProjectDetail).catch(() => setProjectDetail(null)); }, [projectId]);
  const selectedProject = useMemo(() => projects.find(p => p.id === projectId), [projects, projectId]);

  const run = async () => {
    if (!requirement.trim()) { setError('请先描述采购需求'); return; }
    setError(''); setLoading(true); setResult(null);
    try {
      let fullReq = requirement.trim();
      if (selectedProject && projectDetail) {
        const ctx = [`关联项目：${selectedProject.name}（${selectedProject.projectCode}）`,`采购方式：${selectedProject.procurementMethod}`,`项目阶段：${selectedProject.stage}`,projectDetail.suppliers?.length ? `已有参与供应商：${projectDetail.suppliers.map(s => s.supplierName).join('、')}` : ''].filter(Boolean).join('；');
        fullReq = `${ctx}\n${fullReq}`;
      }
      const res = await recommendSuppliers({ requirement: fullReq, classificationId: classificationId || undefined, maxCount });
      setResult(res);
      setShortlist(new Map());
      if (res.recommendations.length === 0) setError('未找到匹配的候选供应商，请调整需求描述或筛选条件');
      // Capture history ID for later shortlist save
      const { getSelectionHistory } = await import('@/lib/api/supplier');
      const history = await getSelectionHistory().catch(() => []);
      if (history.length > 0) setSavedHistoryId(history[0].id);
    } catch (e: any) { toast.error(e?.message || '智能推荐失败'); }
    setLoading(false);
  };

  const polish = async () => {
    if (!requirement.trim()) { toast.error('请先填写采购需求'); return; }
    setPolishing(true);
    try {
      const res = await polishRequirement({ text: requirement.trim() });
      setRequirement(res.polished);
      toast.success('需求已润色');
    } catch (e: any) { toast.error(e?.message || '润色失败'); }
    setPolishing(false);
  };

  const handleApplyHistory = (record: SupplierSelectionHistoryRecord) => {
    setRequirement(record.requirement);
    if (record.classificationId) setClassificationId(record.classificationId);
    setShowHistory(false);
    toast.success('已恢复选取记录');
  };

  const handleApplyHistoryShortlist = (record: SupplierSelectionHistoryRecord, items: SupplierRecommendation[]) => {
    handleApplyHistory(record);
    const newMap = new Map<string, { item: SupplierRecommendation; note: string }>();
    items.forEach((item) => newMap.set(item.supplierId, { item, note: '' }));
    setShortlist(newMap);
    toast.success(`已恢复 ${items.length} 家候选供应商`);
  };

  const handleInvite = async () => {
    if (!projectId) { toast.error('请先关联项目'); return; }
    setInviting(true);
    try {
      const ids = [...shortlist.keys()];
      const res = await inviteSuppliers(projectId, ids);
      if (res.skipped > 0) toast.warning(`已添加 ${res.added} 家，跳过 ${res.skipped} 家（已在项目中）`);
      else toast.success(`已发送 ${res.added} 家供应商邀请`);
      setShortlist(new Map());
    } catch (e: any) { toast.error(e?.message || '邀请失败'); }
    setInviting(false);
  };

  const handleShare = async () => {
    const shortlistData = [...shortlist.values()].map(({ item: r, note }) => ({ name: r.name, matchScore: r.matchScore, reason: r.reason }));
    const note = prompt('分享备注（可选）：');
    if (note === null) return;
    try {
      await shareShortlist({ requirement: requirement.trim(), shortlist: shortlistData, note: note || undefined });
      toast.success('候选名单已分享');
    } catch (e: any) { toast.error(e?.message || '分享失败'); }
  };

  const handleBatchAdd = (count?: number) => {
    if (!result) return;
    const merge = new Map(shortlist);
    const toAdd = count ? result.recommendations.slice(0, count) : result.recommendations;
    toAdd.forEach((r) => { if (!merge.has(r.supplierId)) merge.set(r.supplierId, { item: r, note: '' }); });
    setShortlist(merge);
    toast.success(`已加入 ${merge.size} 家候选`);
  };

  const saveShortlistToHistory = async () => {
    if (!savedHistoryId) return;
    await updateSelectionShortlist(savedHistoryId, [...shortlist.keys()]).catch(() => {});
  };

  const toggleShortlist = (r: SupplierRecommendation) => {
    setShortlist(prev => { const n = new Map(prev); n.has(r.supplierId) ? n.delete(r.supplierId) : n.set(r.supplierId, { item: r, note: '' }); return n; });
  };
  const toggleShortlistAndSave = (r: SupplierRecommendation) => {
    toggleShortlist(r);
    setTimeout(() => saveShortlistToHistory(), 100);
  };
  const updateNote = (supplierId: string, note: string) => {
    setShortlist(prev => { const n = new Map(prev); const e = n.get(supplierId); if (e) n.set(supplierId, { ...e, note }); return n; });
  };
  const moveShortlistItem = (from: number, to: number) => {
    const entries = [...shortlist.entries()]; if (to < 0 || to >= entries.length) return;
    const [moved] = entries.splice(from, 1); entries.splice(to, 0, moved); setShortlist(new Map(entries));
  };
  const buildExportText = () => [...shortlist.entries()].map(([_, { item: r, note }], i) => {
    const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
    return [`${i + 1}. ${r.name}`,`   分类：${r.classification || '—'}  企业类型：${r.enterpriseType || '—'}`,`   匹配度：${r.matchScore}  ${r.reason}`,contact ? `   联系人：${contact.name} ${contact.phone}` : '',note ? `   备注：${note}` : ''].filter(Boolean).join('\n');
  }).join('\n\n');
  const copyList = async () => { if (shortlist.size === 0) return; try { await navigator.clipboard.writeText(buildExportText()); toast.success('已复制到剪贴板'); } catch { toast.error('复制失败'); } };
  const downloadList = () => { if (shortlist.size === 0) return; const blob = new Blob([buildExportText()], { type: 'text/plain;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `供应商候选名单_${new Date().toISOString().slice(0, 10)}.txt`; a.click(); URL.revokeObjectURL(url); };

  const inputCard = (
    <div className="neu-table-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="neu-icon-well flex h-8 w-8 items-center justify-center rounded-[10px]"><Wand2 size={14} className="text-[var(--accent)]" /></div>
        <div><span className="text-sm font-bold text-[var(--foreground)]">需求配置</span><span className="ml-2 text-xs text-[var(--muted-foreground)]">描述采购需求，关联项目，配置 AI 匹配参数</span></div>
      </div>

      {/* ── 前置筛选 —— */}
      <div>
        <div className="flex items-center gap-2.5 mb-4">
          <span className="flex h-[7px] w-[7px] flex-shrink-0 rounded-full bg-[var(--foreground)]/50" />
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--foreground)]/70">筛选范围</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[11px] font-semibold text-[var(--muted-foreground)] block mb-1.5">项目关联</label>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className="neu-input text-sm w-full">
              <option value="">不关联项目</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}（{p.projectCode}）</option>)}
            </select>
            {selectedProject && projectDetail && (
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                <span className="rounded-md bg-[var(--surface)] px-2 py-0.5 text-[var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">{selectedProject.procurementMethod}</span>
                <span className="rounded-md bg-[var(--surface)] px-2 py-0.5 text-[var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">{selectedProject.stage}</span>
                {projectDetail.suppliers?.length > 0 && (
                  <span className="w-full rounded-md bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-2.5 py-1 text-xs text-[var(--warning)]">已有参与：{projectDetail.suppliers.map(s => s.supplierName).join('、')}</span>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="text-[11px] font-semibold text-[var(--muted-foreground)] block mb-1.5">供应商分类</label>
            <select value={classificationId} onChange={e => setClassificationId(e.target.value)} className="neu-input text-sm w-full">
              <option value="">全部分类</option>
              {classifications.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <p className="mt-2.5 text-[11px] text-[var(--muted-foreground)]/50 leading-relaxed">指定分类后 AI 将在该分类范围内进行语义匹配与排序，精准限定可显著提升推荐质量</p>
      </div>

      <hr className="wb-section-rule" />

      <div>
        <label className="text-xs font-semibold text-[var(--muted-foreground)] block mb-1.5">采购需求描述 *</label>
        <textarea value={requirement} onChange={e => setRequirement(e.target.value)} placeholder={PROMPT_TEMPLATE} className="neu-input w-full !min-h-[260px] resize-y font-mono text-xs leading-relaxed" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setRequirement(PROMPT_TEMPLATE)} className="neu-btn-xs text-[11px] gap-1.5" disabled={polishing || loading}>填充模板</button>
          <button onClick={polish} disabled={polishing || !requirement.trim()} className="neu-btn-xs text-[11px] gap-1.5">
            <Sparkles size={11} />{polishing ? '润色中...' : 'AI 润色'}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">推荐数量 <select value={maxCount} onChange={e => setMaxCount(Number(e.target.value))} className="workbench-input text-xs py-1.5 !h-auto">{[5,8,10,15,20].map(n => <option key={n} value={n}>{n} 家</option>)}</select></div>
          <button onClick={run} disabled={loading || !requirement.trim()} className="neu-btn-soft"><Wand2 size={15} />{loading ? '智能匹配中...' : '智能推荐'}</button>
        </div>
      </div>
    </div>
  );

  const shortlistPanel = (
    <div className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2"><Award size={15} className="text-[var(--accent)]" /><h2 className="text-sm font-bold text-[var(--foreground)]">候选名单 <span className="text-xs font-normal text-[var(--muted-foreground)]">({shortlist.size})</span></h2></div>
        {shortlist.size > 0 && (
          <div className="flex gap-1 flex-wrap">
            <button onClick={copyList} title="复制名单" className="neu-btn-xs"><Copy size={12} /></button>
            <button onClick={downloadList} title="导出 TXT" className="neu-btn-xs"><Download size={12} /></button>
            <button onClick={() => exportShortlistToExcel([...shortlist.values()], selectedProject?.name)} title="导出 Excel" className="neu-btn-xs"><FileSpreadsheet size={12} /></button>
          </div>
        )}
      </div>
      {shortlist.size === 0 ? (
        <div className="py-8 text-center">
          <Zap size={28} className="mx-auto text-[var(--muted-foreground)]/40 mb-3" />
          <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">点击推荐结果中的<br /><span className="font-semibold text-[var(--accent)]">「加入候选」</span> 构建邀请名单</p>
        </div>
      ) : (
        <div className="space-y-2">
          {[...shortlist.entries()].map(([sid, { item: r, note }], idx) => {
            const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
            return (
              <div key={sid} className="kpi-card flex flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col gap-0.5 flex-shrink-0">
                    <button onClick={() => moveShortlistItem(idx, idx - 1)} disabled={idx === 0} className="text-[var(--muted-foreground)]/40 hover:text-[var(--muted-foreground)] disabled:opacity-20 transition"><ChevronUp size={10} /></button>
                    <button onClick={() => moveShortlistItem(idx, idx + 1)} disabled={idx === shortlist.size - 1} className="text-[var(--muted-foreground)]/40 hover:text-[var(--muted-foreground)] disabled:opacity-20 transition"><ChevronDown size={10} /></button>
                  </div>
                  <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-[var(--accent)] text-[10px] font-extrabold text-white">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-[var(--foreground)] truncate">{r.name}</span>
                      <button onClick={() => toggleShortlist(r)} className="ml-1 flex-shrink-0 text-[var(--muted-foreground)]/30 hover:text-[var(--danger)] opacity-0 group-hover:opacity-100 transition"><X size={13} /></button>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-[10px] font-bold" style={{ color: scoreVar(r.matchScore) }}>{r.matchScore}</span>
                      {contact && <span className="text-[10px] text-[var(--muted-foreground)] truncate">{contact.name} · {contact.phone}</span>}
                    </div>
                  </div>
                </div>
                <input value={note} onChange={e => updateNote(sid, e.target.value)} placeholder="添加备注" className="neu-input w-full !h-7 !text-[11px] !px-2 !py-0" />
              </div>
            );
          })}
          <div className="space-y-2">
            <div className="flex gap-1.5">
              <button onClick={() => setShowCompare(true)} disabled={shortlist.size < 2} className="neu-btn-xs flex-1" title="横向对比至少需要 2 家供应商"><Columns3 size={12} />对比</button>
              <button onClick={handleShare} className="neu-btn-xs flex-1" title="分享给采购主管"><Share2 size={12} />分享</button>
            </div>
            <div className="flex gap-1.5">
              {projectId && (
                <button onClick={handleInvite} disabled={inviting} className="neu-btn-xs flex-1">
                  <Send size={12} />{inviting ? '发送中...' : '发送邀请'}
                </button>
              )}
              <button onClick={() => setShortlist(new Map())} className="neu-btn-xs is-danger flex-1">清空名单</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Building2 size={17} /></div>
            <div>
              <div className="page-hero__title">供应商智能选取</div>
              <div className="page-hero__sub">基于采购需求多维度分析，AI 从供应商库中智能匹配并推荐最优候选</div>
            </div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => setShowHistory(true)} className="neu-btn-xs gap-1.5">
              <Clock3 size={13} />选取历史
            </button>
            <RulesPopover accentColor="var(--success)">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-3">供应商 AI 匹配规则</h3>
              <ol className="space-y-2 text-xs text-[var(--muted-foreground)] leading-relaxed">
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--success)]">1.</span>需求关键词提取：从采购需求描述中提取项目类型、资质要求、技术参数等关键维度</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--success)]">2.</span>候选池粗筛：按供应商分类、企业类型、历史评价分数进行合规过滤</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--success)]">3.</span>资质与能力评分：综合资质匹配度、历史履约评价、经营范围与项目契合度，形成 0-100 匹配分</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--success)]">4.</span>综合排序：按匹配度降序输出推荐列表，≥85 强匹配 / ≥70 较匹配 / ≥55 可考虑 / 弱匹配</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--success)]">5.</span>候选管理：支持加入/移除候选名单，拖拽排序，添加备注，导出为 TXT 名单</li>
              </ol>
            </RulesPopover>
          </div>
        </div>
      </div>

      {result !== null && !loading ? (
        <div className={`grid grid-cols-1 gap-5 items-start ${shortlist.size > 0 ? 'lg:grid-cols-3' : ''}`}>
          <div className={`space-y-4 ${shortlist.size > 0 ? 'lg:col-span-2' : ''}`}>
            {inputCard}

            {error && <div className="rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">{error}</div>}

            <div className="neu-table-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <FileSearch size={16} className="text-[var(--accent)]" />
                <h2 className="text-sm font-bold text-[var(--foreground)]">智能分析摘要</h2>
                <StatusBadge tone={result.engine === 'deepseek' ? 'purple' : 'gray'} className="ml-auto">{result.engine === 'deepseek' ? `AI · ${result.model}` : '规则引擎'}</StatusBadge>
              </div>
              <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">{result.summary}</p>
              <div className="flex gap-4 mt-3 text-xs text-[var(--muted-foreground)]">
                <span>候选池 <strong className="text-[var(--foreground)]">{result.candidatePool}</strong> 家</span>
                <span>推荐 <strong className="text-[var(--foreground)]">{result.recommendations.length}</strong> 家</span>
              </div>
            </div>

            {/* Batch toolbar */}
            <div className="wb-toolbar !px-3 !py-2">
              <button onClick={() => handleBatchAdd()} className="neu-btn-xs gap-1">
                <ListPlus size={12} />全部加入候选
              </button>
              <span className="text-[10px] text-[var(--muted-foreground)]/70">或加入前</span>
              {[3, 5, 8, 10].map(n => (
                <button key={n} onClick={() => handleBatchAdd(n)} className="neu-tab text-[11px] !px-2.5 !py-1">{n} 名</button>
              ))}
            </div>

            {result.recommendations.map((r, idx) => {
              const inList = shortlist.has(r.supplierId);
              const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
              return (
                <div key={r.supplierId} className={`neu-table-card p-4 ${inList ? 'ring-2 ring-[var(--success)]/30' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-extrabold text-white">{idx + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <span className="text-sm font-bold text-[var(--foreground)] cursor-pointer hover:text-[var(--accent)] transition" onClick={() => router.push(`/supplier/${r.supplierId}`)}>{r.name}</span>
                        {r.classification && <StatusBadge tone="blue">{r.classification}</StatusBadge>}
                        {r.enterpriseType && <span className="neu-tab-count">{r.enterpriseType}</span>}
                        {r.evaluation && (
                          <span
                            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold text-white"
                            style={{ backgroundColor: r.evaluation.level === 'A' ? 'var(--success)' : r.evaluation.level === 'B' ? 'var(--accent)' : r.evaluation.level === 'C' ? 'var(--warning)' : 'var(--danger)' }}
                            title={`${r.evaluation.avgScore}分 · ${r.evaluation.count}次评价`}
                          >
                            {r.evaluation.level}
                          </span>
                        )}
                        {inList && <StatusBadge tone="green">已入选</StatusBadge>}
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="flex-1 h-2 rounded-full bg-[var(--muted)]/50 overflow-hidden max-w-[280px]"><div className="h-full rounded-full transition-all duration-700" style={{ width: `${r.matchScore}%`, backgroundColor: scoreVar(r.matchScore) }} /></div>
                        <strong className="text-sm tabular-nums min-w-[2rem] text-right" style={{ color: scoreVar(r.matchScore) }}>{r.matchScore}</strong>
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ color: scoreVar(r.matchScore), backgroundColor: `color-mix(in oklch, ${scoreVar(r.matchScore)} 14%, transparent)` }}>{scoreLabel(r.matchScore)}</span>
                      </div>
                      <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">{r.reason}</p>
                      {contact && <p className="mt-1.5 text-xs text-[var(--muted-foreground)] inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>联系人：{contact.name}{contact.phone ? ` · ${contact.phone}` : ''}{r.legalPerson ? ` ｜ 法定代表人：${r.legalPerson}` : ''}</span>
                        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${r.activeProjects >= 5 ? 'bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] text-[var(--danger)]' : r.activeProjects > 0 ? 'bg-[color-mix(in_oklch,var(--foreground)_6%,transparent)] text-[var(--muted-foreground)]' : 'bg-[color-mix(in_oklch,var(--success)_8%,transparent)] text-[var(--success)]'}`}>
                          {r.activeProjects >= 5 ? '繁忙' : r.activeProjects > 0 ? '正常' : '空闲'} · {r.activeProjects} 项目
                        </span>
                      </p>}
                    </div>
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <button onClick={() => router.push(`/supplier/${r.supplierId}`)} className="neu-btn-xs">详情</button>
                      <button onClick={() => toggleShortlist(r)} className={`neu-btn-xs ${inList ? 'is-success' : ''}`}>{inList ? <><X size={12} />移除</> : <><Plus size={12} />加入候选</>}</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {shortlist.size > 0 && <div className="lg:col-span-1">{shortlistPanel}</div>}
        </div>
      ) : (
        <div>
          {inputCard}
          {error && <div className="mt-4 rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">{error}</div>}
          {loading && (
            <div className="mt-4 neu-table-card py-14 text-center">
              <div className="inline-flex items-center gap-2 text-sm font-bold text-[var(--accent)]">
                <RefreshCw size={14} className="animate-spin" />AI 正在分析采购需求，从供应商库中匹配候选...
              </div>
              <p className="mt-3 text-xs text-[var(--muted-foreground)] max-w-md mx-auto leading-relaxed">分析维度：需求关键词提取 → 候选池粗筛 → 资质与能力评分 → 综合排序</p>
            </div>
          )}
        </div>
      )}

      <SelectionHistoryDialog
        isOpen={showHistory}
        onApply={handleApplyHistory}
        onApplyShortlist={handleApplyHistoryShortlist}
        onClose={() => setShowHistory(false)}
      />

      <ComparePanel
        isOpen={showCompare}
        candidates={[...shortlist.values()].map((v) => v.item)}
        onClose={() => setShowCompare(false)}
      />
    </div>
  );
}
