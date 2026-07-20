'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { recommendSuppliers, getClassifications, polishRequirement, inviteSuppliers, shareShortlist, updateSelectionShortlist, notifySuppliers, generateNotificationContent } from '@/lib/api/supplier';
import { normalizeEnterpriseType } from '@/lib/utils/enterprise-type';
import type { SupplierRecommendation, SupplierSelectionResult } from '@/lib/api/supplier';
import type { SupplierSelectionHistoryRecord } from '@/lib/api/supplier';
import type { SupplierClassification } from '@/lib/types';
import { listBidProjects, getBidProjectDetail, type BidProjectOption, type BidProjectDetail } from '@/lib/api/expert';
import { Wand2, Copy, Download, X, Plus, FileSearch, ChevronDown, ChevronUp, Award, Zap, Building2, RefreshCw, Sparkles, Clock3, Columns3, FileSpreadsheet, Send, Share2, ListPlus, Bell, MessageSquare, ShieldCheck, Check } from 'lucide-react';
import { Modal } from '@/components/workbench';
import { StatusBadge } from '@/components/workbench';
import { RulesPopover } from '@/components/rules-popover';
import { SelectionHistoryDialog } from '@/components/supplier/selection-history-dialog';
import { ComparePanel } from '@/components/supplier/compare-panel';
import { exportShortlistToExcel } from '@/lib/excel-export';

const scoreVar = (s: number): string => (s >= 85 ? 'var(--success)' : s >= 70 ? 'var(--accent)' : s >= 55 ? 'var(--warning)' : 'var(--danger)');
const scoreLabel = (s: number) => (s >= 85 ? '强匹配' : s >= 70 ? '较匹配' : s >= 55 ? '可考虑' : '弱匹配');

const STAGE_LABELS: Record<string, string> = {
  DOWNLOAD: '下载标书', SUBMIT: '投标提交', OPENING: '开标中', EVALUATING: '评标中', ARCHIVED: '已归档',
};
const METHOD_LABELS: Record<string, string> = {
  '公开招标': '公开招标', '邀请招标': '邀请招标', '竞争性谈判': '竞争性谈判', '竞争性磋商': '竞争性磋商', '询价': '询价', '单一来源': '单一来源',
};

const PROMPT_TEMPLATE = `【项目概况】
（描述项目名称、建设地点、规模、投资概算）

【采购范围】
（本次采购的具体范围和工作内容）

【资质要求】
（需要供应商具备的资质，如：建筑工程施工总承包一级、水利行业甲级等）

【特殊要求】
（工期要求、质量等级、环保要求、业绩门槛等）`;

// 向导步骤定义
const STEPS = [
  { num: 1, label: '选择项目', desc: '关联采购项目与供应商分类' },
  { num: 2, label: '描述需求', desc: '撰写采购需求，AI 润色优化' },
  { num: 3, label: '审核候选', desc: '查看 AI 推荐，构建候选名单' },
  { num: 4, label: '确认通知', desc: '发送通知 / 邀请 / 分享名单' },
] as const;

