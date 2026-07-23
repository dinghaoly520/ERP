'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { recommendSuppliers, getClassifications, polishRequirement, inviteSuppliers, shareShortlist, updateSelectionShortlist, notifySuppliers, generateNotificationContent, getSupplierList } from '@/lib/api/supplier';
import { normalizeEnterpriseType } from '@/lib/utils/enterprise-type';
import type { SupplierRecommendation, SupplierSelectionResult } from '@/lib/api/supplier';
import type { SupplierSelectionHistoryRecord } from '@/lib/api/supplier';
import type { SupplierClassification, Supplier } from '@/lib/types';
import { listBidProjects, getBidProjectDetail, type BidProjectOption, type BidProjectDetail } from '@/lib/api/expert';
import { analyzeProjectManagementItem } from '@/lib/api/project-management';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import { Wand2, Copy, Download, X, Plus, FileSearch, ChevronDown, ChevronUp, Award, Zap, Building2, RefreshCw, Sparkles, Clock3, Columns3, FileSpreadsheet, Send, Share2, ListPlus, Bell, MessageSquare, ShieldCheck, Check, Search, MousePointer2 } from 'lucide-react';
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
  { num: 5, label: '供应商确认', desc: '跟踪候选供应商确认参与意向' },
] as const;

export function SupplierSelectionPage({
  hideHeader,
  defaultProjectTitle,
  project,
}: {
  hideHeader?: boolean;
  defaultProjectTitle?: string;
  project?: ProjectManagementItem | null;
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
  const [step, setStep] = useState(1); // 向导步骤：1=选择项目 2=描述需求 3=审核候选 4=确认通知 5=供应商确认
  const [notified, setNotified] = useState(false); // 第 4 步：是否已完成通知发送
  // 第 5 步：逐供应商确认状态（待确认 / 已确认 / 已放弃）
  const [confirmations, setConfirmations] = useState<Map<string, 'pending' | 'confirmed' | 'declined'>>(new Map());
  const [notifyNotFound, setNotifyNotFound] = useState(0); // 第 5 步：通知未找到关联账户的供应商数
  const [completed, setCompleted] = useState(false); // 第 5 步：本批次选取是否已确认完成

  // 选取方式：AI 智能选取 / 手动选取
  const [selectionMode, setSelectionMode] = useState<'ai' | 'manual'>('ai');
  const [manualSearch, setManualSearch] = useState('');
  const [manualSuppliers, setManualSuppliers] = useState<Supplier[]>([]);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualTotal, setManualTotal] = useState(0);

  // 项目文件分析上下文（用于 AI 润色时提供真实文件内容）
  const [fileContextLoaded, setFileContextLoaded] = useState(false);
  const [fileAnalysisContext, setFileAnalysisContext] = useState('');

  useEffect(() => { getClassifications().then(setClassifications).catch(() => {}); listBidProjects().then(setProjects).catch(() => {}); }, []);

  // 恢复上次会话状态（从详情页返回时不丢失），按项目 ID 分桶
  const sessionKey = `supplier-selection-state${project?.id ? `:${project.id}` : ''}`;
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = sessionStorage.getItem(sessionKey);
      if (saved) {
        const state = JSON.parse(saved);
        if (state.requirement) setRequirement(state.requirement);
        if (state.classificationId) setClassificationId(state.classificationId);
        if (state.projectId) setProjectId(state.projectId);
        if (state.maxCount) setMaxCount(state.maxCount);
        if (state.result) setResult(state.result);
        if (state.step) setStep(state.step);
        if (state.notified) setNotified(true);
        if (state.completed) setCompleted(true);
        if (typeof state.notifyNotFound === 'number') setNotifyNotFound(state.notifyNotFound);
        if (state.selectionMode) setSelectionMode(state.selectionMode);
        if (state.confirmationsArr) {
          const cm = new Map<string, 'pending' | 'confirmed' | 'declined'>();
          (state.confirmationsArr as [string, string][]).forEach(([k, v]) => cm.set(k, v as 'pending' | 'confirmed' | 'declined'));
          setConfirmations(cm);
        }
        if (state.shortlistArr) {
          const m = new Map<string, { item: SupplierRecommendation; note: string }>();
          (state.shortlistArr as [string, any][]).forEach(([k, v]) => m.set(k, v));
          setShortlist(m);
        }
        if (state.manualSearch) setManualSearch(state.manualSearch);
        if (state.manualSuppliers) setManualSuppliers(state.manualSuppliers);
        if (state.manualTotal) setManualTotal(state.manualTotal);
      }
    } catch {}
  }, []);

  // 输入状态变化时持久化到 sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(sessionKey, JSON.stringify({
        requirement, classificationId, projectId, maxCount, step,
        result: result ? { ...result, recommendations: result.recommendations.slice(0, 20) } : null,
        shortlistArr: [...shortlist.entries()],
        notified, notifyNotFound, completed,
        confirmationsArr: [...confirmations.entries()],
        selectionMode,
        manualSearch, manualSuppliers, manualTotal,
      }));
    } catch {}
  }, [requirement, classificationId, projectId, maxCount, step, result, shortlist, notified, notifyNotFound, completed, confirmations, selectionMode, manualSearch, manualSuppliers, manualTotal]);
  useEffect(() => { if (!projectId) { setProjectDetail(null); return; } getBidProjectDetail(projectId).then(setProjectDetail).catch(() => setProjectDetail(null)); }, [projectId]);

  // 加载项目文件分析上下文（用于 AI 润色）
  useEffect(() => {
    if (!project?.id || fileContextLoaded || step !== 2) return;
    setFileContextLoaded(true);
    analyzeProjectManagementItem(project.id)
      .then((analysis) => {
        const parts: string[] = [];
        // 项目基本信息
        if (project.title) parts.push(`项目名称：${project.title}`);
        if (project.requesterName) parts.push(`需求申请人：${project.requesterName}`);
        if (project.requesterDepartment) parts.push(`需求部门：${project.requesterDepartment}`);
        if (project.procurementMethod) parts.push(`采购方式：${project.procurementMethod}`);
        if (project.procurementCategory) parts.push(`采购类别：${project.procurementCategory}`);
        if (project.budgetAmount) parts.push(`预算金额：${Number(project.budgetAmount).toLocaleString('zh-CN')} 元`);
        if (project.projectReason) parts.push(`立项事由：${project.projectReason.slice(0, 500)}`);
        if (project.supplierRequirements) parts.push(`供方要求：${project.supplierRequirements.slice(0, 500)}`);
        // 各阶段文件分析摘要
        const fileAnalyses = (analysis as any).fileAnalyses || [];
        if (fileAnalyses.length > 0) {
          parts.push('\n各阶段文件分析摘要：');
          for (const fa of fileAnalyses) {
            parts.push(`【${fa.stageMatch || '文件'}】${fa.fileName}：${(fa.contentSummary || '').slice(0, 300)}`);
          }
        }
        setFileAnalysisContext(parts.join('\n'));
      })
      .catch(() => setFileAnalysisContext(''));
  }, [project?.id, fileContextLoaded, step, project?.title]);
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
      // 构建完整上下文：项目基本信息 + 文件分析摘要
      const contextParts: string[] = [];
      if (project) {
        if (project.title) contextParts.push(`项目名称：${project.title}`);
        if (project.requesterDepartment) contextParts.push(`申请部门：${project.requesterDepartment}`);
        if (project.procurementMethod) contextParts.push(`采购方式：${project.procurementMethod}`);
        if (project.procurementCategory) contextParts.push(`采购类别：${project.procurementCategory}`);
        if (project.budgetAmount) contextParts.push(`预算金额：${Number(project.budgetAmount).toLocaleString('zh-CN')} 元`);
        if (project.projectReason) contextParts.push(`立项事由：${project.projectReason.slice(0, 500)}`);
      }
      if (fileAnalysisContext) {
        contextParts.push(fileAnalysisContext);
      }
      const additionalContext = contextParts.join('\n');

      const res = await polishRequirement({
        text: requirement.trim(),
        projectName: selectedProject?.name || defaultProjectTitle || project?.title,
        procurementMethod: selectedProject?.procurementMethod || project?.procurementMethod,
        deadline: selectedProject?.deadline,
        additionalContext: additionalContext || undefined,
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

      let totalSent = 0;
      let totalNotFound = 0;
      if (hasOverrides) {
        for (const sid of ids) {
          const msg = getSupplierMessage(sid);
          const name = shortlist.get(sid)?.item.name || '';
          const r = await notifySuppliers({
            supplierIds: [sid],
            channels: notifyChannels,
            type: 'SELECTION_NOTIFY',
            title: msg.title.replace(/\{供应商名称\}/g, name),
            content: msg.body.replace(/\{供应商名称\}/g, name),
          });
          totalSent += r.sent || 1;
          totalNotFound += r.notFound || 0;
        }
      } else {
        const res = await notifySuppliers({
          supplierIds: ids, channels: notifyChannels, type: 'SELECTION_NOTIFY',
          title: notifyTemplate.title.trim(), content: notifyTemplate.body.trim(),
        });
        totalSent = res.sent;
        totalNotFound = res.notFound;
      }
      setNotified(true);
      setNotifyNotFound(totalNotFound);
      setCompleted(false);
      toast.success(`已通知 ${totalSent} 家供应商${totalNotFound > 0 ? `，${totalNotFound} 家未找到关联账户` : ''}`);
      // 进入第 5 步：供应商确认（初始化全部为待确认）
      setConfirmations(new Map([...shortlist.keys()].map(sid => [sid, 'pending' as const])));
      setStep(5);
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

  const reset = () => { setStep(1); setResult(null); setShortlist(new Map()); setNotified(false); setConfirmations(new Map()); setNotifyNotFound(0); setCompleted(false); setError(''); setFileContextLoaded(false); setFileAnalysisContext(''); setManualSearch(''); setManualSuppliers([]); setManualTotal(0); try { sessionStorage.removeItem(`supplier-selection-state${project?.id ? `:${project.id}` : ''}`); } catch {} };

  // 手动搜索供应商
  const handleManualSearch = async () => {
    if (!manualSearch.trim()) return;
    setManualLoading(true);
    try {
      const res = await getSupplierList({ search: manualSearch.trim(), status: 'APPROVED', pageSize: 20 });
      const items = (res as any).items ?? (res as any).data ?? res ?? [];
      setManualSuppliers(Array.isArray(items) ? items : []);
      setManualTotal((res as any).total ?? (Array.isArray(items) ? items.length : 0));
    } catch { toast.error('供应商搜索失败'); }
    setManualLoading(false);
  };

  // 输入防抖自动搜索（热加载）
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!manualSearch.trim() || selectionMode !== 'manual' || step !== 3) return;
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => { handleManualSearch(); }, 300);
    return () => clearTimeout(searchTimerRef.current);
  }, [manualSearch, selectionMode, step]);

  // 手动将供应商加入候选名单（构造虚拟 SupplierRecommendation）
  const toggleManualSupplier = (s: Supplier) => {
    const sid = s.id;
    setShortlist(prev => {
      const n = new Map(prev);
      if (n.has(sid)) { n.delete(sid); return n; }
      const r: SupplierRecommendation = {
        supplierId: sid,
        name: s.name,
        classification: (s as any).classification?.name,
        matchScore: 0,
        reason: '手动选取',
        enterpriseType: (s as any).enterpriseType,
        contacts: (s as any).contacts || [],
        activeProjects: 0,
      };
      n.set(sid, { item: r, note: '' });
      return n;
    });
  };

  // 第 5 步：完成本批次选取（记录汇总、清空会话，给采购员闭环）
  const completeSelection = () => {
    const summary = `已记录：${confirmedCount} 家确认 / ${declinedCount} 家放弃 / ${pendingCount} 家待确认`;
    toast.success(summary);
    setCompleted(true);
    // 完成后清空会话，下次进入从第 1 步开始
    setTimeout(() => {
      sessionStorage.removeItem('supplier-selection-state');
    }, 500);
  };

  // 第 5 步：循环切换供应商确认状态（待确认 → 已确认 → 已放弃 → 待确认）
  const cycleConfirmation = (sid: string) => {
    setConfirmations(prev => {
      const n = new Map(prev);
      const cur = n.get(sid) || 'pending';
      n.set(sid, cur === 'pending' ? 'confirmed' : cur === 'confirmed' ? 'declined' : 'pending');
      return n;
    });
  };
  // 确认状态派生统计
  const confirmedCount = [...confirmations.values()].filter(s => s === 'confirmed').length;
  const declinedCount = [...confirmations.values()].filter(s => s === 'declined').length;
  const pendingCount = shortlist.size - confirmedCount - declinedCount;

  // ── 第 3 步：候选名单 sidebar ──
  const shortlistPanel = (
    <div className="rounded-[18px] p-4 space-y-3 lg:sticky lg:top-20"
      style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Award size={14} className="text-[var(--accent)]" />
          <h2 className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">候选名单</h2>
        </div>
        <span className="tabular-nums text-[11px] font-bold text-[var(--foreground)]">{shortlist.size}</span>
      </div>
      {shortlist.size === 0 ? (
        <div className="py-10 text-center">
          <Zap size={24} className="mx-auto mb-3 text-[var(--muted-foreground)]/25" />
          <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">点击推荐结果中的<br /><span className="font-bold text-[var(--accent)]">「加入」</span> 构建名单</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {[...shortlist.entries()].map(([sid, { item: r, note }], idx) => {
            const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
            return (
              <div key={sid} className="rounded-[12px] p-2.5 flex flex-col gap-2 transition-shadow"
                style={{ background: 'oklch(1 0 0 / 0.5)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5), 1px 1px 2px oklch(0.55 0.03 258 / 0.05)' }}>
                <div className="flex items-center gap-2">
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button onClick={() => moveShortlistItem(idx, idx - 1)} disabled={idx === 0} className="p-0.5 text-[var(--muted-foreground)]/30 hover:text-[var(--muted-foreground)] disabled:opacity-15"><ChevronUp size={12} /></button>
                    <button onClick={() => moveShortlistItem(idx, idx + 1)} disabled={idx === shortlist.size - 1} className="p-0.5 text-[var(--muted-foreground)]/30 hover:text-[var(--muted-foreground)] disabled:opacity-15"><ChevronDown size={12} /></button>
                  </div>
                  <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[6px] text-[9px] font-extrabold text-white tabular-nums"
                    style={{ background: 'linear-gradient(135deg, oklch(0.52 0.16 258), oklch(0.45 0.14 258))' }}>{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[12px] font-bold text-[var(--foreground)] truncate">{r.name}</span>
                      <button onClick={() => toggleShortlist(r)} className="shrink-0 text-[var(--muted-foreground)]/20 hover:text-[var(--danger)] transition"><X size={11} /></button>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] tabular-nums">
                      <span className="font-bold" style={{ color: scoreVar(r.matchScore) }}>{r.matchScore}</span>
                      {contact && <span className="text-[var(--muted-foreground)] truncate">{contact.name}</span>}
                    </div>
                  </div>
                </div>
                <input value={note} onChange={e => updateNote(sid, e.target.value)} placeholder="备注…" className="workbench-input w-full !h-6 !text-[10px] !px-2" />
              </div>
            );
          })}
          <div className="flex gap-1.5 pt-1">
            <button onClick={setShortlist.bind(null, new Map())} className="neu-btn-xs is-danger">清空</button>
            <div className="flex gap-1 flex-1">
              <button onClick={copyList} title="复制名单" className="neu-btn-xs flex-1 justify-center"><Copy size={11} /></button>
              <button onClick={downloadList} title="导出 TXT" className="neu-btn-xs flex-1 justify-center"><Download size={11} /></button>
              <button onClick={() => exportShortlistToExcel([...shortlist.values()], selectedProject?.name)} title="导出 Excel" className="neu-btn-xs flex-1 justify-center"><FileSpreadsheet size={11} /></button>
            </div>
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

      {/* ══ 步骤指示器 ══ */}
      <div className="neu-tab-bar flex gap-0 p-1">
        {STEPS.map((s, i) => {
          const isCurrent = step === s.num;
          const isPast = step > s.num;
          const isFuture = step < s.num;
          const reachable = s.num <= step || (s.num === 3 && !!result);
          return (
            <React.Fragment key={s.num}>
              {i > 0 && (
                <div className="flex items-center shrink-0 px-0.5">
                  <div className="w-5 h-[2px] rounded-full transition-colors duration-500"
                    style={{ background: isPast ? 'var(--success)' : isCurrent ? 'color-mix(in oklch, var(--accent) 50%, transparent)' : 'oklch(0.6 0.04 258 / 0.15)' }} />
                </div>
              )}
              <button
                onClick={() => { if (reachable) setStep(s.num); }}
                disabled={!reachable}
                className={`neu-tab flex-1 flex items-center gap-2.5 px-3 py-2 ${isCurrent ? 'is-active' : ''}`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold leading-none transition-all duration-300
                  ${isCurrent ? 'text-white' : isPast ? 'text-[var(--success)]' : 'text-[var(--muted-foreground)]/40'}`}
                  style={isCurrent ? { background: 'linear-gradient(135deg, oklch(0.54 0.18 258), oklch(0.44 0.14 258))', boxShadow: '0 2px 8px oklch(0.5 0.16 258 / 0.35)' } : isPast ? { background: 'color-mix(in oklch, var(--success) 20%, transparent)' } : { background: 'oklch(0.6 0.02 258 / 0.1)' }}>
                  {isPast ? <Check size={11} strokeWidth={2.5} /> : s.num}
                </span>
                <div className="min-w-0 hidden sm:block text-left">
                  <div className={`text-[11px] font-bold leading-tight ${isCurrent ? 'text-[var(--accent-strong)]' : isPast ? 'text-[var(--muted-foreground)]' : 'text-[var(--muted-foreground)]/40'}`}>{s.label}</div>
                  <div className={`text-[9px] leading-tight truncate ${isCurrent ? 'text-[var(--accent)]/70' : 'text-[var(--muted-foreground)]/50'}`}>{s.desc}</div>
                </div>
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {error && step !== 3 && <div className="rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">{error}</div>}

      {/* ── 步骤 1：选择项目 + 分类 ── */}
      {step === 1 && (
        <div className="space-y-5">
          <div className="rounded-[20px] p-6 pb-5 space-y-5"
            style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.985 0.005 258 / 0.58) 40%, oklch(1 0 0 / 0.14) 75%)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.75), 2px 3px 8px oklch(0.55 0.03 258 / 0.1), -2px -2px 8px oklch(1 0 0 / 0.88)' }}>
            {/* 选取方式 */}
            <div>
              <label className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">选取方式</label>
              <div className="mt-2.5 grid grid-cols-2 gap-3">
                <div
                  onClick={() => setSelectionMode('ai')}
                  className={`neu-opt group flex flex-col items-center gap-2 py-4 cursor-pointer transition-all duration-200 ${selectionMode === 'ai' ? 'is-on' : 'hover:shadow-[inset_0_1px_0_oklch(1_0_0/0.8),3px_3px_6px_oklch(0.55_0.03_258/0.14),-2px_-2px_5px_oklch(1_0_0/0.9)]'}`}
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-[12px] transition-all duration-300 ${selectionMode === 'ai' ? 'text-white shadow-[0_2px_8px_oklch(0.5_0.16_258/0.4)]' : 'text-[var(--accent)]'}`}
                    style={selectionMode === 'ai' ? { background: 'linear-gradient(135deg, oklch(0.54 0.18 258), oklch(0.44 0.14 258))' } : { background: 'color-mix(in oklch, var(--accent-soft) 45%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 1px 1px 3px oklch(0.55 0.03 258 / 0.08)' }}>
                    <Sparkles size={18} strokeWidth={1.5} />
                  </div>
                  <div>
                    <div className={`text-sm font-bold tracking-[-0.01em] ${selectionMode === 'ai' ? 'text-[var(--accent-strong)]' : 'text-[var(--foreground)]'}`}>AI 智能选取</div>
                    <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">语义匹配 · 自动推荐</div>
                  </div>
                </div>
                <div
                  onClick={() => setSelectionMode('manual')}
                  className={`neu-opt group flex flex-col items-center gap-2 py-4 cursor-pointer transition-all duration-200 ${selectionMode === 'manual' ? 'is-on' : 'hover:shadow-[inset_0_1px_0_oklch(1_0_0/0.8),3px_3px_6px_oklch(0.55_0.03_258/0.14),-2px_-2px_5px_oklch(1_0_0/0.9)]'}`}
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-[12px] transition-all duration-300 ${selectionMode === 'manual' ? 'text-white shadow-[0_2px_8px_oklch(0.5_0.16_258/0.4)]' : 'text-[var(--accent)]'}`}
                    style={selectionMode === 'manual' ? { background: 'linear-gradient(135deg, oklch(0.54 0.18 258), oklch(0.44 0.14 258))' } : { background: 'color-mix(in oklch, var(--accent-soft) 45%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 1px 1px 3px oklch(0.55 0.03 258 / 0.08)' }}>
                    <MousePointer2 size={18} strokeWidth={1.5} />
                  </div>
                  <div>
                    <div className={`text-sm font-bold tracking-[-0.01em] ${selectionMode === 'manual' ? 'text-[var(--accent-strong)]' : 'text-[var(--foreground)]'}`}>手动选取</div>
                    <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">搜索 · 逐家添加</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="wb-section-rule" />

            {/* 项目 + 分类 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">项目关联</label>
                {defaultProjectTitle ? (
                  <div className="workbench-input w-full text-sm flex items-center">
                    <span className="font-bold text-[var(--foreground)] truncate">{defaultProjectTitle}</span>
                  </div>
                ) : (
                  <select value={projectId} onChange={e => setProjectId(e.target.value)} className="workbench-input w-full text-sm">
                    <option value="">不关联项目</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                {selectedProject && projectDetail && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-semibold">
                    <span className="inline-flex items-center rounded-md px-2 py-0.5" style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)', color: 'var(--accent-strong)' }}>
                      {METHOD_LABELS[selectedProject.procurementMethod] || selectedProject.procurementMethod}
                    </span>
                    <span className="inline-flex items-center rounded-md px-2 py-0.5" style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)', color: 'var(--accent-strong)' }}>
                      {STAGE_LABELS[selectedProject.stage] || selectedProject.stage}
                    </span>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">供应商分类</label>
                <select value={classificationId} onChange={e => setClassificationId(e.target.value)} className="workbench-input w-full text-sm">
                  <option value="">全部分类</option>
                  {classifications.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button onClick={() => { setError(''); if (selectionMode === 'manual') { setStep(3); } else { setStep(2); } }} className="neu-btn-soft gap-2">
              下一步<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* ── 步骤 2：描述需求 ── */}
      {step === 2 && (
        <div className="space-y-5">
          <div className="rounded-[20px] p-6 space-y-5"
            style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.985 0.005 258 / 0.58) 40%, oklch(1 0 0 / 0.14) 75%)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.75), 2px 3px 8px oklch(0.55 0.03 258 / 0.1), -2px -2px 8px oklch(1 0 0 / 0.88)' }}>
            <div className="flex items-center justify-between">
              <div>
                <label className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">采购需求描述</label>
                {selectedProject && (
                  <span className="ml-3 inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[10px] font-bold"
                    style={{ background: 'color-mix(in oklch, var(--accent) 12%, transparent)', color: 'var(--accent-strong)' }}>
                    <Building2 size={10} />{selectedProject.name} · {METHOD_LABELS[selectedProject.procurementMethod] || selectedProject.procurementMethod}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setRequirement(PROMPT_TEMPLATE)} className="neu-btn-xs text-[11px] gap-1" disabled={polishing || loading}>填充模板</button>
                <button onClick={polish} disabled={polishing || !requirement.trim()} className="neu-btn-xs text-[11px] gap-1 text-[var(--accent)]">
                  <Sparkles size={11} />{polishing ? '润色中…' : 'AI 润色'}
                </button>
              </div>
            </div>
            <textarea value={requirement} onChange={e => setRequirement(e.target.value)} placeholder={PROMPT_TEMPLATE}
              className="neu-input w-full !min-h-[280px] resize-y font-mono text-xs leading-relaxed" />

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2 text-[10px] font-semibold text-[var(--muted-foreground)]">
                <span>推荐</span>
                <select value={maxCount} onChange={e => setMaxCount(Number(e.target.value))} className="workbench-input !w-[68px] text-xs !h-7">
                  {[5,8,10,15,20].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <span>家供应商</span>
              </div>
              <button onClick={run} disabled={loading || !requirement.trim()} className="neu-btn-primary !h-9 !text-xs gap-2">
                <Wand2 size={14} />{loading ? '智能匹配中…' : '开始智能推荐'}
              </button>
            </div>
          </div>

          {error && <div className="rounded-xl px-4 py-3 text-sm font-semibold text-[var(--danger)]" style={{ background: 'color-mix(in oklch, var(--danger) 8%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.3)' }}>{error}</div>}

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="neu-btn-soft gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>上一步
            </button>
          </div>
        </div>
      )}

      {/* ── 步骤 3：审核候选 ── */}
      {step === 3 && (
        <div className="space-y-5">
          {loading && (
            <div className="rounded-[20px] py-16 text-center" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
              <RefreshCw size={22} className="animate-spin mx-auto mb-4 text-[var(--accent)]" />
              <p className="text-sm font-bold text-[var(--foreground)]">AI 正在分析采购需求</p>
              <p className="mt-2 text-xs text-[var(--muted-foreground)] max-w-sm mx-auto leading-relaxed">需求关键词提取 → 候选池粗筛 → 资质与能力评分 → 综合排序</p>
            </div>
          )}

          {result && !loading && (
            <div className={`grid grid-cols-1 gap-5 items-start ${shortlist.size > 0 ? 'lg:grid-cols-3' : ''}`}>
              <div className={`space-y-4 ${shortlist.size > 0 ? 'lg:col-span-2' : ''}`}>
                {error && <div className="rounded-xl px-4 py-3 text-sm font-semibold text-[var(--danger)]" style={{ background: 'color-mix(in oklch, var(--danger) 8%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.3)' }}>{error}</div>}

                {/* 智能分析摘要 */}
                <div className="rounded-[20px] p-5" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <FileSearch size={15} className="text-[var(--accent)]" />
                    <h2 className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">智能分析摘要</h2>
                  </div>
                  <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">{result.summary}</p>
                  <div className="flex gap-5 mt-3 text-xs">
                    <span className="tabular-nums">候选池 <strong className="text-[var(--foreground)]">{result.candidatePool}</strong></span>
                    <span className="tabular-nums">推荐 <strong className="text-[var(--foreground)]">{result.recommendations.length}</strong></span>
                  </div>
                </div>

                {/* Batch toolbar */}
                <div className="flex items-center gap-2 text-[10px] font-semibold text-[var(--muted-foreground)]">
                  <button onClick={() => handleBatchAdd()} className="neu-btn-xs gap-1"><ListPlus size={12} />全部加入</button>
                  <span className="text-[var(--muted-foreground)]/40">|</span>
                  {[3, 5, 8, 10].map(n => (
                    <button key={n} onClick={() => handleBatchAdd(n)} className="neu-btn-xs">{n} 名</button>
                  ))}
                </div>

                {/* 推荐列表 */}
                {result.recommendations.map((r, idx) => {
                  const inList = shortlist.has(r.supplierId);
                  const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
                  return (
                    <div key={r.supplierId} className={`rounded-[18px] p-4 transition-shadow duration-200 ${inList ? 'ring-2 ring-[var(--success)]/20' : ''}`}
                      style={{ background: 'oklch(1 0 0 / 0.58)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.75)' }}>
                      <div className="flex items-start gap-3">
                        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] text-[12px] font-extrabold text-white tabular-nums"
                          style={{ background: 'linear-gradient(135deg, oklch(0.52 0.16 258), oklch(0.45 0.14 258))', boxShadow: '0 2px 6px oklch(0.5 0.12 258 / 0.3)' }}>
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            <span className="text-sm font-bold text-[var(--foreground)] cursor-pointer hover:text-[var(--accent)] transition" onClick={() => router.push(`/supplier/${r.supplierId}?from=selection`)}>{r.name}</span>
                            {r.classification && <StatusBadge tone="blue">{r.classification}</StatusBadge>}
                            {r.enterpriseType && <span className="neu-tab-count">{normalizeEnterpriseType(r.enterpriseType)}</span>}
                            {r.evaluation && (
                              <span className="inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[10px] font-extrabold text-white tabular-nums"
                                style={{ background: r.evaluation.level === 'A' ? 'var(--success)' : r.evaluation.level === 'B' ? 'var(--accent)' : r.evaluation.level === 'C' ? 'var(--warning)' : 'var(--danger)' }}>
                                {r.evaluation.level}
                              </span>
                            )}
                            {inList && <span className="text-[10px] font-bold text-[var(--success)]">✓ 已入选</span>}
                          </div>
                          <div className="flex items-center gap-2 mb-2">
                            <div className="flex-1 h-1.5 rounded-full overflow-hidden max-w-[200px]" style={{ background: 'color-mix(in oklch, var(--muted-foreground) 10%, transparent)' }}>
                              <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${r.matchScore}%`, background: scoreVar(r.matchScore) }} />
                            </div>
                            <strong className="text-xs tabular-nums font-extrabold" style={{ color: scoreVar(r.matchScore) }}>{r.matchScore}</strong>
                            <span className="rounded-[4px] px-1.5 py-0.5 text-[9px] font-bold" style={{ color: scoreVar(r.matchScore), background: `color-mix(in oklch, ${scoreVar(r.matchScore)} 14%, transparent)` }}>{scoreLabel(r.matchScore)}</span>
                          </div>
                          <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{r.reason}</p>
                          {contact && <p className="mt-1.5 text-[10px] text-[var(--muted-foreground)]">联系人：{contact.name}{contact.phone ? ` · ${contact.phone}` : ''}{r.legalPerson ? ` · 法人：${r.legalPerson}` : ''}
                            <span className={`ml-2 inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[9px] font-semibold tabular-nums ${r.activeProjects >= 5 ? 'text-[var(--danger)]' : r.activeProjects > 0 ? 'text-[var(--muted-foreground)]' : 'text-[var(--success)]'}`}
                              style={{ background: r.activeProjects >= 5 ? 'color-mix(in oklch, var(--danger) 10%, transparent)' : r.activeProjects > 0 ? 'color-mix(in oklch, var(--foreground) 5%, transparent)' : 'color-mix(in oklch, var(--success) 8%, transparent)' }}>
                              {r.activeProjects >= 5 ? '繁忙' : r.activeProjects > 0 ? '正常' : '空闲'} {r.activeProjects}
                            </span>
                          </p>}
                        </div>
                        <div className="flex flex-col gap-1.5 flex-shrink-0">
                          <button onClick={() => router.push(`/supplier/${r.supplierId}?from=selection`)} className="neu-btn-xs">详情</button>
                          <button onClick={() => toggleShortlistAndSave(r)} className={`neu-btn-xs ${inList ? 'is-success' : ''}`}>
                            {inList ? <><X size={12} />移除</> : <><Plus size={12} />加入</>}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 候选名单 sidebar */}
              {shortlist.size > 0 && <div className="lg:col-span-1 lg:sticky lg:top-20">{shortlistPanel}</div>}
            </div>
          )}

          {/* 空态 */}
          {!result && !loading && selectionMode === 'ai' && (
            <div className="rounded-[20px] py-16 text-center" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
              <Wand2 size={28} className="mx-auto mb-4 text-[var(--muted-foreground)]/30" />
              <p className="text-sm text-[var(--muted-foreground)]">返回上一步调整需求后重新执行智能推荐</p>
            </div>
          )}

          {/* 手动选取 */}
          {!result && !loading && selectionMode === 'manual' && (
            <div className="space-y-4">
              <div className="rounded-[20px] p-5 space-y-4" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
                    <input value={manualSearch} onChange={e => setManualSearch(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleManualSearch(); }}
                      placeholder="按供应商名称、分类或经营范围搜索..." className="workbench-input w-full !pl-9 !pr-8 text-sm" />
                    {manualSearch && (
                      <button
                        type="button"
                        onClick={() => { setManualSearch(''); setManualSuppliers([]); setManualTotal(0); }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-[4px] text-[var(--muted-foreground)]/50 hover:text-[var(--muted-foreground)] transition-colors"
                      >
                        <X size={14} strokeWidth={2} />
                      </button>
                    )}
                  </div>
                  <button onClick={handleManualSearch} disabled={manualLoading} className="neu-btn-soft text-sm gap-1.5">
                    <Search size={14} />{manualLoading ? '搜索中…' : '搜索'}
                  </button>
                </div>
                {manualTotal > 0 && <p className="text-[11px] tabular-nums text-[var(--muted-foreground)]">共 <strong className="text-[var(--foreground)]">{manualTotal}</strong> 家{manualSuppliers.length < manualTotal ? `（显示前 ${manualSuppliers.length} 家）` : ''}</p>}
              </div>

              {manualSuppliers.map((s) => {
                const inList = shortlist.has(s.id);
                const contact = (s as any).contacts?.[0];
                return (
                  <div key={s.id} className={`rounded-[16px] p-3 flex items-center gap-3 ${inList ? 'ring-2 ring-[var(--success)]/20' : ''}`}
                    style={{ background: 'oklch(1 0 0 / 0.58)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.75)' }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-[var(--foreground)]">{s.name}</span>
                        {(s as any).classification?.name && <span className="neu-tab-count">{(s as any).classification.name}</span>}
                        {(s as any).enterpriseType && <span className="neu-tab-count">{normalizeEnterpriseType((s as any).enterpriseType)}</span>}
                        {inList && <span className="text-[10px] font-bold text-[var(--success)]">✓ 已加入</span>}
                      </div>
                      {contact && <div className="text-xs text-[var(--muted-foreground)] mt-0.5">联系人：{contact.name}{contact.phone ? ` · ${contact.phone}` : ''}</div>}
                    </div>
                    <button onClick={() => toggleManualSupplier(s)} className={`neu-btn-xs flex-shrink-0 ${inList ? 'is-danger' : 'is-success'}`}>
                      {inList ? <><X size={12} />移除</> : <><Plus size={12} />加入</>}
                    </button>
                  </div>
                );
              })}

              {!manualLoading && manualSearch && manualSuppliers.length === 0 && (
                <div className="rounded-[20px] py-14 text-center" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
                  <Search size={28} className="mx-auto mb-3 text-[var(--muted-foreground)]/30" />
                  <p className="text-sm text-[var(--muted-foreground)]">未找到匹配的供应商</p>
                </div>
              )}
              {!manualSearch && (
                <div className="rounded-[20px] py-14 text-center" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
                  <MousePointer2 size={28} className="mx-auto mb-3 text-[var(--muted-foreground)]/30" />
                  <p className="text-sm text-[var(--muted-foreground)]">输入供应商名称或分类关键词搜索</p>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <button onClick={() => setStep(selectionMode === 'manual' ? 1 : 2)} className="neu-btn-soft gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>上一步
            </button>
            <button onClick={() => setStep(4)} disabled={shortlist.size === 0} className="neu-btn-soft gap-2" title={shortlist.size === 0 ? '请先加入候选供应商' : undefined}>
              下一步<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              {shortlist.size > 0 && <span className="tabular-nums">（{shortlist.size}）</span>}
            </button>
          </div>
        </div>
      )}

      {/* ── 步骤 4：确认通知 ── */}
      {step === 4 && (
        <div className="space-y-5">
          <div className="rounded-[20px] p-6 space-y-5" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">候选名单已定稿</h2>
                <p className="mt-1 text-sm tabular-nums text-[var(--foreground)]">
                  <strong className="text-base">{shortlist.size}</strong> 家供应商
                  {shortlist.size > 0 && <span className="ml-2 text-xs text-[var(--muted-foreground)]">平均匹配度 <strong className="text-[var(--foreground)]">{Math.round([...shortlist.values()].reduce((s, v) => s + v.item.matchScore, 0) / shortlist.size)}</strong></span>}
                </p>
              </div>
              <button onClick={reset} className="neu-btn-xs">重新选取</button>
            </div>

            {/* 候选标签云 */}
            <div className="flex flex-wrap gap-1.5">
              {[...shortlist.entries()].map(([sid, { item: r }], idx) => (
                <span key={sid} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-[var(--foreground)]"
                  style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] text-[9px] font-extrabold text-white tabular-nums"
                    style={{ background: 'linear-gradient(135deg, oklch(0.52 0.16 258), oklch(0.45 0.14 258))' }}>{idx + 1}</span>
                  {r.name}
                  <span className="text-[10px] font-bold tabular-nums" style={{ color: scoreVar(r.matchScore) }}>{r.matchScore}</span>
                </span>
              ))}
            </div>

            {/* 操作网格 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <button onClick={() => { setNotifyTemplate({ title: '项目邀请通知', body: '' }); setNotifyPerSupplier(new Map()); setNotifyChannels(['in_app']); setNotifyActiveSupplier(''); setNotifyModal(true); }}
                className="neu-opt flex items-center justify-center gap-2 py-3 text-sm font-semibold">
                <Bell size={14} />通知候选供应商
              </button>
              {projectId && (
                <button onClick={handleInvite} disabled={inviting} className="neu-opt flex items-center justify-center gap-2 py-3 text-sm font-semibold">
                  <Send size={14} />{inviting ? '发送中…' : '发送项目邀请'}
                </button>
              )}
              <button onClick={() => { setShareNote(''); setShareModal(true); }} className="neu-opt flex items-center justify-center gap-2 py-3 text-sm font-semibold">
                <Share2 size={14} />分享给采购主管
              </button>
              <button onClick={() => setShowCompare(true)} disabled={shortlist.size < 2} className="neu-opt flex items-center justify-center gap-2 py-3 text-sm font-semibold">
                <Columns3 size={14} />横向对比
              </button>
              <button onClick={() => exportShortlistToExcel([...shortlist.values()], selectedProject?.name)} className="neu-opt flex items-center justify-center gap-2 py-3 text-sm font-semibold">
                <FileSpreadsheet size={14} />导出 Excel
              </button>
              <button onClick={copyList} className="neu-opt flex items-center justify-center gap-2 py-3 text-sm font-semibold">
                <Copy size={14} />复制名单
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button onClick={() => setStep(3)} className="neu-btn-soft gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>上一步
            </button>
          </div>
        </div>
      )}

      {/* ── 步骤 5：供应商确认 ── */}
      {step === 5 && (
        <div className="space-y-5">
          {completed ? (
            <div className="rounded-[20px] py-16 text-center" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[16px]" style={{ background: 'color-mix(in oklch, var(--success) 12%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                <Check size={28} className="text-[var(--success)]" />
              </div>
              <h3 className="mt-5 text-lg font-bold text-[var(--foreground)]">本批次选取已完成</h3>
              <p className="mt-2 text-sm tabular-nums text-[var(--muted-foreground)]">
                已记录 <strong className="text-[var(--success)]">{confirmedCount}</strong> 家确认 · <strong className="text-[var(--danger)]">{declinedCount}</strong> 家放弃 · <strong className="text-[var(--foreground)]">{pendingCount}</strong> 家待确认
              </p>
              <div className="flex justify-center gap-3 mt-6">
                <button onClick={() => router.push('/supplier/repository')} className="neu-btn-soft gap-2">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>返回供应商库
                </button>
                <button onClick={reset} className="neu-btn-soft">开始新一批</button>
              </div>
            </div>
          ) : notified ? (
            <>
              <div className="rounded-[20px] p-6 space-y-5" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px]" style={{ background: 'color-mix(in oklch, var(--success) 14%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                    <ShieldCheck size={22} className="text-[var(--success)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-bold text-[var(--foreground)]">通知已发送，等待供应商确认</h3>
                    <p className="text-[11px] text-[var(--muted-foreground)] mt-1 leading-relaxed">
                      已向 {shortlist.size} 家候选供应商发出邀请通知{notifyNotFound > 0 && `（${notifyNotFound} 家未找到关联账户，需另行联系）`}
                    </p>
                    <div className="mt-3 flex items-center gap-x-4 gap-y-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <div className="flex h-1.5 w-32 rounded-full overflow-hidden" style={{ background: 'color-mix(in oklch, var(--muted-foreground) 12%, transparent)' }}>
                          {shortlist.size > 0 && confirmedCount > 0 && (
                            <div className="h-full transition-[width] duration-500" style={{ width: `${confirmedCount / shortlist.size * 100}%`, background: 'var(--success)' }} />
                          )}
                          {shortlist.size > 0 && declinedCount > 0 && (
                            <div className="h-full transition-[width] duration-500" style={{ width: `${declinedCount / shortlist.size * 100}%`, background: 'var(--danger)' }} />
                          )}
                        </div>
                        <span className="text-[11px] tabular-nums font-bold text-[var(--foreground)]">{confirmedCount}/{shortlist.size}</span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] tabular-nums">
                        <span className="font-bold text-[var(--success)]">{confirmedCount} 已确认</span>
                        <span className="text-[var(--muted-foreground)]">{pendingCount} 待确认</span>
                        {declinedCount > 0 && <span className="font-bold text-[var(--danger)]">{declinedCount} 已放弃</span>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 逐供应商确认列表 */}
                <div className="space-y-1.5">
                  {[...shortlist.entries()].map(([sid, { item: r }], idx) => {
                    const status = confirmations.get(sid) || 'pending';
                    const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
                    return (
                      <div key={sid} className="flex items-center gap-3 rounded-xl px-4 py-3 transition-shadow"
                        style={{ background: 'oklch(1 0 0 / 0.42)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5), 1px 1px 2px oklch(0.55 0.03 258 / 0.05)' }}>
                        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] text-[10px] font-extrabold text-white tabular-nums"
                          style={{ background: 'linear-gradient(135deg, oklch(0.52 0.16 258), oklch(0.45 0.14 258))' }}>{idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-bold text-[var(--foreground)] truncate">{r.name}</div>
                          <div className="text-[10px] text-[var(--muted-foreground)] tabular-nums">
                            匹配 <span style={{ color: scoreVar(r.matchScore) }} className="font-bold">{r.matchScore}</span>
                            {contact ? ` · ${contact.name} ${contact.phone}` : ''}
                          </div>
                        </div>
                        <button onClick={() => cycleConfirmation(sid)} title="点击切换确认状态"
                          className={`neu-btn-xs !py-1.5 !px-3 flex-shrink-0 ${status === 'confirmed' ? 'is-success' : status === 'declined' ? 'is-danger' : ''}`}>
                          {status === 'confirmed' ? <><Check size={12} />已确认</> : status === 'declined' ? <><X size={12} />已放弃</> : '待确认'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <button onClick={() => setStep(4)} className="neu-btn-soft gap-2">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>上一步
                </button>
                <div className="flex gap-2">
                  <button onClick={reset} className="neu-btn-xs">重新选取</button>
                  <button onClick={completeSelection} className="neu-btn-primary !h-9 !text-xs gap-2">
                    <Check size={13} />完成选取
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-[20px] py-16 text-center" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
              <Bell size={28} className="mx-auto mb-4 text-[var(--muted-foreground)]/30" />
              <p className="text-sm text-[var(--muted-foreground)]">请先返回上一步发送通知</p>
              <button onClick={() => setStep(4)} className="neu-btn-soft mt-4">返回确认通知</button>
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