export function SupplierSelectionPage({
  hideHeader,
  defaultProjectTitle,
}: {
  hideHeader?: boolean;
  defaultProjectTitle?: string;
}) {
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
  const [shareModal, setShareModal] = useState(false);
  const [shareNote, setShareNote] = useState('');
  const [shareSending, setShareSending] = useState(false);
  const [notifyModal, setNotifyModal] = useState(false);
  const [notifyTemplate, setNotifyTemplate] = useState({ title: '', body: '' });
  const [notifyChannels, setNotifyChannels] = useState<string[]>(['in_app']);
  const [notifyAiLoading, setNotifyAiLoading] = useState(false);
  const [notifySending, setNotifySending] = useState(false);
  const [notifyActiveSupplier, setNotifyActiveSupplier] = useState<string>('');
  // 逐供应商个性化消息（key=sid, value={title,body}）。缺失时回退到模板。
  const [notifyPerSupplier, setNotifyPerSupplier] = useState<Map<string, { title: string; body: string }>>(new Map());
  const [error, setError] = useState('');
  const [result, setResult] = useState<SupplierSelectionResult | null>(null);
  const [shortlist, setShortlist] = useState<Map<string, { item: SupplierRecommendation; note: string }>>(new Map());
  const [step, setStep] = useState(1); // 向导步骤：1=选择项目 2=描述需求 3=审核候选 4=确认通知
  const [notified, setNotified] = useState(false); // 第 4 步：是否已完成通知发送

  useEffect(() => { getClassifications().then(setClassifications).catch(() => {}); listBidProjects().then(setProjects).catch(() => {}); }, []);

  // 恢复上次会话状态（从详情页返回时不丢失已输入的需求和筛选条件）
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = sessionStorage.getItem('supplier-selection-state');
      if (saved) {
        const state = JSON.parse(saved);
        if (state.requirement) setRequirement(state.requirement);
        if (state.classificationId) setClassificationId(state.classificationId);
        if (state.projectId) setProjectId(state.projectId);
        if (state.maxCount) setMaxCount(state.maxCount);
        if (state.result) setResult(state.result);
        if (state.step) setStep(state.step);
        if (state.shortlistArr) {
          const m = new Map<string, { item: SupplierRecommendation; note: string }>();
          (state.shortlistArr as [string, any][]).forEach(([k, v]) => m.set(k, v));
          setShortlist(m);
        }
      }
    } catch {}
  }, []);

  // 输入状态变化时持久化到 sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem('supplier-selection-state', JSON.stringify({
        requirement, classificationId, projectId, maxCount, step,
        result: result ? { ...result, recommendations: result.recommendations.slice(0, 20) } : null,
        shortlistArr: [...shortlist.entries()],
      }));
    } catch {}
  }, [requirement, classificationId, projectId, maxCount, step, result, shortlist]);
  useEffect(() => { if (!projectId) { setProjectDetail(null); return; } getBidProjectDetail(projectId).then(setProjectDetail).catch(() => setProjectDetail(null)); }, [projectId]);
  const selectedProject = useMemo(() => projects.find(p => p.id === projectId), [projects, projectId]);

  // 模态入口：按项目标题自动匹配并跳到第 2 步（需求描述）
  const autoMatchedRef = useRef(false);
  useEffect(() => {
    if (!defaultProjectTitle || !projects.length || autoMatchedRef.current) return;
    const match = projects.find(p => p.name === defaultProjectTitle || p.name.includes(defaultProjectTitle) || defaultProjectTitle.includes(p.name));
    if (!match) return;
    autoMatchedRef.current = true;
    setProjectId(match.id);
    setStep(2);
  }, [defaultProjectTitle, projects]);

  const run = async () => {
    if (!requirement.trim()) { setError('请先描述采购需求'); return; }
    setError(''); setLoading(true); setResult(null);
    try {
      let fullReq = requirement.trim();
      if (selectedProject && projectDetail) {
        const ctx = [`关联项目：${selectedProject.name}（${selectedProject.projectCode}）`,`采购方式：${METHOD_LABELS[selectedProject.procurementMethod] || selectedProject.procurementMethod}`,`项目阶段：${STAGE_LABELS[selectedProject.stage] || selectedProject.stage}`,projectDetail.suppliers?.length ? `已有参与供应商：${projectDetail.suppliers.map(s => s.supplierName).join('、')}` : ''].filter(Boolean).join('；');
        fullReq = `${ctx}\n${fullReq}`;
      }
      const res = await recommendSuppliers({ requirement: fullReq, classificationId: classificationId || undefined, maxCount });
      setResult(res);
      setShortlist(new Map());
      setStep(3); // 自动跳转到审核候选步骤
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
      const res = await polishRequirement({
        text: requirement.trim(),
        projectName: selectedProject?.name,
        procurementMethod: selectedProject?.procurementMethod,
        deadline: selectedProject?.deadline,
      });
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
    } catch (e: any) { toast.error(e?.message || '邀请失败'); }
    setInviting(false);
  };

  const handleNotifyAi = async () => {
    setNotifyAiLoading(true);
    try {
      const res = await generateNotificationContent({
        projectName: selectedProject?.name,
        supplierNames: [...shortlist.values()].map(v => v.item.name),
      });
      const body = `{供应商名称} 您好！\n\n${res.body}`;
      setNotifyTemplate({ title: res.title, body });
      setNotifyPerSupplier(new Map()); // 清空个性化覆盖，统一使用模板
      toast.success('AI 已生成通知模板');
    } catch (e: any) { toast.error(e?.message || 'AI 生成失败'); }
    setNotifyAiLoading(false);
  };

  const handleNotify = async () => {
    if (!notifyTemplate.title.trim()) { toast.error('请填写通知标题'); return; }
    setNotifySending(true);
    try {
      const ids = [...shortlist.keys()];
      const hasOverrides = ids.some(sid => notifyPerSupplier.has(sid));

      if (hasOverrides) {
        let sent = 0;
        for (const sid of ids) {
          const msg = getSupplierMessage(sid);
          const name = shortlist.get(sid)?.item.name || '';
          await notifySuppliers({
            supplierIds: [sid],
            channels: notifyChannels,
            type: 'SELECTION_NOTIFY',
            title: msg.title.replace(/\{供应商名称\}/g, name),
            content: msg.body.replace(/\{供应商名称\}/g, name),
          });
          sent++;
        }
        setNotified(true);
        toast.success(`已通知 ${sent} 家供应商`);
      } else {
        const res = await notifySuppliers({
          supplierIds: ids, channels: notifyChannels, type: 'SELECTION_NOTIFY',
          title: notifyTemplate.title.trim(), content: notifyTemplate.body.trim(),
        });
        setNotified(true);
        toast.success(`已通知 ${res.sent} 家供应商${res.notFound > 0 ? `，${res.notFound} 家未找到关联账户` : ''}`);
      }
      setNotifyModal(false);
      setNotifyTemplate({ title: '', body: '' });
      setNotifyPerSupplier(new Map());
    } catch (e: any) { toast.error(e?.message || '通知发送失败'); }
    setNotifySending(false);
  };

  // 取某供应商的实际通知内容（有个性化覆盖则用覆盖，否则用模板）
  const getSupplierMessage = (sid: string) => {
    const override = notifyPerSupplier.get(sid);
    if (override) return override;
    return { title: notifyTemplate.title, body: notifyTemplate.body };
  };

  const handleShare = async () => {
    if (!shareNote.trim()) return;
    setShareSending(true);
    const shortlistData = [...shortlist.values()].map(({ item: r, note }) => ({ name: r.name, matchScore: r.matchScore, reason: r.reason }));
    try {
      await shareShortlist({ requirement: requirement.trim(), shortlist: shortlistData, note: shareNote.trim() || undefined });
      toast.success('候选名单已分享');
      setShareModal(false);
      setShareNote('');
    } catch (e: any) { toast.error(e?.message || '分享失败'); }
    setShareSending(false);
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

  const reset = () => { setStep(1); setResult(null); setShortlist(new Map()); setNotified(false); setError(''); sessionStorage.removeItem('supplier-selection-state'); };

  // ── 第 3 步：候选名单 sidebar（边看推荐边构建名单） ──
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
          <div className="flex gap-1.5 pt-1">
            <button onClick={() => setStep(4)} disabled={shortlist.size === 0} className="neu-btn-soft is-info flex-1 justify-center">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              下一步：确认通知
            </button>
            <button onClick={() => setShortlist(new Map())} className="neu-btn-xs is-danger">清空</button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      {/* ══════ page-hero ══════ */}
      {!hideHeader && (
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
      )}

      {/* ══ 向导步骤指示器 ══ */}
      <div className="neu-table-card p-0">
        <div className="flex">
          {STEPS.map((s) => (
            <button
              key={s.num}
              onClick={() => {
                // 允许回退到已完成的步骤；第 3 步在有结果时也可跳入
                if (s.num <= step || (s.num === 3 && result)) setStep(s.num);
              }}
              className={`flex-1 flex items-center gap-3 px-4 py-3 text-left transition-colors ${step === s.num ? 'bg-[color-mix(in_oklch,var(--accent)_4%,transparent)]' : ''} ${s.num > 1 && 'border-l border-[var(--muted)]/15'}`}
            >
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-extrabold transition-colors ${step === s.num ? 'bg-[var(--accent)] text-white' : step > s.num ? 'bg-[var(--success)]/30 text-[var(--success)]' : 'bg-[var(--muted)]/25 text-[var(--muted-foreground)]'}`}>
                {step > s.num ? '✓' : s.num}
              </span>
              <div className="min-w-0">
                <div className={`text-[13px] font-bold ${step === s.num ? 'text-[var(--foreground)]' : step > s.num ? 'text-[var(--muted-foreground)]' : 'text-[var(--muted-foreground)]/50'}`}>{s.label}</div>
                <div className="text-[10px] text-[var(--muted-foreground)]/60 leading-tight truncate hidden md:block">{s.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {error && step !== 3 && <div className="rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">{error}</div>}

      {/* ── 步骤 1：选择项目 + 分类 ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="neu-table-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-extrabold text-white">1</span>
              <span className="text-sm font-bold text-[var(--foreground)]">选择采购项目与供应商分类</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-[var(--muted-foreground)] block mb-1.5">项目关联</label>
                {defaultProjectTitle ? (
                  <div className="neu-input text-sm w-full flex items-center py-2.5">
                    <span className="font-bold text-[var(--foreground)] truncate">{defaultProjectTitle}</span>
                  </div>
                ) : (
                  <select value={projectId} onChange={e => setProjectId(e.target.value)} className="neu-input text-sm w-full">
                    <option value="">不关联项目</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                {selectedProject && projectDetail && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    <span className="rounded-md bg-[var(--surface)] px-2 py-0.5 text-[var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">{METHOD_LABELS[selectedProject.procurementMethod] || selectedProject.procurementMethod}</span>
                    <span className="rounded-md bg-[var(--surface)] px-2 py-0.5 text-[var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">{STAGE_LABELS[selectedProject.stage] || selectedProject.stage}</span>
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
          </div>

          <div className="flex justify-end">
            <button onClick={() => { setError(''); setStep(2); }} className="neu-btn-soft is-info">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              下一步：描述需求
            </button>
          </div>
        </div>
      )}

      {/* ── 步骤 2：需求描述 ── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="neu-table-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-extrabold text-white">2</span>
              <div><span className="text-sm font-bold text-[var(--foreground)]">描述采购需求</span><span className="ml-2 text-xs text-[var(--muted-foreground)]">AI 将按需求语义匹配候选</span></div>
            </div>

            {selectedProject && (
              <div className="text-xs text-[var(--muted-foreground)] rounded-lg bg-[var(--surface)] px-3 py-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                <strong className="text-[var(--foreground)]">{selectedProject.name}</strong> · {METHOD_LABELS[selectedProject.procurementMethod] || selectedProject.procurementMethod} · {STAGE_LABELS[selectedProject.stage] || selectedProject.stage}
              </div>
            )}

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
                <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">推荐数量
                  <select value={maxCount} onChange={e => setMaxCount(Number(e.target.value))} className="workbench-input text-xs py-1.5 !h-auto">{[5,8,10,15,20].map(n => <option key={n} value={n}>{n} 家</option>)}</select>
                </div>
                <button onClick={run} disabled={loading || !requirement.trim()} className="neu-btn-soft">
                  <Wand2 size={15} />{loading ? '智能匹配中...' : '智能推荐'}
                </button>
              </div>
            </div>
          </div>

          {error && <div className="rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">{error}</div>}

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="neu-btn-soft">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              上一步：选择项目
            </button>
          </div>
        </div>
      )}

      {/* ── 步骤 3：审核候选（推荐结果 + 候选名单 sidebar） ── */}
      {step === 3 && (
        <div className="space-y-4">
          {loading && (
            <div className="neu-table-card py-14 text-center">
              <div className="inline-flex items-center gap-2 text-sm font-bold text-[var(--accent)]">
                <RefreshCw size={14} className="animate-spin" />AI 正在分析采购需求，从供应商库中匹配候选...
              </div>
              <p className="mt-3 text-xs text-[var(--muted-foreground)] max-w-md mx-auto leading-relaxed">分析维度：需求关键词提取 → 候选池粗筛 → 资质与能力评分 → 综合排序</p>
            </div>
          )}

          {result && !loading && (
            <div className={`grid grid-cols-1 gap-5 items-start ${shortlist.size > 0 ? 'lg:grid-cols-3' : ''}`}>
              <div className={`space-y-4 ${shortlist.size > 0 ? 'lg:col-span-2' : ''}`}>
                {error && <div className="rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">{error}</div>}

                <div className="neu-table-card p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <FileSearch size={16} className="text-[var(--accent)]" />
                    <h2 className="text-sm font-bold text-[var(--foreground)]">智能分析摘要</h2>
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
                            <span className="text-sm font-bold text-[var(--foreground)] cursor-pointer hover:text-[var(--accent)] transition" onClick={() => router.push(`/supplier/${r.supplierId}?from=selection`)}>{r.name}</span>
                            {r.classification && <StatusBadge tone="blue">{r.classification}</StatusBadge>}
                            {r.enterpriseType && <span className="neu-tab-count">{normalizeEnterpriseType(r.enterpriseType)}</span>}
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
                          <button onClick={() => router.push(`/supplier/${r.supplierId}?from=selection`)} className="neu-btn-xs">详情</button>
                          <button onClick={() => toggleShortlistAndSave(r)} className={`neu-btn-xs ${inList ? 'is-success' : ''}`}>{inList ? <><X size={12} />移除</> : <><Plus size={12} />加入候选</>}</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {shortlist.size > 0 && <div className="lg:col-span-1">{shortlistPanel}</div>}
            </div>
          )}

          {!result && !loading && (
            <div className="neu-table-card py-14 text-center">
              <Wand2 size={32} className="mx-auto text-[var(--muted-foreground)]/40 mb-3" />
              <p className="text-sm text-[var(--muted-foreground)]">返回上一步调整需求后重新执行智能推荐</p>
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]">
            <button onClick={() => setStep(2)} className="neu-btn-soft">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              上一步：描述需求
            </button>
            <button onClick={() => setStep(4)} disabled={shortlist.size === 0} className="neu-btn-soft is-info" title={shortlist.size === 0 ? '请先加入候选供应商' : undefined}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              下一步：确认通知{shortlist.size === 0 ? ' · 请先加入候选' : `（${shortlist.size} 家）`}
            </button>
          </div>
        </div>
      )}

      {/* ── 步骤 4：确认通知 / 邀请 / 分享 ── */}
      {step === 4 && (
        <div className="space-y-4">
          {notified && (
            <div className="neu-table-card p-5 flex items-center gap-3">
              <ShieldCheck size={28} className="text-[var(--success)] flex-shrink-0" />
              <div>
                <div className="text-sm font-bold text-[var(--foreground)]">通知已发送给候选供应商</div>
                <p className="text-xs text-[var(--muted-foreground)]">供应商收到后将确认参与意向，可继续发送正式邀请或分享名单</p>
              </div>
            </div>
          )}

          <div className="neu-table-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-extrabold text-white">4</span>
              <div>
                <span className="text-sm font-bold text-[var(--foreground)]">候选名单已定稿</span>
                <span className="ml-2 text-xs text-[var(--muted-foreground)]">{shortlist.size} 家供应商 · 平均匹配度 {shortlist.size > 0 ? Math.round([...shortlist.values()].reduce((s, v) => s + v.item.matchScore, 0) / shortlist.size) : 0}</span>
              </div>
            </div>

            <div className="rounded-xl bg-[var(--surface)] p-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
              <div className="flex flex-wrap gap-1.5">
                {[...shortlist.entries()].map(([sid, { item: r }], idx) => (
                  <span key={sid} className="inline-flex items-center gap-1.5 rounded-lg bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2.5 py-1 text-xs font-semibold text-[var(--foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">
                    <span className="flex h-4 w-4 items-center justify-center rounded-[5px] bg-[var(--accent)] text-[9px] text-white">{idx + 1}</span>
                    {r.name}
                    <span className="text-[10px] font-bold" style={{ color: scoreVar(r.matchScore) }}>{r.matchScore}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* 操作动作网格 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <button
                onClick={() => { setNotifyTemplate({ title: '项目邀请通知', body: '' }); setNotifyPerSupplier(new Map()); setNotifyChannels(['in_app']); setNotifyActiveSupplier(''); setNotifyModal(true); }}
                className="neu-btn-soft is-success justify-center !py-3"
              >
                <Bell size={15} />通知候选供应商
              </button>
              {projectId && (
                <button onClick={handleInvite} disabled={inviting} className="neu-btn-soft justify-center !py-3">
                  <Send size={15} />{inviting ? '发送中...' : '发送项目邀请'}
                </button>
              )}
              <button onClick={() => { setShareNote(''); setShareModal(true); }} className="neu-btn-soft justify-center !py-3">
                <Share2 size={15} />分享给采购主管
              </button>
              <button onClick={() => setShowCompare(true)} disabled={shortlist.size < 2} className="neu-btn-soft justify-center !py-3" title="横向对比至少需要 2 家供应商">
                <Columns3 size={15} />横向对比
              </button>
              <button onClick={() => exportShortlistToExcel([...shortlist.values()], selectedProject?.name)} className="neu-btn-soft justify-center !py-3">
                <FileSpreadsheet size={15} />导出 Excel
              </button>
              <button onClick={copyList} className="neu-btn-soft justify-center !py-3">
                <Copy size={15} />复制名单
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-extrabold text-white">4</span>
              <span className="text-sm font-bold text-[var(--foreground)]">确认通知</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={reset} className="neu-btn-soft">重新选取</button>
              <button onClick={() => setStep(3)} className="neu-btn-soft">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                返回调整名单
              </button>
            </div>
          </div>
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

      {/* ══════ 分享候选人名单弹窗 ══════ */}
      {shareModal && (
        <Modal
          open
          onClose={() => setShareModal(false)}
          title="分享候选名单"
          description={`将选中的 ${shortlist.size} 家供应商分享给采购主管审阅`}
          footer={
            <>
              <button onClick={() => setShareModal(false)} className="neu-btn-soft">取消</button>
              <button onClick={handleShare} disabled={shareSending || !shareNote.trim()} className="neu-btn-primary">
                {shareSending ? '分享中...' : '确认分享'}
              </button>
            </>
          }
        >
          <textarea
            value={shareNote}
            onChange={e => setShareNote(e.target.value)}
            placeholder={`分享备注（必填），如：已根据水利工程施工需求筛选，建议约谈以下 ${shortlist.size} 家供应商。分类优先级：工程技术>设备供应`}
            className="neu-input w-full h-24 resize-none text-sm"
          />
          <div className="rounded-xl p-3 bg-[var(--surface)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
            <p className="text-[10px] font-semibold text-[var(--muted-foreground)] mb-1.5">将分享以下供应商：</p>
            <div className="flex flex-wrap gap-1">
              {[...shortlist.values()].map(({ item: r }) => (
                <span key={r.supplierId} className="neu-tab-count">{r.name}</span>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {/* ══════ 通知供应商弹窗 ══════ */}
      {notifyModal && (
        <Modal
          open
          onClose={() => setNotifyModal(false)}
          title="通知候选供应商"
          description={`模板中 {供应商名称} 将自动替换。点击供应商名称可单独调整其通知内容`}
          size="lg"
          footer={
            <>
              <button onClick={() => setNotifyModal(false)} className="neu-btn-soft">取消</button>
              <button onClick={handleNotify} disabled={notifySending || !notifyTemplate.title.trim()} className="neu-btn-primary">
                {notifySending ? `发送中...` : `一键通知 ${shortlist.size} 家供应商`}
              </button>
            </>
          }
        >
          {/* 渠道 + AI */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-[var(--muted-foreground)]">渠道</span>
              {[
                { key: 'in_app', label: '站内通知', icon: <MessageSquare size={12} /> },
                { key: 'sms', label: '短信通知', icon: <Bell size={12} /> },
              ].map(ch => {
                const active = notifyChannels.includes(ch.key);
                return (
                  <button
                    key={ch.key}
                    onClick={() => setNotifyChannels(prev => active ? prev.filter(c => c !== ch.key) : [...prev, ch.key])}
                    className={`neu-tab text-[11px] gap-1 ${active ? 'is-active' : ''}`}
                  >
                    {ch.icon}{ch.label}
                  </button>
                );
              })}
            </div>
            <button onClick={handleNotifyAi} disabled={notifyAiLoading || shortlist.size === 0} className="neu-btn-xs gap-1">
              <Sparkles size={10} />
              {notifyAiLoading ? 'AI 生成中...' : 'AI 生成'}
            </button>
          </div>

          {/* 模板编辑 */}
          <div className="rounded-xl p-3 bg-[var(--surface)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
            <p className="text-[10px] font-semibold text-[var(--muted-foreground)] mb-1.5">通知模板（{`{供应商名称}`} 自动替换）</p>
            <input
              value={notifyTemplate.title}
              onChange={e => setNotifyTemplate(prev => ({ ...prev, title: e.target.value }))}
              placeholder="通知标题"
              className="neu-input text-sm mb-2"
            />
            <textarea
              value={notifyTemplate.body}
              onChange={e => setNotifyTemplate(prev => ({ ...prev, body: e.target.value }))}
              placeholder={`{供应商名称} 您好！\n\n您已被纳入项目候选名单，请关注后续正式采购邀请。`}
              className="neu-input w-full h-24 resize-none text-xs"
            />
          </div>

          {/* 逐供应商标签 + 展开详情 */}
          <div className="rounded-xl p-3 bg-[var(--surface)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
            <div className="flex flex-wrap gap-1.5 mb-3">
              {[...shortlist.values()].map(({ item: r }) => (
                <button
                  key={r.supplierId}
                  onClick={() => setNotifyActiveSupplier(prev => prev === r.supplierId ? '' : r.supplierId)}
                  className={`neu-tab text-[11px] !px-2.5 !py-1.5 gap-1 ${notifyActiveSupplier === r.supplierId ? 'is-active' : ''} ${notifyPerSupplier.has(r.supplierId) ? 'ring-1 ring-[var(--accent)]/30' : ''}`}
                >
                  {r.name}{notifyPerSupplier.has(r.supplierId) ? <span className="text-[var(--accent)] text-[9px]">⚙</span> : ''}
                </button>
              ))}
            </div>

            {/* 展开的供应商详情 + 可编辑通知 */}
            {notifyActiveSupplier && (() => {
              const supplier = [...shortlist.values()].find(v => v.item.supplierId === notifyActiveSupplier);
              if (!supplier) return null;
              const msg = getSupplierMessage(notifyActiveSupplier);
              const r = supplier.item;
              return (
                <div className="rounded-lg bg-[var(--background)]/60 p-3 text-xs space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[var(--foreground)]">{r.name}</span>
                    <span className="text-[var(--muted-foreground)]/60">匹配 {r.matchScore} 分</span>
                    <span className="text-[var(--muted-foreground)]/60">·</span>
                    <span className="text-[var(--muted-foreground)]/60">{r.classification || '未分类'}</span>
                    {notifyPerSupplier.has(r.supplierId) && (
                      <button
                        onClick={() => setNotifyPerSupplier(prev => { const n = new Map(prev); n.delete(r.supplierId); return new Map(n); })}
                        className="ml-auto neu-btn-xs text-[10px]"
                      >
                        恢复为模板
                      </button>
                    )}
                  </div>
                  <input
                    value={msg.title}
                    onChange={e => setNotifyPerSupplier(prev => {
                      const n = new Map(prev);
                      n.set(r.supplierId, { ...msg, title: e.target.value });
                      return n;
                    })}
                    placeholder="通知标题"
                    className="neu-input text-xs !h-8"
                  />
                  <textarea
                    value={msg.body}
                    onChange={e => setNotifyPerSupplier(prev => {
                      const n = new Map(prev);
                      n.set(r.supplierId, { ...msg, body: e.target.value });
                      return n;
                    })}
                    placeholder="通知正文"
                    className="neu-input w-full h-20 resize-none text-xs"
                  />
                </div>
              );
            })()}
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function SupplierSelectionPageWrapper() {
  return <SupplierSelectionPage />;
}
