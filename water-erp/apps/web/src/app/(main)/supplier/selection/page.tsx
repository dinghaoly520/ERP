'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { recommendSuppliers, suggestBusinessTags, getTagVocabulary, polishRequirement, inviteSuppliers, shareShortlist, updateSelectionShortlist, notifySuppliers, generateNotificationContent, getSupplierList, getRsvpList, sendNegotiationConfig } from '@/lib/api/supplier';
import type { TagVocabularyItem, RsvpListResult, RsvpListItem } from '@/lib/api/supplier';
import { normalizeEnterpriseType } from '@/lib/utils/enterprise-type';
import type { SupplierRecommendation, SupplierSelectionResult } from '@/lib/api/supplier';
import type { SupplierSelectionHistoryRecord } from '@/lib/api/supplier';
import type { Supplier } from '@/lib/types';
import { listBidProjects, getBidProjectDetail, type BidProjectOption, type BidProjectDetail } from '@/lib/api/expert';
import { analyzeProjectManagementItem, extractTenderFields } from '@/lib/api/project-management';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import { Wand2, Copy, X, Plus, FileSearch, ChevronDown, ChevronUp, Award, Zap, Building2, RefreshCw, Sparkles, Clock3, Columns3, FileSpreadsheet, Send, Share2, ListPlus, Bell, MessageSquare, ShieldCheck, Check, Search, MousePointer2, ExternalLink, MapPin, Phone, Mail, User, Upload, Loader2, FileText, Calendar } from 'lucide-react';
import { Modal } from '@/components/workbench';
import { RulesPopover } from '@/components/rules-popover';
import { SelectionHistoryDialog } from '@/components/supplier/selection-history-dialog';
import { ComparePanel } from '@/components/supplier/compare-panel';
import { exportShortlistToExcel } from '@/lib/excel-export';
import { StepTrack } from '@/components/step-track';

const scoreVar = (s: number): string => (s >= 85 ? 'var(--success)' : s >= 70 ? 'var(--accent)' : s >= 55 ? 'var(--warning)' : 'var(--danger)');
const scoreLabel = (s: number) => (s >= 85 ? '强匹配' : s >= 70 ? '较匹配' : s >= 55 ? '可考虑' : '弱匹配');

const STAGE_LABELS: Record<string, string> = {
  DOWNLOAD: '下载标书', SUBMIT: '投标提交', OPENING: '开标中', EVALUATING: '评标中', ARCHIVED: '已归档',
};
const METHOD_LABELS: Record<string, string> = {
  '公开招标': '公开招标', '邀请招标': '邀请招标', '竞争性谈判': '竞争性谈判', '竞争性磋商': '竞争性磋商', '询价': '询价', '单一来源': '单一来源',
};

const PROMPT_TEMPLATE = `【项目概况】
（点明采购事项及所属行业领域，作为供应商寻源的方向参照）

【采购范围】
（说明需要供应商提供什么、其经营范围应覆盖哪些业务）

【资质要求】
（供应商应具备的企业类型、行业资质、业绩门槛、技术能力）

【特殊要求】
（对供应商的服务响应、交付周期、质保等能力要求）`;

// 向导步骤定义 — 从项目管理进入且为竞争性谈判时，确认通知后插入「附件选择」
const STEPS = [
  { num: 1, label: '选择项目', desc: '关联采购项目与业务标签' },
  { num: 2, label: '描述需求', desc: '撰写采购需求，AI 润色优化' },
  { num: 3, label: '审核候选', desc: '查看 AI 推荐，构建候选名单' },
  { num: 4, label: '确认通知', desc: '发送通知 / 邀请 / 分享名单' },
  { num: 5, label: '供应商确认', desc: '跟踪候选供应商确认参与意向' },
] as const;
const NEGOTIATION_STEPS = [
  { num: 1, label: '选择项目', desc: '关联采购项目与业务标签' },
  { num: 2, label: '描述需求', desc: '撰写采购需求，AI 润色优化' },
  { num: 3, label: '审核候选', desc: '查看 AI 推荐，构建候选名单' },
  { num: 4, label: '确认通知', desc: '发送通知 / 邀请 / 分享名单' },
  { num: 5, label: '附件选择', desc: '上传谈判所需附件供供应商下载' },
  { num: 6, label: '供应商确认', desc: '跟踪候选供应商确认参与意向' },
] as const;
// 直接采购：已确定供应商 → 仅显示通知+确认两步，隐藏前置选取步骤
const DIRECT_STEPS = [
  { num: 1, label: '确认通知', desc: '发送通知 / 邀请 / 分享名单' },
  { num: 2, label: '供应商确认', desc: '跟踪候选供应商确认参与意向' },
] as const;
// 补选模式下追加的步骤
const RERUN_EXTRA_STEPS = [
  { label: '补选候选', desc: '智能推荐或手动搜索补选供应商' },
  { label: '补选通知', desc: '生成并发送补选供应商通知' },
  { label: '供应商确认', desc: '全部供应商确认状态一览' },
] as const;

/** 自动撑高的 textarea，高度随内容变化 */
function AutoTextarea({ value, onChange, placeholder, minRows = 2 }: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, minRows * 24)}px`;
  }, [value, minRows]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={minRows}
      className="neu-input w-full resize-y text-xs leading-relaxed"
    />
  );
}

/** 业务标签选取 — 三层视觉结构：操作栏 / 已选过滤区 / 可选词表区 */
function BusinessTagsPicker({
  tagVocab, selectedTags, tagQuery, setTagQuery,
  tagSuggesting, runTagSuggestion, markTagsEdited, setSelectedTags,
  removeTag, toggleTag, addCustomTag,
}: {
  tagVocab: TagVocabularyItem[];
  selectedTags: string[];
  tagQuery: string;
  setTagQuery: (q: string) => void;
  tagSuggesting: boolean;
  runTagSuggestion: () => void;
  markTagsEdited: () => void;
  setSelectedTags: (t: string[]) => void;
  removeTag: (t: string) => void;
  toggleTag: (t: string) => void;
  addCustomTag: (t: string) => void;
}) {
  const q = tagQuery.trim();
  const ql = q.toLowerCase();
  const exactInVocab = !q || tagVocab.some(t => t.tag.toLowerCase() === ql);
  const alreadySelected = !!q && selectedTags.some(t => t.toLowerCase() === ql);
  const showCustomAdd = !!q && !exactInVocab && !alreadySelected;
  const filtered = q ? tagVocab.filter(t => t.tag.toLowerCase().includes(ql)) : tagVocab;
  const hasSelected = selectedTags.length > 0;
  const hasVocab = tagVocab.length > 0;

  return (
    <div className="rounded-xl border border-[oklch(0.6_0.04_258_/_0.12)]" style={{ background: 'oklch(0.98 0.008 258 / 0.35)' }}>
      {/* ── 第一层：操作栏（搜索 + AI 匹配）── */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            value={tagQuery}
            onChange={e => setTagQuery(e.target.value)}
            placeholder="搜索标签或输入自定义标签…"
            className="workbench-input w-full !pl-8 !pr-2 text-xs !h-7"
          />
        </div>
        <button
          type="button" onClick={runTagSuggestion} disabled={tagSuggesting || !hasVocab} title="AI 匹配标签"
          className="neu-btn-xs is-info gap-1 shrink-0"
        >
          {tagSuggesting ? <span className="h-3 w-3 rounded-full border-2 border-[var(--accent)]/30 border-t-[var(--accent)] animate-spin" /> : <Sparkles size={11} />}
          AI 匹配
        </button>
      </div>

      {/* ── 第二层：已选过滤标签（有标签时才显示，视觉独立）── */}
      {hasSelected && (
        <div className="px-3 pb-2.5">
          <div className="flex items-start gap-1.5 rounded-lg px-2.5 py-2"
            style={{ background: 'color-mix(in oklch, var(--accent) 6%, transparent)', boxShadow: 'inset 0 1px 2px oklch(0.5 0.04 258 / 0.06)' }}>
            <div className="flex flex-wrap gap-1 flex-1 min-w-0">
              {selectedTags.map(t => (
                <span key={t} className="neu-tag is-on text-xs">
                  {t}
                  <button type="button" onClick={() => removeTag(t)} aria-label={`移除 ${t}`} className="neu-tag__x">
                    <X size={11} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
            </div>
            <button type="button" onClick={() => { markTagsEdited(); setSelectedTags([]); }} className="neu-btn-xs shrink-0">清空</button>
          </div>
        </div>
      )}

      {/* ── 第三层：可选词表（内凹滚动区）── */}
      {!hasVocab && (
        <p className="px-3 pb-3 text-[10px] leading-5 text-[var(--muted-foreground)]">暂无可选业务标签——供应商标签词表为空，请在「供应商管理」中先回填业务标签。</p>
      )}
      {hasVocab && (
        <div className="px-3 pb-3">
          {showCustomAdd && (
            <button type="button" onClick={() => addCustomTag(tagQuery)} className="neu-btn-xs is-info mb-2">
              <Plus size={11} />添加自定义标签：{q}
            </button>
          )}
          {filtered.length > 0 ? (
            <div className="flex max-h-[88px] flex-wrap content-start gap-1 overflow-y-auto rounded-lg px-2.5 py-2"
              style={{ background: 'oklch(0.968 0.01 258 / 0.45)', boxShadow: 'inset 1px 1px 4px oklch(0.52 0.05 258 / 0.08), inset -1px -1px 2px oklch(1 0 0 / 0.55)' }}>
              {[...filtered].sort((a, b) => b.count - a.count).map(t => {
                const on = selectedTags.includes(t.tag);
                return (
                  <button key={t.tag} type="button" onClick={() => toggleTag(t.tag)} title={`${t.count} 家供应商`}
                    className={`neu-tag text-xs ${on ? 'is-on' : ''}`}>
                    {t.tag}<span className="neu-tag__count">{t.count}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            q && !showCustomAdd ? <p className="text-[10px] text-[var(--muted-foreground)]">无匹配标签</p> : null
          )}
        </div>
      )}
    </div>
  );
}

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
  const [projects, setProjects] = useState<BidProjectOption[]>([]);
  const [projectId, setProjectId] = useState('');
  const [projectDetail, setProjectDetail] = useState<BidProjectDetail | null>(null);
  const [requirement, setRequirement] = useState('');
  // 业务标签多选：作为收敛候选池 + 喂给 AI/规则引擎的「适应性」维度。
  // 选项目后 / 文件分析后由 AI 预填，用户可删减、补充（含自定义标签）。
  const [tagVocab, setTagVocab] = useState<TagVocabularyItem[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagQuery, setTagQuery] = useState('');             // 标签搜索关键字
  const [tagSuggesting, setTagSuggesting] = useState(false); // AI 预选标签进行中
  const [tagsUserEdited, setTagsUserEdited] = useState(false); // 用户已手动改过标签 → 停止自动预填
  const tagsUserEditedRef = useRef(false);
  const markTagsEdited = () => { tagsUserEditedRef.current = true; setTagsUserEdited(true); };
  const toggleTag = (t: string) => { markTagsEdited(); setSelectedTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]); };
  const removeTag = (t: string) => { markTagsEdited(); setSelectedTags(prev => prev.filter(x => x !== t)); };
  const addCustomTag = (t: string) => { const v = t.trim(); if (!v) return; markTagsEdited(); setSelectedTags(prev => prev.includes(v) ? prev : [...prev, v]); setTagQuery(''); };
  const [maxCount, setMaxCount] = useState(3);
  const [loading, setLoading] = useState(false);
  const [reqGenerating, setReqGenerating] = useState(false);
  const reqGeneratedRef = useRef(false);
  // 结构化需求字段（替代单一 textarea：5 个独立输入区 → 组合为 requirement 字符串）
  const [reqOverview, setReqOverview] = useState('');
  const [reqScope, setReqScope] = useState('');
  const [reqQualification, setReqQualification] = useState('');
  const [reqSpecial, setReqSpecial] = useState('');
  const [reqOther, setReqOther] = useState('');
  const buildRequirement = useCallback(() => {
    const parts: string[] = [];
    if (reqOverview.trim()) parts.push(`【项目概况】\n${reqOverview.trim()}`);
    if (reqScope.trim()) parts.push(`【采购范围】\n${reqScope.trim()}`);
    if (reqQualification.trim()) parts.push(`【资质要求】\n${reqQualification.trim()}`);
    if (reqSpecial.trim()) parts.push(`【特殊要求】\n${reqSpecial.trim()}`);
    if (reqOther.trim()) parts.push(`【其他】\n${reqOther.trim()}`);
    return parts.join('\n\n');
  }, [reqOverview, reqScope, reqQualification, reqSpecial, reqOther]);
  const [showHistory, setShowHistory] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [savedHistoryId, setSavedHistoryId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [shareModal, setShareModal] = useState(false);
  const [shareNote, setShareNote] = useState('');
  const [shareSending, setShareSending] = useState(false);
  const [notifyTemplate, setNotifyTemplate] = useState({ title: '', body: '' });
  const [notifyChannels, setNotifyChannels] = useState<string[]>(['in_app', 'sms', 'phone']);
  const [notifyAiLoading, setNotifyAiLoading] = useState(false);
  const [notifySending, setNotifySending] = useState(false);
  const [notifyActiveSupplier, setNotifyActiveSupplier] = useState<string>('');
  // 逐供应商个性化消息（key=sid, value={title,body}）。缺失时回退到模板。
  const [notifyPerSupplier, setNotifyPerSupplier] = useState<Map<string, { title: string; body: string; phoneScript: string }>>(new Map());
  // 逐家无登录回执链接（RSVP）：generateNotificationContent 返回，{rsvpLink} 占位符替换源 + 发送时作站内信 link。
  const [notifyRsvpTokens, setNotifyRsvpTokens] = useState<Record<string, string>>({});
  // 回执看板（采购端查看供应商「参加/不参加」回执结果）
  const [rsvpList, setRsvpList] = useState<RsvpListResult | null>(null);

  const [error, setError] = useState('');
  const [result, setResult] = useState<SupplierSelectionResult | null>(null);
  const [shortlist, setShortlist] = useState<Map<string, { item: SupplierRecommendation; note: string }>>(new Map());
  const [step, setStepInner] = useState(project?.procurementMethod === '直接采购' ? 4 : 1);
  const [maxStepReached, setMaxStepReached] = useState(project?.procurementMethod === '直接采购' ? 4 : 1); // 历史最大步骤（允许回看后仍点击前进）
  const setStep = (s: number) => { setStepInner(s); setMaxStepReached(prev => Math.max(prev, s)); };
  // 谈判采购（从项目管理进入）在确认通知后增加附件选择步骤
  const neg = !!(project && project.procurementMethod === '谈判采购');
  const isDirect = !!(project && project.procurementMethod === '直接采购');
  const [isRerun, setIsRerun] = useState(false);
  const baseConfirmStep = neg ? 6 : 5;
  const attachStep = neg ? 5 : -1;
  // 多轮补选累积数据（须在动态步骤编号前声明）
  const [rerunHistory, setRerunHistory] = useState<Array<{ shortlist: Map<string, { item: SupplierRecommendation; note: string }>; confirmations: Map<string, 'pending' | 'confirmed' | 'declined'>; notifyPerSupplier: Map<string, { title: string; body: string; phoneScript: string }> }>>([]);
  const previousRerunShortlist = useMemo(() => {
    const m = new Map<string, { item: SupplierRecommendation; note: string }>();
    for (const h of rerunHistory) { for (const [k, v] of h.shortlist) m.set(k, v); }
    return m;
  }, [rerunHistory]);
  const previousRerunConfirmations = useMemo(() => {
    const m = new Map<string, 'pending' | 'confirmed' | 'declined'>();
    for (const h of rerunHistory) { for (const [k, v] of h.confirmations) m.set(k, v); }
    return m;
  }, [rerunHistory]);
  // 补选模式下步骤编号（动态：随 continueRerun 轮次递增）
  const rerunRound = rerunHistory.length; // 已完成的轮次数
  const firstRerunPickStep = baseConfirmStep + 1; // 第一轮补选候选（固定 = 步骤7/8），步骤6"下一步"用
  const rerunPickStep = baseConfirmStep + 1 + rerunRound * 3;     // 当前轮补选候选
  const rerunNotifyStep = baseConfirmStep + 2 + rerunRound * 3;   // 当前轮补选通知
  const finalConfirmStep = baseConfirmStep + 3 + rerunRound * 3;  // 当前轮供应商确认
  // 当前步骤所在的补选轮次索引：-1=非补选步骤，0/1/2...=第N轮
  const currentRerunRound = step > baseConfirmStep ? Math.floor((step - baseConfirmStep - 1) / 3) : -1;
  const isAnyRerunPick = step > baseConfirmStep && (step - baseConfirmStep - 1) % 3 === 0;
  const isAnyRerunNotify = step > baseConfirmStep && (step - baseConfirmStep - 2) % 3 === 0;
  const isAnyRerunConfirm = step > baseConfirmStep && (step - baseConfirmStep) % 3 === 0;
  // 动态步骤轨道
  const steps = useMemo(() => {
    const base: { num: number; label: string; desc: string }[] = [...(isDirect ? DIRECT_STEPS : neg ? NEGOTIATION_STEPS : STEPS)].map(s => ({ ...s }));
    if (!isRerun) return base;
    const baseRenumbered = base.map((s, i) => ({ ...s, num: i + 1 }));
    const lastIdx = baseRenumbered.length - 1;
    baseRenumbered[lastIdx] = { ...baseRenumbered[lastIdx], label: '正选确认并补选' };
      // 已完成的轮次：最后一步改名为「第N轮确认」
      for (let r = 0; r < rerunRound; r++) {
        RERUN_EXTRA_STEPS.forEach((e, i) => {
          const label = i === 2 ? `第${r + 1}轮确认` : e.label;
          baseRenumbered.push({ num: baseRenumbered.length + 1, label, desc: e.desc });
        });
      }
      // 当前轮次（最后一步永远是「供应商确认」）
      RERUN_EXTRA_STEPS.forEach((e, i) => {
        baseRenumbered.push({ num: baseRenumbered.length + 1, label: e.label, desc: e.desc });
      });
      return baseRenumbered;
    return baseRenumbered;
  }, [neg, isRerun, rerunRound]);
  // 日期解析：从 AI 提取的中文/ISO 格式字符串中提取日期和时分
  // 开标时间为单点时间："2026年3月27日14:00"→ {date, time}
  // 采购文件获取时间为区间："2026年3月23日9:00-2026年3月26日15:00"→ {startDate, startTime, endDate, endTime}
  const parseChineseDatetime = (raw: string | null | undefined) => {
    const s = (raw || '').trim();
    if (!s) return { date: '', time: '' };
    // 尝试 ISO 格式
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return { date: s.slice(0, 10), time: s.slice(11, 16) || '00:00' };
    }
    // 中文格式：2026年3月27日14:00
    const m = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日\s*(\d{1,2}):(\d{2})/);
    if (m) {
      return {
        date: `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`,
        time: `${String(Number(m[4])).padStart(2, '0')}:${m[5]}`,
      };
    }
    // 中文格式无时间：2026年3月27日
    const md = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (md) return { date: `${md[1]}-${String(Number(md[2])).padStart(2, '0')}-${String(Number(md[3])).padStart(2, '0')}`, time: '00:00' };
    return { date: s, time: '00:00' };
  };
  const parseChineseRange = (raw: string | null | undefined) => {
    const s = (raw || '').trim();
    if (!s) return { startDate: '', startTime: '00:00', endDate: '', endTime: '00:00' };
    // 按 - 或 至 分割
    const parts = s.split(/\s*[-–至]\s*/);
    if (parts.length >= 2) {
      const start = parseChineseDatetime(parts[0]);
      const end = parseChineseDatetime(parts[1]);
      return {
        startDate: start.date, startTime: start.time || '00:00',
        endDate: end.date, endTime: end.time || '00:00',
      };
    }
    // 未识别区间：整体当单点
    const single = parseChineseDatetime(s);
    return { startDate: single.date, startTime: single.time, endDate: '', endTime: '00:00' };
  };

  const initBid = parseChineseDatetime(project?.bidOpeningTime);
  const [bidDate, setBidDate] = useState(initBid.date);
  const [bidTime, setBidTime] = useState(initBid.time);

  const initAcquire = parseChineseRange(project?.documentAcquireTime);
  const [acquireStartDate, setAcquireStartDate] = useState(initAcquire.startDate);
  const [acquireStartTime, setAcquireStartTime] = useState(initAcquire.startTime);
  const [acquireEndDate, setAcquireEndDate] = useState(initAcquire.endDate);
  const [acquireEndTime, setAcquireEndTime] = useState(initAcquire.endTime);

  // 项目「采购文件」阶段附件（供"引用采购文件"勾选，排除审批/批准类文件）
  const projectTenderFiles = useMemo(() => {
    if (!project?.stages) return [];
    const tenderStages = project.stages.filter(s => s.stageKey === 'TENDER_DOCUMENT');
    return tenderStages.flatMap(stage =>
      (stage.attachments || [])
        .filter(a => {
          const n = a.fileName.toLowerCase();
          return !n.includes('审批') && !n.includes('批准') && !n.includes('申请');
        })
        .map(a => ({
          key: a.objectKey,
          fileName: a.fileName,
          fileSize: a.fileSize,
          stageName: stage.stageName,
          objectKey: a.objectKey,
        })),
    );
  }, [project?.stages]);

  // 附件选择步骤状态
  const [attachFiles, setAttachFiles] = useState<{ id: string; name: string; size: number }[]>([]);
  const [attachUploading, setAttachUploading] = useState(false);
  // 引用采购文件（勾选项目各阶段已上传的附件）
  const [refFileKeys, setRefFileKeys] = useState<Set<string>>(new Set());
  // 采购文件下载方式：免费 / 解密密码 / 付费
  const [downloadMode, setDownloadMode] = useState<'free' | 'encrypted' | 'paid'>('free');
  const [downloadPassword, setDownloadPassword] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  // 项目时间确认
  const [timeConfirmed, setTimeConfirmed] = useState(false);
  // 确认配置下发状态
  const [configSending, setConfigSending] = useState(false);
  const [configSent, setConfigSent] = useState(false);

  // ── 补选状态 ──
  const [showRerunDialog, setShowRerunDialog] = useState(false);
  const [rerunMode, setRerunMode] = useState<'ai' | 'manual'>('ai');
  const [rerunShortlist, setRerunShortlist] = useState<Map<string, { item: SupplierRecommendation; note: string }>>(new Map());
  const [rerunResult, setRerunResult] = useState<SupplierSelectionResult | null>(null);
  const [rerunLoading, setRerunLoading] = useState(false);
  const [rerunManualSearch, setRerunManualSearch] = useState('');
  const [rerunManualSuppliers, setRerunManualSuppliers] = useState<Supplier[]>([]);
  const [showRerunManualAdd, setShowRerunManualAdd] = useState(false);
  const [rerunManualLoading, setRerunManualLoading] = useState(false);
  const [rerunNotifyPerSupplier, setRerunNotifyPerSupplier] = useState<Map<string, { title: string; body: string; phoneScript: string }>>(new Map());
  const [rerunNotified, setRerunNotified] = useState(false);
  const [rerunConfirmations, setRerunConfirmations] = useState<Map<string, 'pending' | 'confirmed' | 'declined'>>(new Map());
  const [rerunNotifySending, setRerunNotifySending] = useState(false);
  const patchOnce = useRef(false);
  const loadRsvpList = useCallback(async () => {
    const bidId = projectId;
    const pmId = (project as any)?.id;
    const ids = [...new Set([bidId, pmId].filter(Boolean))];
    if (ids.length === 0) { setRsvpList(null); return; }
    try {
      // 查询所有 id 空间并合并：先按 rsvpNo 去重，再按 supplierId 去重（跨 id 空间的重复行，
      // 优先保留已回复的行，确保通知链接的状态与确认页面一致）
      const mergeResults = (results: (RsvpListResult | null)[]): RsvpListResult => {
        const seenRsvpNo = new Set<string>();
        const allItems: RsvpListItem[] = [];
        for (const r of results) {
          if (!r) continue;
          for (const item of r.items) {
            if (!seenRsvpNo.has(item.rsvpNo)) {
              seenRsvpNo.add(item.rsvpNo);
              allItems.push(item);
            }
          }
        }
        // 按 supplierId 去重：同一供应商多行时，优先保留已回复（ACCEPTED/DECLINED）的行
        const bySupplier = new Map<string, RsvpListItem>();
        for (const item of allItems) {
          const existing = bySupplier.get(item.supplierId);
          if (!existing) {
            bySupplier.set(item.supplierId, item);
          } else if (existing.status === 'PENDING' && item.status !== 'PENDING') {
            bySupplier.set(item.supplierId, item); // 用已回复行替换 PENDING 行
          }
        }
        const items = [...bySupplier.values()];
        const counts = { ACCEPTED: 0, DECLINED: 0, PENDING: 0 };
        for (const item of items) {
          if (item.status in counts) (counts as Record<string, number>)[item.status]++;
        }
        return { total: items.length, counts, items };
      };
      const results = await Promise.all(ids.map(id => getRsvpList({ projectId: id }).catch(() => null)));
      let data = mergeResults(results);
      if (!patchOnce.current) {
        const allIds = [...shortlist.keys(), ...previousRerunShortlist.keys(), ...rerunShortlist.keys()];
        if (allIds.length > 0) {
          const existingIds = new Set(data.items.map(it => it.supplierId));
          const missing = allIds.filter(sid => !existingIds.has(sid));
          if (missing.length > 0) {
            patchOnce.current = true;
            const snames = missing.map(sid => shortlist.get(sid)?.item.name || previousRerunShortlist.get(sid)?.item.name || rerunShortlist.get(sid)?.item.name || '').filter(Boolean);
            if (snames.length > 0) {
              try {
                const canonicalId = bidId || pmId;
                await generateNotificationContent({ supplierNames: snames, supplierIds: missing, projectName: project?.title || undefined, projectId: canonicalId, validityDays: 1 });
                const results2 = await Promise.all(ids.map(id => getRsvpList({ projectId: id }).catch(() => null)));
                data = mergeResults(results2);
              } catch {}
            }
          }
        }
      }
      setRsvpList(data);
    } catch { setRsvpList(null); }
  }, [projectId, project, project?.title, shortlist, previousRerunShortlist, rerunShortlist, getRsvpList]);
  // 多轮补选累积数据
  // 进入「确认/回执」步骤时自动刷新看板（供应商可能已陆续回执）——须在 step 声明之后。
  useEffect(() => { if (step === baseConfirmStep || step === finalConfirmStep) void loadRsvpList(); }, [step, loadRsvpList, baseConfirmStep, finalConfirmStep]);
  // 在确认/回执步骤时，每 30 秒自动刷新 RSVP 回执状态
  useEffect(() => {
    if (step !== baseConfirmStep && step !== finalConfirmStep) return;
    const timer = setInterval(() => void loadRsvpList(), 30_000);
    return () => clearInterval(timer);
  }, [step, baseConfirmStep, finalConfirmStep, loadRsvpList]);
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
  const [showManualAdd, setShowManualAdd] = useState(false);
  // 增选（手动模式下追加推荐）
  const [addMoreOpen, setAddMoreOpen] = useState(false);
  const [addMoreCount, setAddMoreCount] = useState(1);
  const [addMoreLoading, setAddMoreLoading] = useState(false);
  // 记录增选追加的供应商 ID，渲染时标注来源
  const [addMoreIds, setAddMoreIds] = useState<Set<string>>(new Set());

  // 项目文件分析上下文（用于 AI 润色时提供真实文件内容）
  const [fileContextLoaded, setFileContextLoaded] = useState(false);
  const [fileAnalysisContext, setFileAnalysisContext] = useState('');

  // 供应商详情弹窗
  const [detailSupplier, setDetailSupplier] = useState<SupplierRecommendation | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<any>(null);

  const openSupplierDetail = async (r: SupplierRecommendation) => {
    setDetailSupplier(r);
    setDetailData(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/supplier/${r.supplierId}`, { credentials: 'include', headers: { 'X-Portal': 'web' } });
      if (res.ok) setDetailData(await res.json());
    } catch { /* 静默 */ }
    setDetailLoading(false);
  };

  useEffect(() => { listBidProjects().then(setProjects).catch(() => {}); getTagVocabulary(60).then(r => setTagVocab(r.items)).catch((e) => { console.warn('getTagVocabulary failed:', e); }); }, []);

  // 从项目管理弹窗进入时，自动将 projectId 解析为 BidProject id（规范 id 空间），
  // 确保 rsvp 行的创建/读取与开标确认面板始终一致。
  useEffect(() => {
    if (!project?.id || projectId || projects.length === 0) return;
    const match = projects.find(p => p.projectManagementItemId === project.id);
    if (match) setProjectId(match.id);
  }, [project?.id, projectId, projects]);

  // 恢复上次会话状态（从详情页返回时不丢失），按项目 ID 分桶
  const sessionKey = `supplier-selection-state${project?.id ? `:${project.id}` : ''}`;
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const saved = localStorage.getItem(sessionKey);
      if (saved) {
        const state = JSON.parse(saved);
        if (state.requirement) setRequirement(state.requirement);
        if (state.reqOverview) setReqOverview(state.reqOverview);
        if (state.reqScope) setReqScope(state.reqScope);
        if (state.reqQualification) setReqQualification(state.reqQualification);
        if (state.reqSpecial) setReqSpecial(state.reqSpecial);
        if (state.reqOther) setReqOther(state.reqOther);
        if (Array.isArray(state.addMoreIdsArr)) setAddMoreIds(new Set(state.addMoreIdsArr));
        if (Array.isArray(state.selectedTags)) {
          setSelectedTags(state.selectedTags);
          if (state.selectedTags.length) markTagsEdited(); // 恢复的标签视为用户意图，避免 AI 覆盖
        }
        if (state.projectId) setProjectId(state.projectId);
        if (state.result) setResult(state.result);
        if (state.step) setStepInner(isDirect ? Math.max(state.step, 4) : state.step);
        if (state.maxStepReached) setMaxStepReached(isDirect ? Math.max(state.maxStepReached, 4) : state.maxStepReached);
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
        if (state.notifyPerSupplierArr) {
          const m = new Map<string, { title: string; body: string; phoneScript: string }>();
          (state.notifyPerSupplierArr as [string, { title: string; body: string; phoneScript: string }][]).forEach(([k, v]) => m.set(k, v));
          setNotifyPerSupplier(m);
        }
        if (state.notifyRsvpTokens) setNotifyRsvpTokens(state.notifyRsvpTokens);
        if (state.manualSearch) setManualSearch(state.manualSearch);
        if (state.manualSuppliers) setManualSuppliers(state.manualSuppliers);
        if (state.manualTotal) setManualTotal(state.manualTotal);
        // 恢复补选状态
        if (state.isRerun) setIsRerun(true);
        if (state.rerunMode) setRerunMode(state.rerunMode);
        if (Array.isArray(state.rerunHistoryArr)) {
          setRerunHistory(state.rerunHistoryArr.map((h: any) => {
            const sl = new Map<string, { item: SupplierRecommendation; note: string }>();
            (h.shortlistArr as [string, any][]).forEach(([k, v]) => sl.set(k, v));
            const cm = new Map<string, 'pending' | 'confirmed' | 'declined'>();
            (h.confirmationsArr as [string, string][]).forEach(([k, v]) => cm.set(k, v as 'pending' | 'confirmed' | 'declined'));
            const nps = new Map<string, { title: string; body: string; phoneScript: string }>();
            if (Array.isArray(h.notifyPerSupplierArr)) (h.notifyPerSupplierArr as [string, { title: string; body: string; phoneScript: string }][]).forEach(([k, v]) => nps.set(k, v));
            return { shortlist: sl, confirmations: cm, notifyPerSupplier: nps };
          }));
        }
        if (state.rerunResult) setRerunResult(state.rerunResult);
                if (state.rerunNotified) setRerunNotified(true);
        if (state.rerunShortlistArr) {
          const m = new Map<string, { item: SupplierRecommendation; note: string }>();
          (state.rerunShortlistArr as [string, any][]).forEach(([k, v]) => m.set(k, v));
          setRerunShortlist(m);
        }
        if (state.rerunConfirmationsArr) {
          const cm = new Map<string, 'pending' | 'confirmed' | 'declined'>();
          (state.rerunConfirmationsArr as [string, string][]).forEach(([k, v]) => cm.set(k, v as 'pending' | 'confirmed' | 'declined'));
          setRerunConfirmations(cm);
        }
        if (state.rerunNotifyPerSupplierArr) {
          const m = new Map<string, { title: string; body: string; phoneScript: string }>();
          (state.rerunNotifyPerSupplierArr as [string, { title: string; body: string; phoneScript: string }][]).forEach(([k, v]) => m.set(k, v));
          setRerunNotifyPerSupplier(m);
        }
        // 恢复附件 + 下载方式 + 时间确认
        if (state.configSent) setConfigSent(true);
        if (state.timeConfirmed) setTimeConfirmed(true);
        if (Array.isArray(state.attachFiles)) setAttachFiles(state.attachFiles);
        if (Array.isArray(state.refFileKeys)) setRefFileKeys(new Set(state.refFileKeys));
        if (state.downloadMode) setDownloadMode(state.downloadMode);
        if (state.downloadPassword) setDownloadPassword(state.downloadPassword);
        if (state.paidAmount) setPaidAmount(state.paidAmount);
      }
    } catch {}
  }, []);

  // 直接采购：自动注入候选人列表。供应商名来源：awardedSupplier > 采购文件编写草稿 > 后端提取
  const directInjectDone = useRef(false);
  useEffect(() => {
    if (directInjectDone.current) return;
    if (!isDirect) return;
    if (!project) return;
    if (shortlist.size > 0) return; // 会话已恢复，不覆盖

    // 来源 1：DB 已提取的 awardedSupplier
    let supplierName = project.awardedSupplier?.trim();

    // 来源 2：采购文件编写草稿（localStorage）
    if (!supplierName) {
      try {
        const raw = localStorage.getItem(`tender-write:project-drafts:v1:${project.id}`);
        if (raw) {
          supplierName = (JSON.parse(raw)?.SINGLE_SOURCE as Record<string, string>)?.supplierName?.trim();
        }
      } catch {}
    }

    if (supplierName) {
      directInjectDone.current = true;
      const sid = `direct-${project.id}`;
      const m = new Map<string, { item: SupplierRecommendation; note: string }>();
      m.set(sid, { item: { supplierId: sid, name: supplierName, matchScore: 100, reason: '直接采购已定供应商', activeProjects: 1 }, note: '' });
      setShortlist(m);
      return;
    }

    // 来源 3：后端异步提取
    const tenderStage = project.stages?.find((s: any) => s.stageKey === 'TENDER_DOCUMENT');
    if (tenderStage?.attachments?.length) {
      extractTenderFields(project.id)
        .then((result: any) => {
          const name = result?.awardedSupplier?.trim();
          if (name) {
            directInjectDone.current = true;
            const sid = `direct-${project.id}`;
            const m = new Map<string, { item: SupplierRecommendation; note: string }>();
            m.set(sid, { item: { supplierId: sid, name, matchScore: 100, reason: '直接采购已定供应商', activeProjects: 1 }, note: '' });
            setShortlist(m);
          }
        })
        .catch(() => {});
    }
  }, [isDirect, project?.id, shortlist.size]);

  // 输入状态变化时持久化到 localStorage（跳过首次渲染，避免覆盖恢复的状态）
  const firstPersistSkip = useRef(true);
  // 将结构化字段合并为单一依赖，避免 useEffect deps 数组长度在 HMR 时变化
  const requirementSnapshot = JSON.stringify({ requirement, reqOverview, reqScope, reqQualification, reqSpecial, reqOther });
  const addMoreIdsSnapshot = JSON.stringify([...addMoreIds].sort());
  useEffect(() => {
    if (firstPersistSkip.current) { firstPersistSkip.current = false; return; }
    try {
      localStorage.setItem(sessionKey, JSON.stringify({
        requirement, reqOverview, reqScope, reqQualification, reqSpecial, reqOther, selectedTags, projectId, step, maxStepReached,
        addMoreIdsArr: [...addMoreIds],
        result: result ? { ...result, recommendations: result.recommendations.slice(0, 20) } : null,
        shortlistArr: [...shortlist.entries()],
        notified, notifyNotFound, completed,
        confirmationsArr: [...confirmations.entries()],
        selectionMode,
        notifyPerSupplierArr: [...notifyPerSupplier.entries()],
        notifyRsvpTokens,
        manualSearch, manualSuppliers, manualTotal,
        // 补选状态
        isRerun,
        rerunShortlistArr: [...rerunShortlist.entries()],
        rerunConfirmationsArr: [...rerunConfirmations.entries()],
        rerunResult: rerunResult ? { ...rerunResult, recommendations: rerunResult.recommendations.slice(0, 20) } : null,
        rerunNotified,
        rerunNotifyPerSupplierArr: [...rerunNotifyPerSupplier.entries()],
        rerunMode,
        rerunHistoryArr: rerunHistory.map(h => ({ shortlistArr: [...h.shortlist.entries()], confirmationsArr: [...h.confirmations.entries()], notifyPerSupplierArr: [...(h.notifyPerSupplier || new Map()).entries()] })),
        // 附件 + 下载方式 + 时间确认
        configSent, timeConfirmed,
        attachFiles, refFileKeys: [...refFileKeys],
        downloadMode, downloadPassword, paidAmount,
      }));
    } catch {}
  }, [requirementSnapshot, selectedTags, projectId, step, maxStepReached, result, shortlist, notified, notifyNotFound, completed, confirmations, selectionMode, notifyPerSupplier, notifyRsvpTokens, manualSearch, manualSuppliers, manualTotal, isRerun, rerunShortlist, rerunConfirmations, rerunResult, rerunNotified, rerunNotifyPerSupplier, rerunMode, rerunHistory.length, configSent, timeConfirmed, attachFiles, refFileKeys, downloadMode, downloadPassword, paidAmount, addMoreIdsSnapshot]);
  useEffect(() => { if (!projectId) { setProjectDetail(null); return; } getBidProjectDetail(projectId).then(setProjectDetail).catch(() => setProjectDetail(null)); }, [projectId]);

  // 加载项目文件分析上下文（用于 AI 润色 + 标签预选；步骤 1 即加载，手动模式据此预填标签）
  useEffect(() => {
    if (!project?.id || fileContextLoaded) return;
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
  }, [project?.id, fileContextLoaded, project?.title]);
  const selectedProject = useMemo(() => projects.find(p => p.id === projectId), [projects, projectId]);

  // ── 业务标签 AI 预填 ──────────────────────────────────────────────
  // 选项目后（AI 模式）/ 文件分析后（手动模式）调用 LLM 从词表预选标签；
  // 用户一旦手动删减/补充即停止自动预填，可点「AI 匹配」重新触发。
  const runTagSuggestion = useCallback(async () => {
    const vocab = tagVocab.map(t => t.tag);
    if (vocab.length === 0) return;
    if (!selectedProject && !project) return;
    if (tagsUserEditedRef.current) return;
    setTagSuggesting(true);
    try {
      const { tags } = await suggestBusinessTags({
        projectName: selectedProject?.name ?? project?.title,
        projectCode: selectedProject?.projectCode,
        procurementMethod: selectedProject?.procurementMethod,
        stage: selectedProject?.stage,
        requirement: buildRequirement() || undefined,
        fileSummary: fileAnalysisContext || undefined,
        vocabulary: vocab,
      });
      if (!tagsUserEditedRef.current) setSelectedTags(tags);
    } catch {
      // 预填失败不阻断选取流程，用户仍可手动选择
    } finally {
      setTagSuggesting(false);
    }
  }, [tagVocab, selectedProject, project, requirementSnapshot, fileAnalysisContext]);

  // 切换/选定项目时重置「用户已编辑」标记并清空搜索（仅真实切换，跳过首挂以保留会话恢复的标签）
  const firstProjectRef = useRef(true);
  useEffect(() => {
    if (firstProjectRef.current) { firstProjectRef.current = false; return; }
    tagsUserEditedRef.current = false;
    setTagsUserEdited(false);
    setTagQuery('');
  }, [selectedProject?.id]);

  // AI 模式：选定项目后即预填（仅当尚无选中标签时）
  useEffect(() => {
    if (selectionMode !== 'ai' || !selectedProject || tagVocab.length === 0) return;
    if (tagsUserEditedRef.current) return;
    if (selectedTags.length > 0) return;
    runTagSuggestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProject?.id, selectionMode, tagVocab.length]);

  // 手动模式：文件分析完成后预填；无项目分析来源时退化为选定项目即预填（仅当尚无选中标签时）
  useEffect(() => {
    if (selectionMode !== 'manual' || tagVocab.length === 0) return;
    if (tagsUserEditedRef.current) return;
    if (selectedTags.length > 0) return;
    if (project?.id && !fileContextLoaded) return;
    if (!selectedProject && !project) return;
    runTagSuggestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileContextLoaded, selectionMode, tagVocab.length, selectedProject?.id, project?.id]);

  // 模态入口：自动匹配项目 ID；步骤由 session 恢复决定（首次进入=步骤 1，再次进入=上次步骤）
  const autoMatchedRef = useRef(false);
  useEffect(() => {
    if (!defaultProjectTitle || !projects.length || autoMatchedRef.current) return;
    const match = projects.find(p => p.name === defaultProjectTitle || p.name.includes(defaultProjectTitle) || defaultProjectTitle.includes(p.name));
    if (!match) return;
    autoMatchedRef.current = true;
    setProjectId(match.id);
    // 不强制跳步——首次进入停留在步骤 1，session 恢复由 restored effect 处理
  }, [defaultProjectTitle, projects]);

  // 构建项目上下文供 AI 深度理解采购需求（提升推荐匹配度）
  // requirementText 用于去重：已覆盖的内容不再重复传入
  const buildProjectContext = useCallback((requirementText?: string): Record<string, string> | undefined => {
    const ctx: Record<string, string> = {};
    const req = (requirementText || '').trim();
    // 判断 value 是否已被需求文本覆盖（子串匹配，任一方向）
    const isCovered = (value: string) => {
      if (!req || !value) return false;
      const v = value.trim();
      return v.length >= 8 && (req.includes(v) || v.includes(req));
    };

    // 元数据字段：始终传入（用户手写需求中极少包含）
    if (project?.title) ctx['项目名称'] = project.title;
    if (project?.procurementMethod) ctx['采购方式'] = project.procurementMethod;
    if (project?.procurementCategory) ctx['采购类别'] = project.procurementCategory;
    if (project?.requesterDepartment) ctx['需求部门'] = project.requesterDepartment;
    if (project?.budgetAmount != null) ctx['预算金额'] = `${Number(project.budgetAmount).toLocaleString('zh-CN')} 元`;

    // 内容字段：仅当需求文本未覆盖时才传入（避免重复膨胀 token）
    if (project?.projectReason && !isCovered(project.projectReason)) ctx['立项事由'] = project.projectReason;
    if (project?.supplierRequirements && !isCovered(project.supplierRequirements)) ctx['供方要求'] = project.supplierRequirements;
    if (project?.projectOverview && !isCovered(project.projectOverview)) ctx['采购内容'] = project.projectOverview;
    if (project?.biddingUnits && !isCovered(project.biddingUnits)) ctx['投标单位'] = project.biddingUnits;

    // 文件分析摘要来自 docx 解析，用户需求文本中不包含 → 始终传入
    if (fileAnalysisContext) ctx['文件分析摘要'] = fileAnalysisContext;

    return Object.keys(ctx).length > 0 ? ctx : undefined;
  }, [project, fileAnalysisContext]);

  const run = async () => {
    const text = buildRequirement();
    if (!text) { setError('请至少填写一项采购需求'); return; }
    setError(''); setLoading(true); setResult(null);
    try {
      const res = await recommendSuppliers({ requirement: text, tags: selectedTags.length ? selectedTags : undefined, maxCount, projectContext: buildProjectContext(text) });
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

  /** 增选：在手动模式下，排除已入围供应商，追加推荐 */
  const handleAddMore = async () => {
    setAddMoreLoading(true);
    setAddMoreOpen(false);
    try {
      const text = buildRequirement() || selectedProject?.name || project?.title || '采购需求';
      const excludeIds = [...new Set([...shortlist.keys(), ...(result?.recommendations || []).map(r => r.supplierId)])];
      const res = await recommendSuppliers({
        requirement: text,
        tags: selectedTags.length ? selectedTags : undefined,
        maxCount: addMoreCount,
        excludedSupplierIds: excludeIds,
        projectContext: buildProjectContext(text),
      });
      if (res.recommendations.length > 0) {
        setResult(prev => prev ? { ...prev, recommendations: [...prev.recommendations, ...res.recommendations] } : res);
        setAddMoreIds(prev => {
          const n = new Set(prev);
          res.recommendations.forEach(r => n.add(r.supplierId));
          return n;
        });
        toast.success(`已增选 ${res.recommendations.length} 家供应商`);
      } else {
        toast.warning('未找到新的候选供应商');
      }
    } catch (e: any) { toast.error(e?.message || '增选失败'); }
    setAddMoreLoading(false);
  };

  /** 将润色/模板文本按【标题】拆回结构化字段 */
  const parsePolishedResult = useCallback((text: string) => {
    const sections = text.split(/(?=【)/g);
    const map: Record<string, string> = {};
    for (const s of sections) {
      const m = s.match(/^【(.+?)】\n?([\s\S]*)/);
      if (m) map[m[1].trim()] = m[2].trim();
    }
    setReqOverview(map['项目概况'] || '');
    setReqScope(map['采购范围'] || '');
    setReqQualification(map['资质要求'] || '');
    setReqSpecial(map['特殊要求'] || '');
    setReqOther(map['其他'] || (Object.keys(map).length === 0 ? text.trim() : ''));
  }, []);

  const generateRequirement = useCallback(async () => {
    setReqGenerating(true);
    try {
      const contextParts: string[] = [];
      if (project) {
        contextParts.push('--- 采购需求阶段 ---');
        if (project.title) contextParts.push(`项目名称：${project.title}`);
        if (project.requesterDepartment) contextParts.push(`申请部门：${project.requesterDepartment}`);
        if (project.procurementCategory) contextParts.push(`采购类别：${project.procurementCategory}`);
        if (project.budgetAmount) contextParts.push(`预算金额：${Number(project.budgetAmount).toLocaleString('zh-CN')} 元`);
        if (project.demandProject) contextParts.push(`所属项目：${project.demandProject}`);
        if (project.demandContractNumber) contextParts.push(`合同编号：${project.demandContractNumber}`);
        contextParts.push('');
        contextParts.push('--- 采购立项阶段 ---');
        if (project.procurementMethod) contextParts.push(`采购方式：${project.procurementMethod}`);
        if (project.projectReason) contextParts.push(`立项事由：${project.projectReason}`);
        if (project.supplierRequirements) contextParts.push(`供应商资质要求：${project.supplierRequirements}`);
        if (project.initiationDate) contextParts.push(`立项日期：${project.initiationDate}`);
        if (project.projectOverview) contextParts.push(`项目概况：${project.projectOverview}`);
      }
      if (fileAnalysisContext) {
        contextParts.push('');
        contextParts.push('--- 采购文件阶段（招标文件/采购公告）---');
        contextParts.push(fileAnalysisContext);
      }
      const additionalContext = contextParts.join('\n');
      const hasContent = !!(reqOverview.trim() || reqScope.trim() || reqQualification.trim() || reqSpecial.trim() || reqOther.trim());

      const prompt = hasContent
        ? `根据以下项目信息精简现有的采购需求描述，保持【】标题结构，每部分只保留最关键的1-3条要点（有多有少，不是固定3条），每条≤40字。\n\n现有内容：\n${buildRequirement()}`
        : `根据以下项目信息（来自采购需求、采购立项、采购文件），提炼一份精简的供应商采购需求。严格按以下格式输出，每部分1-3条（不是每部分都3条，具体看信息量），每条≤40字，只写核心关键信息，无法完整表述时取最重要的：\n\n【项目概况】\n1. 项目名+地点+预算（一句话≤40字）\n\n【采购范围】\n1. 采购了什么（一句话≤40字）\n\n【资质要求】\n1. 需要什么资质（一句话≤40字）\n\n【特殊要求】\n1. 特殊约束条件（一句话≤40字）\n\n【其他】\n（有则≤40字，无则留空）`;

      const res = await polishRequirement({
        text: prompt,
        projectName: selectedProject?.name || defaultProjectTitle || project?.title,
        procurementMethod: selectedProject?.procurementMethod || project?.procurementMethod,
        deadline: selectedProject?.deadline,
        additionalContext: additionalContext || undefined,
      });
      parsePolishedResult(res.polished);
      toast.success(hasContent ? '需求已润色' : '需求已生成');
    } catch (e: any) { toast.error(e?.message || '生成失败'); }
    setReqGenerating(false);
  }, [project, fileAnalysisContext, selectedProject, defaultProjectTitle, buildRequirement, parsePolishedResult]);

  // 首次进入步骤2时，若无内容则自动 AI 生成
  useEffect(() => {
    if (step !== 2 || reqGeneratedRef.current) return;
    if (reqOverview.trim() || reqScope.trim() || reqQualification.trim() || reqSpecial.trim() || reqOther.trim()) {
      reqGeneratedRef.current = true;
      return;
    }
    reqGeneratedRef.current = true;
    generateRequirement();
  }, [step, generateRequirement]);

  const handleApplyHistory = (record: SupplierSelectionHistoryRecord) => {
    setRequirement(record.requirement);
    parsePolishedResult(record.requirement);
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

  /** 构建通知上下文（正选 + 各轮补选共用，确保 RSVP 链接内容一致） */
  const buildNotifyContext = useCallback(() => {
    const ctxParts: string[] = [];
    if (fileAnalysisContext) ctxParts.push(fileAnalysisContext);
    const deadline = (selectedProject as any)?.deadline || (project as any)?.deadline || undefined;
    return {
      projectName: selectedProject?.name || project?.title,
      projectCode: (project as any)?.projectCode || selectedProject?.projectCode || undefined,
      deadline: deadline ? new Date(deadline).toLocaleDateString('zh-CN') : undefined,
      procurementMethod: project?.procurementMethod || (selectedProject as any)?.procurementMethod,
      procurementCategory: project?.procurementCategory,
      budgetAmount: project?.contractAmount != null
        ? `最高限价 ${Number(project.contractAmount).toLocaleString('zh-CN')}`
        : project?.budgetAmount ? `${Number(project.budgetAmount).toLocaleString('zh-CN')} 元` : undefined,
      requesterDepartment: project?.requesterDepartment,
      projectReason: project?.projectReason,
      supplierRequirements: (project as any)?.supplierRequirements,
      projectOverview: (project as any)?.projectOverview,
      fileAnalysisContext: ctxParts.join('\n') || undefined,
    };
  }, [fileAnalysisContext, selectedProject, project]);

  // 生成简短电话通知话术：提醒供应商查看短信或登录供应商门户点击链接确认是否参加。
  // 与站内/短信正文（body）分开——电话需口语化、简短，仅作提醒，不复述正文细节。
  const buildPhoneScript = (supplierName: string, ctx: ReturnType<typeof buildNotifyContext>) => {
    const proj = ctx.projectName ? `【${ctx.projectName}】` : '本次采购';
    const dl = ctx.deadline ? `，请于${ctx.deadline}前` : '';
    return `您好，请问是${supplierName}吗？我是四川水发集团采购中心。我们正在就${proj}项目邀请贵司参与，稍后将向贵司发送短信通知。请您留意查收短信，或登录供应商门户点击确认链接${dl}确认是否参加。如有疑问欢迎致电咨询，谢谢！`;
  };

  // 进入步骤 4（确认通知）时，若无内容自动 AI 生成（与补选步骤一致）
  const notifyAutoGenRef = useRef(false);
  useEffect(() => {
    if (step !== 4 || notified) return;
    if (notifyPerSupplier.size > 0) return;
    if (notifyAutoGenRef.current) return;
    if (shortlist.size === 0) return;
    notifyAutoGenRef.current = true;
    handleNotifyAi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, notified, notifyPerSupplier.size, shortlist.size]);

  const handleNotifyAi = async () => {
    setNotifyAiLoading(true);
    try {
      const names = [...shortlist.values()].map(v => v.item.name);
      const ids = [...shortlist.keys()];
      const ctx = buildNotifyContext();
      const res = await generateNotificationContent({
        ...ctx,
        supplierNames: names,
        supplierIds: ids,
        projectId: projectId || (project as any)?.id || null,
        validityDays: 1,
      });
      setNotifyTemplate({ title: res.title, body: res.body });
      setNotifyRsvpTokens(res.rsvpTokens || {});
      // 为每家供应商组装完整消息：抬头 + AI 正文（{rsvpLink} 逐家替换为专属回执链接）+ 落款
      const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
      const perSupplier = new Map<string, { title: string; body: string; phoneScript: string }>();
      for (const [sid, { item: r }] of shortlist) {
        const link = (res.rsvpTokens || {})[sid] || '';
        const bodyWithLink = res.body.replace(/\{rsvpLink\}/g, link);
        perSupplier.set(sid, {
          title: res.title,
          body: `${r.name} 您好！\n\n${bodyWithLink}\n\n四川水发集团\n${dateStr}`,
          phoneScript: buildPhoneScript(r.name, ctx),
        });
      }
      setNotifyPerSupplier(perSupplier);
      toast.success(`AI 已生成通知${Object.keys(res.rsvpTokens || {}).length > 0 ? '（含逐家回执链接）' : ''}`);
    } catch (e: any) { toast.error(e?.message || 'AI 生成失败'); }
    setNotifyAiLoading(false);
  };

  const handleNotify = async () => {
    if (notifyPerSupplier.size === 0) { toast.error('请先生成供应商通知内容'); return; }
    setNotifySending(true);
    try {
      // 为尚未生成 RSVP token 的供应商自动补签（手动编辑通知时未走 AI 生成，缺回执链接）
      const missingIds = [...shortlist.keys()].filter(sid => !notifyRsvpTokens[sid]);
      if (missingIds.length > 0) {
        try {
          const snames = missingIds.map(sid => shortlist.get(sid)?.item.name || '').filter(Boolean);
          const res = await generateNotificationContent({
            ...buildNotifyContext(),
            supplierNames: snames,
            supplierIds: missingIds,
            projectId: selectedProject?.id ?? projectId ?? (project as any)?.id ?? null,
            validityDays: 1,
          });
          if (res.rsvpTokens) setNotifyRsvpTokens(prev => ({ ...prev, ...res.rsvpTokens }));
        } catch {}
      }
      const ids = [...shortlist.keys()];
      // 站内/短信共用正文 body；电话渠道单独发简短话术 phoneScript
      const nonPhoneChannels = notifyChannels.filter(c => c !== 'phone');
      const phoneChannels = notifyChannels.filter(c => c === 'phone');
      let totalSent = 0;
      let totalNotFound = 0;
      for (const sid of ids) {
        const msg = getSupplierMessage(sid);
        if (!msg.title.trim() || !msg.body.trim()) continue;
        const link = notifyRsvpTokens[sid] || undefined; // 站内信点击直达该供应商专属回执页
        if (nonPhoneChannels.length) {
          const r = await notifySuppliers({ supplierIds: [sid], channels: nonPhoneChannels, type: 'SELECTION_NOTIFY', title: msg.title, content: msg.body, link });
          totalSent += r.sent || 1; totalNotFound += r.notFound || 0;
        }
        if (phoneChannels.length) {
          const r = await notifySuppliers({ supplierIds: [sid], channels: phoneChannels, type: 'SELECTION_NOTIFY', title: msg.title, content: msg.phoneScript || msg.body });
          totalSent += r.sent || 1; totalNotFound += r.notFound || 0;
        }
      }
      setNotified(true);
      setNotifyNotFound(totalNotFound);
      setCompleted(false);
      toast.success(`已通知 ${totalSent} 家供应商${totalNotFound > 0 ? `，${totalNotFound} 家未找到关联账户` : ''}`);
      setConfirmations(new Map([...shortlist.keys()].map(sid => [sid, 'pending' as const])));
      setStep(neg ? attachStep : baseConfirmStep);
      void loadRsvpList();
    } catch (e: any) { toast.error(e?.message || '通知发送失败'); }
    setNotifySending(false);
  };

  // 取某供应商的实际通知内容（无内容时返回空串，不降级到模板——模板概念已移除）
  const getSupplierMessage = (sid: string): { title: string; body: string; phoneScript: string } => {
    const m = notifyPerSupplier.get(sid);
    return m ? { title: m.title, body: m.body, phoneScript: m.phoneScript ?? '' } : { title: '', body: '', phoneScript: '' };
  };

  const handleShare = async () => {
    if (!shareNote.trim()) return;
    setShareSending(true);
    const shortlistData = [...shortlist.values()].map(({ item: r, note }) => ({ name: r.name, matchScore: r.matchScore, reason: r.reason }));
    try {
      await shareShortlist({ requirement: buildRequirement(), shortlist: shortlistData, note: shareNote.trim() || undefined });
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
  const moveRerunShortlistItem = (from: number, to: number) => {
    const entries = [...rerunShortlist.entries()]; if (to < 0 || to >= entries.length) return;
    const [moved] = entries.splice(from, 1); entries.splice(to, 0, moved); setRerunShortlist(new Map(entries));
  };
  const buildExportHeader = () => {
    const lines: string[] = [];
    lines.push('═══════════════════════════════════');
    lines.push('  供应商候选名单');
    lines.push('═══════════════════════════════════');
    if (project) {
      lines.push('');
      lines.push('【项目情况】');
      if (project.title) lines.push(`  项目名称：${project.title}`);
      if (project.procurementMethod) lines.push(`  采购方式：${project.procurementMethod}`);
      if (project.procurementCategory) lines.push(`  采购类别：${project.procurementCategory}`);
      if (project.requesterDepartment) lines.push(`  申请部门：${project.requesterDepartment}`);
      if (project.requesterName) lines.push(`  申请人：${project.requesterName}`);
      if (project.budgetAmount) lines.push(`  预算金额：${Number(project.budgetAmount).toLocaleString('zh-CN')} 元`);
      if (project.supplierRequirements) lines.push(`  供方要求：${project.supplierRequirements.slice(0, 300)}`);
      if (project.projectReason) lines.push(`  立项事由：${project.projectReason.slice(0, 300)}`);
    } else if (selectedProject) {
      lines.push('');
      lines.push('【项目情况】');
      if (selectedProject.name) lines.push(`  项目名称：${selectedProject.name}`);
      if (selectedProject.procurementMethod) lines.push(`  采购方式：${METHOD_LABELS[selectedProject.procurementMethod] || selectedProject.procurementMethod}`);
      if (selectedProject.projectCode) lines.push(`  项目编号：${selectedProject.projectCode}`);
    }
    lines.push('');
    lines.push('【选取原则】');
    if (selectionMode === 'ai') {
      lines.push(`  选取方式：AI 智能选取（基于采购需求语义匹配）`);
      if (selectedTags.length) lines.push(`  业务标签：${selectedTags.join('、')}`);
      if (result) {
        lines.push(`  候选池规模：${result.candidatePool} 家`);
        lines.push(`  匹配度区间：≥85 强匹配 / ≥70 较匹配 / ≥55 可考虑 / 弱匹配`);
      }
    } else {
      lines.push(`  选取方式：手动选取`);
      if (manualSearch) lines.push(`  搜索关键词：${manualSearch}`);
    }
    lines.push('');
    lines.push(`  候选数量：${shortlist.size} 家`);
    lines.push(`  导出时间：${new Date().toLocaleString('zh-CN')}`);
    lines.push('');
    lines.push('───────────────────────────────────');
    lines.push('');
    return lines.join('\n');
  };

  const buildExportText = () => {
    const header = buildExportHeader();
    const body = [...shortlist.entries()].map(([_, { item: r, note }], i) => {
      const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
      return [`${i + 1}. ${r.name}`,
        `   企业类型：${r.enterpriseType || '—'}  匹配度：${r.matchScore}${selectionMode === 'ai' ? `  ${scoreLabel(r.matchScore)}` : ''}`,
        `${r.reason !== '手动选取' ? `   推荐理由：${r.reason}` : ''}`,
        contact ? `   联系人：${contact.name} ${contact.phone}` : '',
        note ? `   备注：${note}` : '',
      ].filter(Boolean).join('\n');
    }).join('\n\n');
    return header + body;
  };
  const copyList = async () => { if (shortlist.size === 0) return; try { await navigator.clipboard.writeText(buildExportText()); toast.success('已复制到剪贴板'); } catch { toast.error('复制失败'); } };
  // 附件上传（谈判采购）
  const handleAttachUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAttachUploading(true);
    for (const f of Array.from(files)) {
      try {
        const fd = new FormData(); fd.append('file', f);
        const res = await fetch('/api/upload?category=general', { method: 'POST', credentials: 'include', headers: { 'X-Portal': 'web' }, body: fd });
        if (res.ok) { const data = await res.json(); setAttachFiles(prev => [...prev, { id: data.id, name: data.originalName || f.name, size: data.size || f.size }]); }
      } catch { toast.error(`「${f.name}」上传失败`); }
    }
    setAttachUploading(false);
  };

  // 确认配置：将谈判配置（时间/附件/下载方式）后台推送给供应商端
  const handleConfirmConfig = async () => {
    const pid = projectId || (project as any)?.id;
    if (!pid) { toast.error('未关联项目'); return; }
    setConfigSending(true);
    try {
      await sendNegotiationConfig({
        projectId: pid,
        supplierIds: [...shortlist.keys()],
        acquireStartTime: acquireStartDate && acquireStartTime ? `${acquireStartDate} ${acquireStartTime}` : '',
        acquireEndTime: acquireEndDate && acquireEndTime ? `${acquireEndDate} ${acquireEndTime}` : '',
        bidOpeningTime: bidDate && bidTime ? `${bidDate} ${bidTime}` : '',
        refFileKeys: [...refFileKeys],
        attachFileIds: attachFiles.map(f => f.id),
        downloadMode,
        downloadPassword: downloadMode === 'encrypted' ? downloadPassword : undefined,
        paidAmount: downloadMode === 'paid' ? paidAmount : undefined,
      });
      setConfigSent(true);
      toast.success('谈判配置已下发，供应商可在供应商端查看');
    } catch (e: any) {
      toast.error(e?.message || '配置下发失败');
    }
    setConfigSending(false);
  };

  const reset = () => { setStepInner(1); setMaxStepReached(1); setResult(null); setShortlist(new Map()); setNotified(false); setConfirmations(new Map()); setNotifyNotFound(0); setCompleted(false); setError(''); setFileContextLoaded(false); setFileAnalysisContext(''); setManualSearch(''); setManualSuppliers([]); setManualTotal(0); setNotifyRsvpTokens({}); setIsRerun(false); setRerunShortlist(new Map()); setRerunResult(null); setRerunConfirmations(new Map()); setRerunNotified(false); setRerunNotifyPerSupplier(new Map()); setRerunHistory([]); setConfigSent(false); setTimeConfirmed(false); setAttachFiles([]); setRefFileKeys(new Set()); setDownloadMode('free'); setDownloadPassword(''); setPaidAmount(''); setShowManualAdd(false); setShowRerunManualAdd(false); setAddMoreIds(new Set()); notifyAutoGenRef.current = false; try { localStorage.removeItem(`supplier-selection-state${project?.id ? `:${project.id}` : ''}`); } catch {} };

  // ── 补选 handlers ──
  const openRerun = () => setShowRerunDialog(true);
  const continueRerun = () => {
    setShowRerunDialog(true);
  };

  const confirmRerun = (mode: 'ai' | 'manual') => {
    // 将当前轮归档到历史记录（仅在用户实际选择补选方式后）
    if (rerunShortlist.size > 0) {
      setRerunHistory(prev => [...prev, { shortlist: new Map(rerunShortlist), confirmations: new Map(rerunConfirmations), notifyPerSupplier: new Map(rerunNotifyPerSupplier) }]);
    }
    setShowRerunDialog(false);
    setRerunMode(mode);
    if (!isRerun) setIsRerun(true);
    setRerunShortlist(new Map());
    setRerunResult(null);
    setRerunNotified(false);
    setRerunConfirmations(new Map());
    setRerunNotifyPerSupplier(new Map());
    // 目标步骤：当前轮归档后的新轮次第一步
    const willArchive = rerunShortlist.size > 0 ? 1 : 0;
    const nextRound = rerunHistory.length + willArchive;
    const targetPickStep = baseConfirmStep + 1 + nextRound * 3;
    setStep(targetPickStep);
    if (mode === 'manual') return;
    // 智能选取：沿用需求 + 标签，排除所有已选（正选+历史补选）
    // 补选数量 = 已放弃数 + 1（pending 不算，避免待确认者最终确认后多补）
    setRerunLoading(true);
    const excludeIds = [...shortlist.keys(), ...previousRerunShortlist.keys(), ...rerunShortlist.keys()];
    const totalDeclined = [...allSupplierStatuses.values()].filter(s => s === 'declined').length;
    const need = totalDeclined + 1;
    const rerunReq = buildRequirement() || selectedProject?.name || project?.title || '';
    recommendSuppliers({ requirement: rerunReq, tags: selectedTags.length ? selectedTags : undefined, maxCount: need, excludedSupplierIds: excludeIds, projectContext: buildProjectContext(rerunReq) })
      .then(res => { setRerunResult(res); setRerunLoading(false); })
      .catch(() => { setRerunLoading(false); toast.error('补选推荐失败'); });
  };

  const toggleRerunShortlist = (r: SupplierRecommendation) => {
    setRerunShortlist(prev => { const n = new Map(prev); n.has(r.supplierId) ? n.delete(r.supplierId) : n.set(r.supplierId, { item: r, note: '' }); return n; });
  };

  const toggleRerunManual = (s: Supplier) => {
    const sid = s.id;
    setRerunShortlist(prev => {
      const n = new Map(prev);
      if (n.has(sid)) { n.delete(sid); return n; }
      n.set(sid, { item: { supplierId: sid, name: s.name, matchScore: 0, reason: '手动补选', enterpriseType: (s as any).enterpriseType, contacts: (s as any).contacts || [], activeProjects: 0, classification: (s as any).classification?.name }, note: '' });
      return n;
    });
  };

  const handleRerunManualSearch = async () => {
    if (!rerunManualSearch.trim()) return;
    setRerunManualLoading(true);
    try {
      const res = await getSupplierList({ search: rerunManualSearch.trim(), status: 'APPROVED', pageSize: 20 });
      const items = (res as any).items ?? (res as any).data ?? res ?? [];
      setRerunManualSuppliers(Array.isArray(items) ? items : []);
    } catch { toast.error('供应商搜索失败'); }
    setRerunManualLoading(false);
  };

  // 补选手动搜索防抖（自动关联搜索）
  const rerunSearchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!rerunManualSearch.trim() || rerunMode !== 'manual' || step !== rerunPickStep) return;
    clearTimeout(rerunSearchTimerRef.current);
    rerunSearchTimerRef.current = setTimeout(() => { handleRerunManualSearch(); }, 300);
    return () => clearTimeout(rerunSearchTimerRef.current);
  }, [rerunManualSearch, rerunMode, step, rerunPickStep]);

  // 进入补选通知步骤时自动填充（仅首次无内容时触发）
  useEffect(() => {
    if (step !== rerunNotifyStep || !isRerun) return;
    if (rerunShortlist.size === 0 || notifyPerSupplier.size === 0) return;
    if (rerunNotifyPerSupplier.size > 0) return;
    fillRerunNotify();
  }, [step, rerunNotifyStep, isRerun, rerunShortlist, rerunNotifyPerSupplier.size, notifyPerSupplier, selectedProject, project, projectId]);

  const fillRerunNotify = async () => {
    // 无确认通知模板时不生成补选通知，渲染侧显示"请等待AI自动生成"
    if (notifyPerSupplier.size === 0) return;
    try {
      const sids = [...rerunShortlist.keys()];
      const snames = [...rerunShortlist.values()].map(({ item: r }) => r.name);
      const ctx = buildNotifyContext();
      // 生成 RSVP 链接（与正选共用完整上下文，保证链接内容一致）
      const res = await generateNotificationContent({
        ...ctx,
        supplierNames: snames,
        supplierIds: sids,
        projectId: projectId || (project as any)?.id || null,
        validityDays: 1,
      });
      // 保存补选供应商的 RSVP tokens（合并到 notifyRsvpTokens，发送站内信时作为 link）
      if (res.rsvpTokens) {
        setNotifyRsvpTokens(prev => ({ ...prev, ...res.rsvpTokens }));
      }
      // 延用确认通知中已有内容模板（取第一个已通知供应商的 body），仅替换名称和链接
      const existingMsg = [...notifyPerSupplier.values()][0];
      const tokens = { ...notifyRsvpTokens, ...(res.rsvpTokens || {}) };
      const perSupplier = new Map<string, { title: string; body: string; phoneScript: string }>();
      for (const [sid, { item: r }] of rerunShortlist) {
        const link = tokens[sid] || '';
        // 取已有模板 body，去掉第一行问候语（"XXX 您好！\n\n"），替换链接
        const parts = existingMsg.body.split('\n\n');
        const templateBody = parts.length > 1 ? parts.slice(1).join('\n\n') : existingMsg.body;
        const bodyWithLink = templateBody.replace(/\{rsvpLink\}/g, link).replace(
          /https?:\/\/localhost:3004\/rsvp\?t=[A-Za-z0-9]+/g, link,
        );
        perSupplier.set(sid, { title: existingMsg.title, body: `${r.name} 您好！\n\n${bodyWithLink}`, phoneScript: buildPhoneScript(r.name, ctx) });
      }
      setRerunNotifyPerSupplier(perSupplier);
    } catch {}
  };

  const handleRerunNotify = async () => {
    if (rerunNotifyPerSupplier.size === 0) { toast.error('请先生成补选通知内容'); return; }
    setRerunNotifySending(true);
    try {
      // 为尚未生成 RSVP token 的补选供应商补签（与正选 handleNotify 一致）
      const missingIds = [...rerunShortlist.keys()].filter(sid => !notifyRsvpTokens[sid]);
      if (missingIds.length > 0) {
        try {
          const snames = missingIds.map(sid => rerunShortlist.get(sid)?.item.name || '').filter(Boolean);
          const res = await generateNotificationContent({
            ...buildNotifyContext(),
            supplierNames: snames,
            supplierIds: missingIds,
            projectId: projectId || (project as any)?.id || null,
            validityDays: 1,
          });
          if (res.rsvpTokens) setNotifyRsvpTokens(prev => ({ ...prev, ...res.rsvpTokens }));
        } catch {}
      }
      // 站内/短信共用正文 body；电话渠道单独发简短话术 phoneScript
      const nonPhoneChannels = notifyChannels.filter(c => c !== 'phone');
      const phoneChannels = notifyChannels.filter(c => c === 'phone');
      let totalSent = 0;
      let totalNotFound = 0;
      for (const [sid, msg] of rerunNotifyPerSupplier) {
        if (!msg.title.trim() || !msg.body.trim()) continue;
        const link = notifyRsvpTokens[sid] || undefined; // 站内信点击直达回执页
        if (nonPhoneChannels.length) {
          const r = await notifySuppliers({ supplierIds: [sid], channels: nonPhoneChannels, type: 'SELECTION_NOTIFY', title: msg.title, content: msg.body, link }).catch(() => ({} as any));
          totalSent += r.sent ?? 1; totalNotFound += r.notFound || 0;
        }
        if (phoneChannels.length) {
          const r = await notifySuppliers({ supplierIds: [sid], channels: phoneChannels, type: 'SELECTION_NOTIFY', title: msg.title, content: msg.phoneScript || msg.body }).catch(() => ({} as any));
          totalSent += r.sent ?? 1; totalNotFound += r.notFound || 0;
        }
      }
      setRerunNotified(true);
      setRerunConfirmations(new Map([...rerunShortlist.keys()].map(sid => [sid, 'pending' as const])));
      toast.success(`已通知 ${totalSent} 家补选供应商${totalNotFound > 0 ? `，${totalNotFound} 家未找到关联账户` : ''}`);
      setStep(finalConfirmStep);
      void loadRsvpList();
    } catch (e: any) { toast.error(e?.message || '通知发送失败'); }
    setRerunNotifySending(false);
  };

  const setRerunConfirmation = (sid: string, st: 'confirmed' | 'declined' | 'pending') => {
    setRerunConfirmations(prev => { const n = new Map(prev); n.set(sid, st); return n; });
  };

  // 合并名单与确认状态（正选 + 历史补选 + 当前补选）
  const allShortlist = useMemo(() => new Map([...shortlist, ...previousRerunShortlist, ...rerunShortlist]), [shortlist, previousRerunShortlist, rerunShortlist]);

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
      localStorage.removeItem('supplier-selection-state');
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

  // 可复用：供应商确认行（带点击切换 + 正选/补选标记 + 联系人 + 回执码）
  const renderSupplierRow = (
    sid: string, r: SupplierRecommendation, idx: number,
    status: 'pending' | 'confirmed' | 'declined',
    onToggle: () => void,
    badge?: '正选' | '补选',
    roundLabel?: string,
    showTags?: boolean,
  ) => {
    const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
    const rsvpItem = filteredRsvp?.items.find(it => it.supplierId === sid);
    const isOriginal = badge === '正选';
    const tags = (r.tags || []).slice(0, 4);
    return (
      <div key={sid} className="flex items-center gap-3 rounded-xl px-4 py-3 transition-shadow"
        style={{ background: 'oklch(1 0 0 / 0.42)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5), 1px 1px 2px oklch(0.55 0.03 258 / 0.05)' }}>
        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] text-[10px] font-extrabold text-white tabular-nums"
          style={{ background: isOriginal ? 'linear-gradient(135deg, oklch(0.52 0.16 258), oklch(0.45 0.14 258))' : 'linear-gradient(135deg, oklch(0.55 0.14 150), oklch(0.48 0.12 150))' }}>{idx + 1}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-[var(--foreground)] truncate flex items-center gap-1.5">
            {r.name}
            {rsvpItem && <span className="text-[10px] font-mono text-[var(--muted-foreground)]">#{rsvpItem.rsvpNo}</span>}
          </div>
          <div className="text-[10px] text-[var(--muted-foreground)] tabular-nums">
            {showTags && tags.length > 0
              ? tags.map(t => (
                  <span key={t} className="inline-flex items-center rounded-[4px] px-1 py-0.5 mr-1 text-[9px] font-semibold"
                    style={{ background: 'color-mix(in oklch, var(--accent) 8%, transparent)', color: 'var(--accent-strong)' }}>{t}</span>
                ))
              : <>匹配 <span style={{ color: scoreVar(r.matchScore) }} className="font-bold">{r.matchScore}</span></>
            }
            {contact ? ` · ${contact.name} ${contact.phone}` : ''}
          </div>
        </div>
        {badge && <span className="text-[9px] font-bold rounded px-1.5 py-0.5 shrink-0" style={{ background: isOriginal ? 'color-mix(in oklch, var(--accent) 12%, transparent)' : 'color-mix(in oklch, var(--success) 12%, transparent)', color: isOriginal ? 'var(--accent-strong)' : 'var(--success)' }}>{roundLabel ? `${badge}${roundLabel}` : badge}</span>}
        <button onClick={onToggle} title="点击切换确认状态"
          className={`neu-btn-xs !py-1.5 !px-3 flex-shrink-0 ${status === 'confirmed' ? 'is-success' : status === 'declined' ? 'is-danger' : ''}`}>
          {status === 'confirmed' ? '已确认' : status === 'declined' ? '已放弃' : '待确认'}
        </button>
      </div>
    );
  };

  // 过滤 RSVP 列表：仅展示当前候选名单中供应商的回执记录
  // 同一供应商可能有多条 RSVP 记录（如多次生成通知），优先取已有回执结果的记录；
  // 若全部 PENDING 则取最新一条，确保已确认/已放弃的状态不被新生成的 PENDING 记录覆盖。
  const filteredRsvp = useMemo(() => {
    if (!rsvpList) return null;
    const supplierIds = new Set([...shortlist.keys(), ...previousRerunShortlist.keys(), ...rerunShortlist.keys()]);
    const latestBySupplier = new Map<string, typeof rsvpList.items[number]>();
    // rsvpList.items 按 createdAt desc 排序（最新在前）
    for (const it of rsvpList.items) {
      if (!supplierIds.has(it.supplierId)) continue;
      const existing = latestBySupplier.get(it.supplierId);
      if (!existing) { latestBySupplier.set(it.supplierId, it); continue; }
      // 如有已回执的记录优先保留（避免最新但未回执的记录覆盖已回执的旧记录）
      if (existing.status === 'PENDING' && it.status !== 'PENDING') {
        latestBySupplier.set(it.supplierId, it);
      }
    }
    if (latestBySupplier.size === 0) return null;
    const items = [...latestBySupplier.values()];
    const counts = { ACCEPTED: 0, DECLINED: 0, PENDING: 0 };
    for (const it of items) counts[it.status]++;
    return { ...rsvpList, total: items.length, items, counts };
  }, [rsvpList, shortlist, previousRerunShortlist, rerunShortlist]);

  // supplierId → RSVP 回执状态映射（供渲染时合并到 rerunHistory 的 confirmations）
  const rsvpStatusBySupplier = useMemo(() => {
    if (!filteredRsvp?.items) return new Map<string, 'pending' | 'confirmed' | 'declined'>();
    const m = new Map<string, 'pending' | 'confirmed' | 'declined'>();
    for (const it of filteredRsvp.items) {
      m.set(it.supplierId, it.status === 'ACCEPTED' ? 'confirmed' : it.status === 'DECLINED' ? 'declined' : 'pending');
    }
    return m;
  }, [filteredRsvp]);

  // 统一计算每个供应商的实际显示状态（正选/补选/历史补选），保证统计与行显示完全一致
  const allSupplierStatuses = useMemo(() => {
    const m = new Map<string, 'pending' | 'confirmed' | 'declined'>();
    // 正选：RSVP 已同步到 confirmations，直接取值
    for (const sid of shortlist.keys()) {
      const manual = confirmations.get(sid) || 'pending';
      const rsvp = rsvpStatusBySupplier.get(sid);
      m.set(sid, (rsvp && rsvp !== 'pending') ? rsvp : manual);
    }
    // 历史补选
    for (const h of rerunHistory) {
      for (const [sid] of h.shortlist) {
        const manual = h.confirmations.get(sid) || 'pending';
        const rsvp = rsvpStatusBySupplier.get(sid);
        m.set(sid, (rsvp && rsvp !== 'pending') ? rsvp : manual);
      }
    }
    // 当前补选
    for (const sid of rerunShortlist.keys()) {
      const manual = rerunConfirmations.get(sid) || 'pending';
      const rsvp = rsvpStatusBySupplier.get(sid);
      m.set(sid, (rsvp && rsvp !== 'pending') ? rsvp : manual);
    }
    return m;
  }, [shortlist, confirmations, rerunHistory, rerunShortlist, rerunConfirmations, rsvpStatusBySupplier]);

  const allConfirmationStats = useMemo(() => {
    let confirmed = 0, declined = 0;
    for (const s of allSupplierStatuses.values()) {
      if (s === 'confirmed') confirmed++;
      else if (s === 'declined') declined++;
    }
    return { confirmed, declined, pending: allSupplierStatuses.size - confirmed - declined, total: allSupplierStatuses.size };
  }, [allSupplierStatuses]);

  // 已废弃——用 allSupplierStatuses 替代
  const allConfirmations = allSupplierStatuses;

  // 同步 RSVP 回执到 confirmations/rerunConfirmations：
  // 缺失的条目补上，pending 的条目覆盖；已手动设为 confirmed/declined 的不覆盖。
  // 正选只写 confirmations，补选只写 rerunConfirmations——避免 allConfirmations 合并时 stale 历史 Map 覆盖正确值。
  const rerunSids = useMemo(() => new Set([...rerunShortlist.keys(), ...previousRerunShortlist.keys()]), [rerunShortlist, previousRerunShortlist]);
  useEffect(() => {
    if (!filteredRsvp?.items?.length) return;
    const syncFor = (prev: Map<string, 'pending' | 'confirmed' | 'declined'>, sidFilter: Set<string>) => {
      const n = new Map(prev);
      for (const item of filteredRsvp.items) {
        if (!sidFilter.has(item.supplierId)) continue;
        const rsvpStatus: 'pending' | 'confirmed' | 'declined' = item.status === 'ACCEPTED' ? 'confirmed' : item.status === 'DECLINED' ? 'declined' : 'pending';
        if (!n.has(item.supplierId) || n.get(item.supplierId) === 'pending') {
          n.set(item.supplierId, rsvpStatus);
        }
      }
      return n;
    };
    // 正选 confirmations：RSVP sync 只针对非补选供应商
    setConfirmations(prev => syncFor(prev, new Set(filteredRsvp.items.map(it => it.supplierId).filter(id => !rerunSids.has(id)))));
    // 补选 rerunConfirmations：RSVP sync 只针对补选供应商
    setRerunConfirmations(prev => syncFor(prev, rerunSids));
  }, [filteredRsvp, rerunSids]);

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
          {[...shortlist.entries()].map(([sid, { item: r }], idx) => {
            const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
            return (
              <div key={sid} className="rounded-[12px] p-2.5 flex items-center gap-2 transition-shadow"
                style={{ background: 'oklch(1 0 0 / 0.5)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5), 1px 1px 2px oklch(0.55 0.03 258 / 0.05)' }}>
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
            );
          })}
          <div className="flex gap-1.5 pt-1">
            {shortlist.size >= 2 && (
              <button onClick={() => setShowCompare(true)} className="neu-btn-xs w-0 flex-1 justify-center gap-1.5"><Columns3 size={11} />横向对比</button>
            )}
            <button onClick={setShortlist.bind(null, new Map())} className="neu-btn-xs is-danger w-0 flex-1 justify-center gap-1"><X size={11} />清空</button>
          </div>
        </div>
      )}
      {/* 步骤 3 导航按钮 */}
      {step === 3 && (
          <div className="flex items-center justify-between pt-3 border-t border-[oklch(0.6_0.04_258_/_0.12)]">
            <div className="flex items-center gap-2">
              <button onClick={() => setStep(selectionMode === 'manual' ? 1 : 2)} className="neu-btn-soft gap-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>上一步：{selectionMode === 'manual' ? '选择项目' : '描述需求'}
              </button>
            </div>
            <button onClick={() => setStep(4)} disabled={shortlist.size === 0} className="neu-btn-soft gap-2" title={shortlist.size === 0 ? '请先加入候选供应商' : undefined}>
              下一步：确认通知<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              {shortlist.size > 0 && <span className="tabular-nums">（{shortlist.size}）</span>}
            </button>
          </div>
      )}
    </div>
  );

  return (
    <div className="space-y-5 pb-8">
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
                  <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--success)]">2.</span>候选池粗筛：按业务标签、企业类型、历史评价分数进行合规过滤</li>
                  <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--success)]">3.</span>资质与能力评分：综合资质匹配度、历史履约评价、经营范围与项目契合度，形成 0-100 匹配分</li>
                  <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--success)]">4.</span>综合排序：按匹配度降序输出推荐列表，≥85 强匹配 / ≥70 较匹配 / ≥55 可考虑 / 弱匹配</li>
                  <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--success)]">5.</span>候选管理：支持加入/移除候选名单，拖拽排序，添加备注，导出为 TXT 名单</li>
                </ol>
              </RulesPopover>
            </div>
          </div>
        </div>
      )}

      {/* ══ 步骤轨道 ══ */}
      <StepTrack
        steps={steps}
        current={isDirect ? step - 3 : step}
        onStepClick={(s) => setStep(isDirect ? s + 3 : s)}
        reachable={(s) => {
          const si = isDirect ? s + 3 : s;
          if (si <= maxStepReached) return true;
          if (!isDirect && s === 3 && !!result) return true;
          if (isRerun) {
            if (si === rerunPickStep) return true;
            if (si === rerunNotifyStep && rerunShortlist.size > 0) return true;
            if (s === finalConfirmStep && rerunNotified) return true;
          }
          return false;
        }}
      />

      {error && step !== 3 && <div className="rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">{error}</div>}

      {/* ── 步骤 1：选择项目 + 业务标签 ── */}
      {step === 1 && (
        <div className="space-y-5">
          {/* 项目信息 — 独立顶部行，无 label */}
          {defaultProjectTitle ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-[var(--foreground)]">{defaultProjectTitle}</span>
              {project?.projectCode && (
                <span className="rounded-lg bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-strong)]">{project.projectCode}</span>
              )}
              {project?.procurementMethod && (
                <span className="rounded-lg bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-strong)]">{METHOD_LABELS[project.procurementMethod] || project.procurementMethod}</span>
              )}
            </div>
          ) : selectedProject && projectDetail ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-[var(--foreground)]">{selectedProject.name}</span>
              {selectedProject.projectCode && (
                <span className="rounded-lg bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-strong)]">{selectedProject.projectCode}</span>
              )}
              <span className="rounded-lg bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-strong)]">{METHOD_LABELS[selectedProject.procurementMethod] || selectedProject.procurementMethod}</span>
            </div>
          ) : (
            <select value={projectId} onChange={e => setProjectId(e.target.value)} className="workbench-input w-full text-sm">
              <option value="">不关联项目</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}

          <div className="rounded-[20px] p-5 space-y-4"
            style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.985 0.005 258 / 0.58) 40%, oklch(1 0 0 / 0.14) 75%)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.75), 2px 3px 8px oklch(0.55 0.03 258 / 0.1), -2px -2px 8px oklch(1 0 0 / 0.88)' }}>
            {/* 选取方式 — pill 容器（参考专家抽取抽取方式） */}
            <div>
              <div className="inline-flex items-center gap-2.5 rounded-xl bg-[color-mix(in_oklch,var(--surface)_70%,transparent)] py-1.5 pl-3.5 pr-1.5 shadow-[inset_0_1px_0_oklch(1_0_0/0.6),1.5px_1.5px_3px_oklch(0.55_0.03_258/0.08),-1px_-1px_2.5px_oklch(1_0_0/0.8)]">
                <span className="text-xs font-semibold text-[var(--muted-foreground)] whitespace-nowrap">选取方式</span>
                <div className="neu-tab-bar">
                  {(['ai', 'manual'] as const).map(mode => (
                    <button key={mode} type="button" onClick={() => { setSelectionMode(mode); setError(''); }}
                      className={`neu-tab px-3.5 py-1.5 text-xs font-bold ${selectionMode === mode ? 'is-active' : ''}`}>
                      {mode === 'ai' ? 'AI 智能选取' : '手动选取'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="wb-section-rule" />

            {/* 业务标签 */}
            {selectionMode === 'ai' && (
              <div>
                <label className="text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--muted-foreground)] block mb-1.5">业务标签</label>
                <BusinessTagsPicker
                  tagVocab={tagVocab} selectedTags={selectedTags} tagQuery={tagQuery} setTagQuery={setTagQuery}
                  tagSuggesting={tagSuggesting} runTagSuggestion={runTagSuggestion} markTagsEdited={markTagsEdited}
                  setSelectedTags={setSelectedTags} removeTag={removeTag} toggleTag={toggleTag} addCustomTag={addCustomTag}
                />
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button onClick={() => { setError(''); if (selectionMode === 'manual') { setStep(3); } else { setStep(2); } }} className="neu-btn-soft gap-2">
              下一步：{selectionMode === 'manual' ? '审核候选' : '描述需求'}<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* ── 步骤 2：描述需求 ── */}
      {step === 2 && (
        <div className="space-y-5">
          {/* 项目信息头 */}
          {selectedProject && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold text-[var(--foreground)]">{selectedProject.name}</span>
              {selectedProject.projectCode && (
                <span className="rounded-lg bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-strong)]">{selectedProject.projectCode}</span>
              )}
              <span className="rounded-lg bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 text-xs font-semibold text-[var(--accent-strong)]">{METHOD_LABELS[selectedProject.procurementMethod] || selectedProject.procurementMethod}</span>
            </div>
          )}

          {/* 结构化需求输入卡 */}
          <div className="rounded-[20px] p-6 space-y-5"
            style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.985 0.005 258 / 0.58) 40%, oklch(1 0 0 / 0.14) 75%)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.75), 2px 3px 8px oklch(0.55 0.03 258 / 0.1), -2px -2px 8px oklch(1 0 0 / 0.88)' }}>
            {/* 标题行 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-[9px]" style={{ background: 'color-mix(in oklch, var(--accent) 12%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5), 1px 1px 2px oklch(0.55 0.03 258 / 0.06)' }}>
                  <FileText size={13} className="text-[var(--accent)]" />
                </span>
                <span className="text-sm font-bold text-[var(--foreground)]">采购需求描述</span>
              </div>
              <button onClick={generateRequirement} disabled={reqGenerating} className="neu-btn-xs gap-1.5 text-[var(--accent)]">
                <Sparkles size={11} />{reqGenerating ? 'AI 生成中…' : '重新生成'}
              </button>
            </div>

            <div className="wb-section-rule" />

            {/* 1. 项目概况 */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--foreground)]">项目概况</label>
              <p className="text-[10px] text-[var(--muted-foreground)] leading-relaxed">点明采购事项及所属行业领域，作为供应商寻源的方向参照。</p>
              <AutoTextarea
                value={reqOverview}
                onChange={e => setReqOverview(e.target.value)}
                placeholder="示例：1. 本次寻源面向地质勘查装备制造领域的供应商\n2. 采购800型便携式全液压岩心钻机1台套\n3. 供应商经营范围应覆盖地质勘探设备、岩心钻机类产品\n4. 交付地：四川成都"
              />
            </div>

            {/* 2. 采购范围 */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--foreground)]">采购范围</label>
              <p className="text-[10px] text-[var(--muted-foreground)] leading-relaxed">说明需要供应商提供什么、其经营范围应覆盖哪些业务。</p>
              <AutoTextarea
                value={reqScope}
                onChange={e => setReqScope(e.target.value)}
                placeholder="示例：1. 供应商应提供800型全液压岩心钻机主机及配套钻具\n2. 经营范围覆盖地质勘探设备、岩心钻机类产品\n3. 含运输、安装调试及操作培训服务"
              />
            </div>

            {/* 3. 资质要求 */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--foreground)]">资质要求</label>
              <p className="text-[10px] text-[var(--muted-foreground)] leading-relaxed">供应商应具备的企业类型、行业资质、业绩门槛与技术能力。</p>
              <AutoTextarea
                value={reqQualification}
                onChange={e => setReqQualification(e.target.value)}
                placeholder="示例：1. 须为钻探设备制造商或授权代理商\n2. 产品通过 ISO 9001 质量管理体系认证\n3. 近三年具有至少 3 个同类型钻机供货业绩"
              />
            </div>

            {/* 4. 特殊要求 */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--foreground)]">特殊要求</label>
              <p className="text-[10px] text-[var(--muted-foreground)] leading-relaxed">对供应商的服务响应、交付周期、质保等能力要求。</p>
              <AutoTextarea
                value={reqSpecial}
                onChange={e => setReqSpecial(e.target.value)}
                placeholder="示例：1. 供货周期不超过 90 日历天\n2. 整机质保期不低于 2 年\n3. 需提供 7×24 小时售后技术支持\n4. 海拔 3500m 以上高原适应性要求"
              />
            </div>

            {/* 5. 其他 */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[var(--foreground)]">其他</label>
              <p className="text-[10px] text-[var(--muted-foreground)] leading-relaxed">其他需要补充说明的事项或备注信息。</p>
              <AutoTextarea
                value={reqOther}
                onChange={e => setReqOther(e.target.value)}
                placeholder="如有其他补充信息，请在此填写…"
                minRows={1}
              />
            </div>
          </div>

          {error && <div className="rounded-xl px-4 py-3 text-sm font-semibold text-[var(--danger)]" style={{ background: 'color-mix(in oklch, var(--danger) 8%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.3)' }}>{error}</div>}

          {/* 底部操作栏 */}
          <div className="flex items-center justify-between gap-3">
            <button onClick={() => setStep(1)} className="neu-btn-soft gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>上一步：选择项目
            </button>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--muted-foreground)]">
                <span>推荐</span>
                <select value={maxCount} onChange={e => setMaxCount(Number(e.target.value))} className="workbench-input !w-[60px] text-xs !h-7">
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
                <span>家供应商</span>
              </div>
              <button onClick={run} disabled={loading || !buildRequirement()} className="neu-btn-soft gap-2">
                <Wand2 size={14} />{loading ? '智能匹配中…' : '开始智能推荐'}
              </button>
            </div>
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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
              <div className="lg:col-span-2 space-y-4">
                {error && <div className="rounded-xl px-4 py-3 text-sm font-semibold text-[var(--danger)]" style={{ background: 'color-mix(in oklch, var(--danger) 8%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.3)' }}>{error}</div>}

                {/* 智能分析摘要 */}
                <div className="rounded-[20px] p-5" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <FileSearch size={15} className="text-[var(--accent)]" />
                    <h2 className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">智能分析摘要</h2>
                    {result.engine && (
                      <span className="ml-auto rounded-[4px] px-1.5 py-0.5 text-[9px] font-bold"
                        style={{ color: result.engine === 'deepseek' ? 'var(--accent)' : 'var(--warning)', background: `color-mix(in oklch, ${result.engine === 'deepseek' ? 'var(--accent)' : 'var(--warning)'} 14%, transparent)` }}
                        title={result.engine === 'deepseek' ? '由 DeepSeek 大模型语义匹配' : 'AI 服务不可用，已降级为规则关键词匹配（精度较低）'}>
                        {result.engine === 'deepseek' ? 'AI 匹配' : '规则匹配（AI 不可用）'}
                      </span>
                    )}
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
                  <button onClick={() => setShowCompare(true)} className="neu-btn-xs gap-1"><Columns3 size={12} />对比</button>
                  <span className="text-[var(--muted-foreground)]/40">|</span>
                  <button onClick={() => { setAddMoreCount(1); setAddMoreOpen(true); }} disabled={addMoreLoading} className="neu-btn-xs gap-1">
                    <Plus size={12} />{addMoreLoading ? '增选中…' : '增选'}
                  </button>
                  <span className="text-[var(--muted-foreground)]/40">|</span>
                  <button onClick={() => setShowManualAdd(v => !v)} className={`neu-btn-xs gap-1 ${showManualAdd ? 'is-active' : ''}`}>
                    <Search size={12} />手动补充
                  </button>
                </div>

                {/* 手动补充搜索面板 */}
                {showManualAdd && (
                  <div className="rounded-[16px] p-4 space-y-3" style={{ background: 'oklch(1 0 0 / 0.58)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.75)' }}>
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
                        <input value={manualSearch} onChange={e => { setManualSearch(e.target.value); if (!e.target.value.trim()) { setManualSuppliers([]); setManualTotal(0); } }}
                          onKeyDown={e => { if (e.key === 'Enter') handleManualSearch(); }}
                          placeholder="搜索供应商名称、标签或经营范围..." className="workbench-input w-full !pl-9 !pr-8 text-sm" />
                        {manualSearch && (
                          <button type="button" onClick={() => { setManualSearch(''); setManualSuppliers([]); setManualTotal(0); }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--muted-foreground)]/50 transition hover:text-[var(--muted-foreground)]">
                            <X size={14} />
                          </button>
                        )}
                      </div>
                      <button onClick={handleManualSearch} disabled={manualLoading} className="neu-btn-soft text-sm gap-1.5">
                        <Search size={14} />{manualLoading ? '搜索中…' : '搜索'}
                      </button>
                    </div>
                    {manualSearch.trim() && manualSuppliers.length > 0 && (
                      <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                        {manualSuppliers.map(s => {
                          const inList = shortlist.has(s.id);
                          return (
                            <div key={s.id} className={`flex items-center justify-between rounded-[14px] p-3 ${inList ? 'ring-2 ring-[var(--success)]/20' : ''}`} style={{ background: 'oklch(1 0 0 / 0.5)' }}>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-bold text-[var(--foreground)]">{s.name}</span>
                                  {(s as any).enterpriseType && <span className="neu-tab-count">{normalizeEnterpriseType((s as any).enterpriseType)}</span>}
                                  {inList && <span className="text-[10px] font-bold text-[var(--success)]">✓ 已加入</span>}
                                </div>
                                {(s as any).tags?.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {(s as any).tags.slice(0, 5).map((tg: string) => (
                                      <span key={tg} className="inline-flex items-center rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-strong)]" style={{ background: 'color-mix(in oklch, var(--accent) 9%, transparent)' }}>{tg}</span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <button onClick={() => toggleManualSupplier(s)} className={`neu-btn-xs flex-shrink-0 ${inList ? 'is-danger' : 'is-success'}`}>
                                {inList ? <><X size={12} />移除</> : <><Plus size={12} />加入</>}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* 推荐列表（去重：同一 supplierId 只渲染一次） */}
                {(() => {
                  const seen = new Set<string>();
                  const deduped = result.recommendations.filter(r => seen.has(r.supplierId) ? false : (seen.add(r.supplierId), true));
                  return deduped.map((r, idx) => {
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
                            <span className="text-sm font-bold text-[var(--foreground)] cursor-pointer hover:text-[var(--accent)] transition" onClick={() => openSupplierDetail(r)}>{r.name}</span>
                            {r.enterpriseType && <span className="neu-tab-count">{normalizeEnterpriseType(r.enterpriseType)}</span>}
                            {addMoreIds.has(r.supplierId) && (
                              <span className="inline-flex items-center rounded-[4px] px-1.5 py-0.5 text-[9px] font-bold text-[var(--warning)]"
                                style={{ background: 'color-mix(in oklch, var(--warning) 12%, transparent)' }}>增选</span>
                            )}
                            {r.evaluation && (
                              <span className="inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[10px] font-extrabold text-white tabular-nums"
                                style={{ background: r.evaluation.level === 'A' ? 'var(--success)' : r.evaluation.level === 'B' ? 'var(--accent)' : r.evaluation.level === 'C' ? 'var(--warning)' : r.evaluation.level === 'D' ? '#ca8a04' : 'var(--danger)' }}>
                                {r.evaluation.level}
                              </span>
                            )}
                            {inList && <span className="text-[10px] font-bold text-[var(--success)]">✓ 已入选</span>}
                          </div>
                          {r.tags && r.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2">
                              {r.tags.slice(0, 6).map(tg => (
                                <span key={tg} className="inline-flex items-center rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-strong)]"
                                  style={{ background: 'color-mix(in oklch, var(--accent) 9%, transparent)' }}>{tg}</span>
                              ))}
                            </div>
                          )}
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
                        <div className="flex flex-col gap-1.5 flex-shrink-0 self-center">
                          <button onClick={() => openSupplierDetail(r)} className="neu-btn-xs w-14 justify-center">详情</button>
                          <button onClick={() => toggleShortlistAndSave(r)} className={`neu-btn-xs w-14 justify-center ${inList ? 'is-success' : ''}`}>
                            {inList ? <><X size={12} />移除</> : <><Plus size={12} />加入</>}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                });
                })()}
              </div>

              {/* 候选名单 sidebar —— 始终显示 */}
              <div className="lg:col-span-1 lg:sticky lg:top-20">{shortlistPanel}</div>
            </div>
          )}

          {/* 空态：两栏布局，右侧始终显示候选名单 */}
          {!result && !loading && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
              <div className="lg:col-span-2">
                {selectionMode === 'ai' && (
                  <div className="rounded-[20px] py-16 text-center" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
                    <Wand2 size={28} className="mx-auto mb-4 text-[var(--muted-foreground)]/30" />
                    <p className="text-sm text-[var(--muted-foreground)]">返回上一步调整需求后重新执行智能推荐</p>
                  </div>
                )}
                {selectionMode === 'manual' && (
                  <div className="space-y-4">
                    <div className="rounded-[20px] p-5 space-y-4" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
                      <div className="flex gap-2">
                        <div className="flex-1 relative">
                          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
                          <input value={manualSearch} onChange={e => setManualSearch(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleManualSearch(); }}
                            placeholder="按供应商名称、标签或经营范围搜索..." className="workbench-input w-full !pl-9 !pr-8 text-sm" />
                          {manualSearch && (
                            <button type="button"
                              onClick={() => { setManualSearch(''); setManualSuppliers([]); setManualTotal(0); }}
                              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded-[4px] text-[var(--muted-foreground)]/50 hover:text-[var(--muted-foreground)] transition-colors">
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
                              {(s as any).enterpriseType && <span className="neu-tab-count">{normalizeEnterpriseType((s as any).enterpriseType)}</span>}
                              {inList && <span className="text-[10px] font-bold text-[var(--success)]">✓ 已加入</span>}
                            </div>
                            {s.tags && s.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {s.tags.slice(0, 5).map(tg => (
                                  <span key={tg} className="inline-flex items-center rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-strong)]"
                                    style={{ background: 'color-mix(in oklch, var(--accent) 9%, transparent)' }}>{tg}</span>
                                ))}
                              </div>
                            )}
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
                        <p className="text-sm text-[var(--muted-foreground)]">输入供应商名称或标签关键词搜索</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* 候选名单 sidebar —— 始终显示 */}
              <div className="lg:col-span-1 lg:sticky lg:top-20">{shortlistPanel}</div>
            </div>
          )}

          {/* 增选数量确认弹窗 */}
          {addMoreOpen && (
            <Modal open onClose={() => setAddMoreOpen(false)} title="增选供应商" size="sm">
              <div className="space-y-4">
                <p className="text-sm text-[var(--muted-foreground)]">按原有业务标签和需求，排除已入围供应商，追加推荐供应商。</p>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-[var(--foreground)]">增选数量</span>
                  <div className="neu-tab-bar inline-flex">
                    {[1, 2, 3].map(n => (
                      <button key={n} type="button" onClick={() => setAddMoreCount(n)}
                        className={`neu-tab px-4 py-1.5 text-xs font-bold ${addMoreCount === n ? 'is-active' : ''}`}>
                        {n} 家
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setAddMoreOpen(false)} className="neu-btn-soft">取消</button>
                  <button onClick={handleAddMore} disabled={addMoreLoading} className="neu-btn-soft gap-1.5">
                    <Wand2 size={13} />{addMoreLoading ? '匹配中…' : '确定增选'}
                  </button>
                </div>
              </div>
            </Modal>
          )}

        </div>
      )}

      {/* ── 步骤 4：确认通知 ── */}
      {step === 4 && (
        <div className="space-y-5">
          <div className="rounded-[20px] p-6 space-y-5" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88) 0%, oklch(0.985 0.005 258 / 0.58) 40%, oklch(1 0 0 / 0.14) 75%)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.75), 2px 3px 8px oklch(0.55 0.03 258 / 0.1), -2px -2px 8px oklch(1 0 0 / 0.88)' }}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">确认通知</h2>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  <strong className="tabular-nums text-[var(--foreground)]">{shortlist.size}</strong> 家候选供应商
                  {shortlist.size > 0 && <span className="ml-2">平均匹配度 <strong className="text-[var(--foreground)]">{Math.round([...shortlist.values()].reduce((s, v) => s + v.item.matchScore, 0) / shortlist.size)}</strong></span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => exportShortlistToExcel([...shortlist.values()], selectedProject?.name, { lines: buildExportHeader().split('\n').filter(Boolean) })} className="neu-btn-xs gap-1">
                  <FileSpreadsheet size={11} />导出 Excel
                </button>
                <button onClick={copyList} className="neu-btn-xs gap-1">
                  <Copy size={11} />复制名单
                </button>
              </div>
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

            <div className="wb-section-rule" />

            {/* ═══ 逐供应商通知（去除模板，直接展示每家供应商的通知内容） ═══ */}
            <div className="space-y-4">
              {/* 渠道 + AI —— 标签 + 分组按钮同一行卡片 */}
              <div className="flex items-center gap-3 flex-wrap rounded-xl p-3" style={{ background: 'color-mix(in oklch, var(--accent) 5%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6)' }}>
                <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)] flex-shrink-0">
                  <Send size={12} className="text-[var(--accent)]" />
                  通知渠道
                </span>
                <div className="flex gap-1.5 items-center flex-wrap">
                  {/* 站内 + 短信：内容一致，归为一组 */}
                  <div className="flex gap-1 rounded-[8px] p-0.5" style={{ background: 'oklch(1 0 0 / 0.45)' }}>
                    {[
                      { key: 'in_app', label: '站内', icon: <MessageSquare size={13} /> },
                      { key: 'sms', label: '短信', icon: <Bell size={13} /> },
                    ].map(ch => {
                      const active = notifyChannels.includes(ch.key);
                      return (
                        <button key={ch.key}
                          onClick={() => setNotifyChannels(prev => active ? prev.filter(c => c !== ch.key) : [...prev, ch.key])}
                          className={`neu-tab flex-row items-center gap-1.5 py-1.5 px-3 ${active ? 'is-active' : ''}`}>
                          {ch.icon}<span className="text-[11px] font-semibold">{ch.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  {/* 电话：内容独立（简短话术），单独一组 */}
                  <div className="flex gap-1 rounded-[8px] p-0.5" style={{ background: 'oklch(1 0 0 / 0.45)' }}>
                    {[{ key: 'phone', label: '电话通知', icon: <Phone size={13} /> }].map(ch => {
                      const active = notifyChannels.includes(ch.key);
                      return (
                        <button key={ch.key}
                          onClick={() => setNotifyChannels(prev => active ? prev.filter(c => c !== ch.key) : [...prev, ch.key])}
                          className={`neu-tab flex-row items-center gap-1.5 py-1.5 px-3 ${active ? 'is-active' : ''}`}>
                          {ch.icon}<span className="text-[11px] font-semibold">{ch.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <span className="flex-1" />
                <button onClick={handleNotifyAi} disabled={notifyAiLoading || shortlist.size === 0} className="neu-btn-xs gap-1">
                  <Sparkles size={10} />{notifyAiLoading ? 'AI 生成中…' : 'AI 生成'}
                </button>
                <button onClick={() => setNotifyPerSupplier(new Map())} disabled={notifyPerSupplier.size === 0} className="neu-btn-xs gap-1 text-[var(--muted-foreground)]">
                  <X size={10} />清空
                </button>
              </div>

              {/* 逐供应商通知：紧凑列表 + 点击查看展开编辑 */}
              <div className="space-y-2">
                {/* ── 供应商行（紧凑） ── */}
                {[...shortlist.entries()].map(([sid, { item: r }], idx) => {
                  const msg = getSupplierMessage(sid);
                  const hasContent = notifyPerSupplier.has(sid);
                  const isExpanded = notifyActiveSupplier === sid;
                  return (
                    <div key={sid}>
                      <div className={`rounded-[14px] px-3 py-2 flex items-center gap-2.5 transition-all ${hasContent ? '' : 'opacity-50'} ${isExpanded ? 'rounded-b-none' : ''}`}
                        style={{ background: isExpanded ? 'oklch(1 0 0 / 0.7)' : 'oklch(1 0 0 / 0.48)', boxShadow: `inset 0 1px 0 oklch(1 0 0 / ${hasContent ? '0.7' : '0.5'}), 1px 1px 3px oklch(0.55 0.03 258 / 0.06), -1px -1px 2px oklch(1 0 0 / 0.7)` }}>
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[9px] font-extrabold text-white tabular-nums"
                          style={{ background: 'linear-gradient(135deg, oklch(0.52 0.16 258), oklch(0.45 0.14 258))' }}>{idx + 1}</span>
                        <span className="text-[11px] font-bold text-[var(--foreground)] truncate flex-1 min-w-0">{r.name}</span>
                        <span className="text-[10px] tabular-nums font-semibold shrink-0" style={{ color: scoreVar(r.matchScore) }}>{r.matchScore}</span>
                        {hasContent ? (
                          <button
                            onClick={() => setNotifyActiveSupplier(prev => prev === sid ? '' : sid)}
                            className="neu-btn-xs shrink-0 is-success">
                            <Check size={10} />{isExpanded ? '收起' : '查看'}
                          </button>
                        ) : (
                          <span className="text-[11px] italic text-[var(--muted-foreground)] shrink-0">请等待AI自动生成</span>
                        )}
                      </div>
                      {/* 展开编辑区（有内容且当前选中） */}
                      {hasContent && isExpanded && (
                        <div className="rounded-b-[14px] p-4 space-y-4 border-t" style={{ background: 'oklch(1 0 0 / 0.58)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 3px 6px oklch(0.55 0.03 258 / 0.06), -1px -1px 3px oklch(1 0 0 / 0.75)', borderColor: 'oklch(0.6 0.04 258 / 0.1)' }}>
                          {/* 站内通知 / 短信通知 */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
                              <MessageSquare size={11} /><Bell size={11} /><span>站内通知 / 短信通知</span>
                            </div>
                            <input value={msg.title}
                              onChange={e => setNotifyPerSupplier(prev => { const n = new Map(prev); n.set(sid, { ...msg, title: e.target.value }); return n; })}
                              placeholder="通知标题"
                              className="workbench-input w-full text-xs !h-8" />
                            <textarea value={msg.body}
                              onChange={e => setNotifyPerSupplier(prev => { const n = new Map(prev); n.set(sid, { ...msg, body: e.target.value }); return n; })}
                              rows={10} className="neu-input w-full resize-y text-xs leading-relaxed !min-h-[200px]" />
                          </div>
                          {/* 电话通知话术 */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
                              <Phone size={11} /><span>电话通知话术</span>
                            </div>
                            <textarea value={msg.phoneScript}
                              onChange={e => setNotifyPerSupplier(prev => { const n = new Map(prev); n.set(sid, { ...msg, phoneScript: e.target.value }); return n; })}
                              rows={4} className="neu-input w-full resize-y text-xs leading-relaxed !min-h-[90px]" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

            </div>
          </div>

          <div className="flex items-center justify-between">
            <button onClick={() => setStep(3)} className="neu-btn-soft gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>上一步：审核候选
            </button>
            <div className="flex items-center gap-2">
              <button onClick={handleNotify} disabled={notifySending || notified || notifyPerSupplier.size === 0}
                className={`neu-btn-soft gap-2 ${notified ? 'is-success' : ''}`}>
                {notifySending ? <><RefreshCw size={14} className="animate-spin" />发送中…</>
                  : notified ? <><Check size={14} />已通知 {shortlist.size} 家</>
                  : <><Bell size={14} />一键通知 {shortlist.size} 家供应商</>}
              </button>
              <button onClick={() => setStep(neg ? attachStep : baseConfirmStep)} disabled={!notified} className="neu-btn-soft gap-2" title={!notified ? '请先完成一键通知' : undefined}>
                下一步：{neg ? '附件选择' : '供应商确认'}<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 步骤 5（谈判采购）：附件选择 ── */}
      {step === attachStep && (
        <div className="space-y-5">
          {/* ══ 卡片 1：项目时间确认 ══ */}
          <div className="rounded-[20px] p-6 space-y-4"
            style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.985 0.005 258 / 0.58) 40%, oklch(1 0 0 / 0.14) 75%)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.75), 2px 3px 8px oklch(0.55 0.03 258 / 0.1), -2px -2px 8px oklch(1 0 0 / 0.88)' }}>
            <div className="flex items-center gap-2">
              <Calendar size={15} className="text-[var(--accent)]" />
              <h2 className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">项目时间确认</h2>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">请确认以下项目时间信息无误，确认后将随附件一并发送给候选供应商。</p>
            <div className="space-y-3">
              {/* 采购文件获取时间 — 区间（整行展示） */}
              <div className="rounded-xl p-3.5" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6)' }}>
                <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">采购文件获取时间</div>
                <div className="flex items-center gap-2">
                  <input type="date" value={acquireStartDate} onChange={e => setAcquireStartDate(e.target.value)}
                    className="neu-input text-xs shrink-0" style={{ width: 150 }} />
                  <input type="time" value={acquireStartTime} onChange={e => setAcquireStartTime(e.target.value)}
                    className="neu-input text-xs shrink-0" style={{ width: 110 }} />
                  <span className="text-[11px] font-semibold text-[var(--muted-foreground)] shrink-0">至</span>
                  <input type="date" value={acquireEndDate} onChange={e => setAcquireEndDate(e.target.value)}
                    className="neu-input text-xs shrink-0" style={{ width: 150 }} />
                  <input type="time" value={acquireEndTime} onChange={e => setAcquireEndTime(e.target.value)}
                    className="neu-input text-xs shrink-0" style={{ width: 110 }} />
                </div>
              </div>
              {/* 开标时间 — 单点 */}
              <div className="rounded-xl p-3.5" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6)', maxWidth: 420 }}>
                <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">开标时间</div>
                <div className="flex items-center gap-2">
                  <input type="date" value={bidDate} onChange={e => setBidDate(e.target.value)}
                    className="neu-input text-xs shrink-0" style={{ width: 150 }} />
                  <input type="time" value={bidTime} onChange={e => setBidTime(e.target.value)}
                    className="neu-input text-xs shrink-0" style={{ width: 110 }} />
                </div>
              </div>
            </div>
            <button
              onClick={() => { setTimeConfirmed(true); toast.success('项目时间已确认'); }}
              disabled={!acquireStartDate && !bidDate}
              className={`neu-btn-soft gap-2 ${timeConfirmed ? 'is-success' : ''}`}>
              {timeConfirmed ? <><Check size={13} /> 已确认</> : <><ShieldCheck size={13} /> 确认项目时间无误</>}
            </button>
          </div>

          {/* ══ 卡片 2+3 双栏：引用采购文件 | 上传附件 ══ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
            {/* 引用采购文件 */}
            <div className="rounded-[20px] p-6 space-y-4"
              style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.985 0.005 258 / 0.58) 40%, oklch(1 0 0 / 0.14) 75%)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.75), 2px 3px 8px oklch(0.55 0.03 258 / 0.1), -2px -2px 8px oklch(1 0 0 / 0.88)' }}>
              <div className="flex items-center gap-2">
                <FileText size={15} className="text-[var(--accent)]" />
                <h2 className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">引用采购文件</h2>
                {refFileKeys.size > 0 && <span className="text-[11px] tabular-nums font-bold text-[var(--accent)] ml-auto">已选 {refFileKeys.size}</span>}
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">从采购文件步骤中勾选文件引用，无需重复上传。</p>
              {projectTenderFiles.length === 0 ? (
                <div className="py-10 text-center text-xs text-[var(--muted-foreground)]">该项目采购文件步骤暂无文件</div>
              ) : (
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                  {projectTenderFiles.map(f => (
                    <label key={f.objectKey}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 cursor-pointer transition ${refFileKeys.has(f.objectKey) ? 'ring-1 ring-[var(--accent)]/30' : ''}`}
                      style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                      <input type="checkbox" checked={refFileKeys.has(f.objectKey)}
                        onChange={() => setRefFileKeys(prev => { const n = new Set(prev); n.has(f.objectKey) ? n.delete(f.objectKey) : n.add(f.objectKey); return n; })}
                        className="w-3.5 h-3.5 accent-[var(--accent)] rounded shrink-0" />
                      <span className="flex-1 min-w-0 truncate text-xs font-semibold text-[var(--foreground)]">{f.fileName}</span>
                      <span className="text-[10px] text-[var(--muted-foreground)] shrink-0 tabular-nums">{(f.fileSize / 1024).toFixed(0)} KB</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* 上传附件 */}
            <div className="rounded-[20px] p-6 space-y-4"
              style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.985 0.005 258 / 0.58) 40%, oklch(1 0 0 / 0.14) 75%)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.75), 2px 3px 8px oklch(0.55 0.03 258 / 0.1), -2px -2px 8px oklch(1 0 0 / 0.88)' }}>
              <div className="flex items-center gap-2">
                <Upload size={15} className="text-[var(--accent)]" />
                <h2 className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">上传附件</h2>
                {attachFiles.length > 0 && <span className="text-[11px] tabular-nums font-bold text-[var(--accent)] ml-auto">{attachFiles.length} 个</span>}
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">上传谈判所需文件，与引用文件一并交付供应商。</p>
              <label className="neu-drop-zone w-full cursor-pointer">
                {attachUploading ? <Loader2 size={22} className="animate-spin" /> : <Upload size={22} />}
                <span className="text-xs font-semibold">{attachUploading ? '上传中…' : '点击上传（PDF / Word / 图片 / 压缩包）'}</span>
                <input type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.zip,.rar" className="hidden"
                  onChange={e => { handleAttachUpload(e.target.files); e.target.value = ''; }} />
              </label>
              {attachFiles.length > 0 && (
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                  {attachFiles.map(f => (
                    <div key={f.id} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
                      style={{ background: 'oklch(1 0 0 / 0.5)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                      <span className="min-w-0 flex-1 truncate text-[var(--foreground)] font-semibold">{f.name}</span>
                      <span className="text-[var(--muted-foreground)] tabular-nums shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                      <button onClick={() => setAttachFiles(prev => prev.filter(x => x.id !== f.id))}
                        className="neu-btn-xs is-danger shrink-0 !h-5 !w-5 !p-0 justify-center"><X size={11} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ══ 卡片 4：采购文件下载方式 ══ */}
          <div className="rounded-[20px] p-6 space-y-4"
            style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.985 0.005 258 / 0.58) 40%, oklch(1 0 0 / 0.14) 75%)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.75), 2px 3px 8px oklch(0.55 0.03 258 / 0.1), -2px -2px 8px oklch(1 0 0 / 0.88)' }}>
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} className="text-[var(--accent)]" />
              <h2 className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">采购文件下载方式</h2>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">设置候选供应商获取采购文件的下载方式。</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {([
                { value: 'free', label: '免费下载', desc: '供应商可直接下载采购文件' },
                { value: 'encrypted', label: '解密下载', desc: '供应商需输入密码才可下载' },
                { value: 'paid', label: '付费下载', desc: '供应商需付费后下载' },
              ] as const).map((m) => (
                <label key={m.value} className={`flex items-start gap-2 rounded-lg px-3 py-2.5 cursor-pointer transition ${downloadMode === m.value ? 'ring-1 ring-[var(--accent)]/40' : ''}`}
                  style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                  <input type="radio" name="attachDownloadMode" checked={downloadMode === m.value}
                    onChange={() => {
                      setDownloadMode(m.value);
                      if (m.value === 'encrypted' && !downloadPassword) {
                        setDownloadPassword(String(Math.floor(100000 + Math.random() * 900000)));
                      }
                    }}
                    className="accent-[var(--accent)] mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[var(--foreground)]">{m.label}</div>
                    <div className="text-[10px] text-[var(--muted-foreground)] leading-tight mt-0.5">{m.desc}</div>
                  </div>
                </label>
              ))}
            </div>
            {downloadMode === 'encrypted' && (
              <div className="flex items-center gap-2 rounded-lg px-3 py-2.5" style={{ background: 'color-mix(in oklch, var(--accent-soft, color-mix(in oklch, var(--accent) 12%, transparent)) 30%, transparent)' }}>
                <span className="text-[11px] font-bold text-[var(--foreground)] shrink-0">下载密码：</span>
                <code className="text-xs font-mono tabular-nums tracking-[0.15em] text-[var(--accent-strong)]">{downloadPassword}</code>
                <button type="button" onClick={() => setDownloadPassword(String(Math.floor(100000 + Math.random() * 900000)))} className="neu-btn-xs ml-auto">刷新</button>
              </div>
            )}
            {downloadMode === 'paid' && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-[var(--foreground)] shrink-0">售价（元）</span>
                <input type="number" value={paidAmount} onChange={e => setPaidAmount(e.target.value)}
                  placeholder="请输入售价" className="neu-input text-sm" style={{ width: 180 }} />
              </div>
            )}
          </div>

          {/* 汇总提示 */}
          {(refFileKeys.size > 0 || attachFiles.length > 0) && (
            <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-xs"
              style={{ background: 'color-mix(in oklch, var(--accent) 6%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.4)' }}>
              <Check size={13} className="text-[var(--accent)] shrink-0" />
              <span className="text-[var(--muted-foreground)]">已选 <strong className="text-[var(--foreground)]">{refFileKeys.size + attachFiles.length}</strong> 个附件（引用 {refFileKeys.size} + 上传 {attachFiles.length}），确认后将一并交付给候选供应商。</span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <button onClick={() => setStep(4)} className="neu-btn-soft gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>上一步：确认通知
            </button>
            <div className="flex items-center gap-2">
              <button onClick={handleConfirmConfig} disabled={configSending || configSent || !timeConfirmed}
                className={`neu-btn-primary !h-9 !text-xs gap-2 ${configSent ? 'is-success' : ''}`}
                title={!timeConfirmed ? '请先确认项目时间' : undefined}>
                {configSent ? <><Check size={13} /> 已下发</> : configSending ? <><Loader2 size={13} className="animate-spin" /> 下发中…</> : <><Send size={13} /> 确认配置</>}
              </button>
              <button onClick={() => setStep(baseConfirmStep)} disabled={!timeConfirmed || !configSent} className="neu-btn-soft gap-2" title={!timeConfirmed ? '请先确认项目时间' : !configSent ? '请先点击确认配置' : undefined}>
                下一步：供应商确认<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 步骤 {neg ? 6 : 5}：供应商确认 ── */}
      {step === baseConfirmStep && (
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
                  {[...shortlist.entries()].map(([sid, { item: r }], idx) => (
                    renderSupplierRow(sid, r, idx, confirmations.get(sid) || 'pending', () => cycleConfirmation(sid), '正选', undefined, true)
                  ))}
                </div>

              </div>

              <div className="flex items-center justify-between">
                <button onClick={() => setStep(neg ? attachStep : 4)} className="neu-btn-soft gap-2">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>上一步：{neg ? '附件选择' : '确认通知'}
                </button>
                <div className="flex items-center gap-2">
                  {isRerun ? (
                    <button onClick={() => setStep(firstRerunPickStep)} className="neu-btn-soft gap-2">
                      下一步：补选候选<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                    </button>
                  ) : (
                    <button onClick={openRerun} className="neu-btn-soft gap-2">
                      <Plus size={14} />补选
                    </button>
                  )}
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

      {/* ── 历史补选轮次（只读回顾） ── */}
      {isRerun && currentRerunRound >= 0 && currentRerunRound < rerunRound && (
        <div className="space-y-5">
          {(() => {
            const h = rerunHistory[currentRerunRound];
            if (!h) return null;
            if (isAnyRerunPick) return (
              <div className="rounded-[18px] p-4 space-y-3" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Award size={14} className="text-[var(--accent)]" />
                    <h2 className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">补选名单（第{currentRerunRound + 1}轮）</h2>
                  </div>
                  <span className="tabular-nums text-[11px] font-bold text-[var(--foreground)]">{h.shortlist.size}</span>
                </div>
                <div className="space-y-1.5">
                  {[...h.shortlist.entries()].map(([sid, { item: r }], idx) => {
                    const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
                    return (
                      <div key={sid} className="rounded-[12px] p-2.5 flex items-center gap-2 transition-shadow"
                        style={{ background: 'oklch(1 0 0 / 0.5)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5), 1px 1px 2px oklch(0.55 0.03 258 / 0.05)' }}>
                        <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[6px] text-[9px] font-extrabold text-white tabular-nums"
                          style={{ background: 'linear-gradient(135deg, oklch(0.55 0.14 150), oklch(0.48 0.12 150))' }}>{idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <span className="text-[12px] font-bold text-[var(--foreground)] truncate">{r.name}</span>
                          <div className="mt-0.5 flex items-center gap-2 text-[10px] tabular-nums">
                            <span className="font-bold" style={{ color: scoreVar(r.matchScore) }}>{r.matchScore}</span>
                            {contact && <span className="text-[var(--muted-foreground)] truncate">{contact.name}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
            if (isAnyRerunNotify) return (
              <div className="rounded-[20px] p-5 space-y-5" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88) 0%, oklch(0.985 0.005 258 / 0.58) 40%, oklch(1 0 0 / 0.14) 75%)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.75), 2px 3px 8px oklch(0.55 0.03 258 / 0.1), -2px -2px 8px oklch(1 0 0 / 0.88)' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">补选通知（第{currentRerunRound + 1}轮）</h2>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      <strong className="tabular-nums text-[var(--foreground)]">{h.shortlist.size}</strong> 家补选供应商
                      {h.shortlist.size > 0 && <span className="ml-2">平均匹配度 <strong className="text-[var(--foreground)]">{Math.round([...h.shortlist.values()].reduce((s, v) => s + v.item.matchScore, 0) / h.shortlist.size)}</strong></span>}
                    </p>
                  </div>
                </div>

                {/* 候选标签云 */}
                <div className="flex flex-wrap gap-1.5">
                  {[...h.shortlist.entries()].map(([sid, { item: r }], idx) => (
                    <span key={sid} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-[var(--foreground)]"
                      style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                      <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] text-[9px] font-extrabold text-white tabular-nums"
                        style={{ background: 'linear-gradient(135deg, oklch(0.55 0.14 150), oklch(0.48 0.12 150))' }}>{idx + 1}</span>
                      {r.name}
                      <span className="text-[10px] font-bold tabular-nums" style={{ color: scoreVar(r.matchScore) }}>{r.matchScore}</span>
                    </span>
                  ))}
                </div>

                <div className="wb-section-rule" />

                {/* 逐供应商通知（只读回顾） */}
                <div className="space-y-2">
                  {[...h.shortlist.entries()].map(([sid, { item: r }], idx) => {
                    const msg = h.notifyPerSupplier?.get(sid);
                    const hasContent = !!msg?.body?.trim();
                    const isExpanded = notifyActiveSupplier === sid;
                    return (
                      <div key={sid}>
                        <div className={`rounded-[14px] px-3 py-2 flex items-center gap-2.5 transition-all ${hasContent ? '' : 'opacity-50'} ${isExpanded ? 'rounded-b-none' : ''}`}
                          style={{ background: hasContent ? (isExpanded ? 'oklch(1 0 0 / 0.7)' : 'oklch(1 0 0 / 0.48)') : 'oklch(1 0 0 / 0.48)', boxShadow: `inset 0 1px 0 oklch(1 0 0 / ${hasContent ? '0.7' : '0.5'}), 1px 1px 3px oklch(0.55 0.03 258 / 0.06), -1px -1px 2px oklch(1 0 0 / 0.7)` }}>
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[9px] font-extrabold text-white tabular-nums"
                            style={{ background: 'linear-gradient(135deg, oklch(0.55 0.14 150), oklch(0.48 0.12 150))' }}>{idx + 1}</span>
                          <span className="text-[11px] font-bold text-[var(--foreground)] truncate flex-1 min-w-0">{r.name}</span>
                          <span className="text-[10px] tabular-nums font-semibold shrink-0" style={{ color: scoreVar(r.matchScore) }}>{r.matchScore}</span>
                          {hasContent && (
                            <button onClick={() => setNotifyActiveSupplier(prev => prev === sid ? '' : sid)}
                              className="neu-btn-xs is-success shrink-0 gap-1">
                              {isExpanded ? '收起' : '查看'}
                            </button>
                          )}
                        </div>
                        {hasContent && isExpanded && (
                          <div className="rounded-b-[14px] p-4 space-y-3 border-t" style={{ background: 'oklch(1 0 0 / 0.58)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 3px 6px oklch(0.55 0.03 258 / 0.06), -1px -1px 3px oklch(1 0 0 / 0.75)', borderColor: 'oklch(0.6 0.04 258 / 0.1)' }}>
                            <input value={msg!.title} readOnly className="workbench-input w-full text-xs !h-8" />
                            <textarea value={msg!.body} readOnly rows={10} className="neu-input w-full resize-y text-xs leading-relaxed !min-h-[200px]" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
            if (isAnyRerunConfirm) return (
              <div className="rounded-[20px] p-6 space-y-4" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
                <h2 className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">第{currentRerunRound + 1}轮确认</h2>
                <div className="space-y-1.5">
                  {[...h.shortlist.entries()].map(([sid, { item: r }], idx) => (
                    renderSupplierRow(sid, r, idx, h.confirmations.get(sid) || 'pending', () => {
                      setRerunHistory(prev => { const n = [...prev]; const cm = new Map(n[currentRerunRound].confirmations); const cur = cm.get(sid) || 'pending'; cm.set(sid, cur === 'pending' ? 'confirmed' : cur === 'confirmed' ? 'declined' : 'pending'); n[currentRerunRound] = { ...n[currentRerunRound], confirmations: cm }; return n; });
                    }, '补选', undefined, true)
                  ))}
                </div>
              </div>
            );
            return null;
          })()}
          <div className="flex items-center justify-between">
            <button onClick={() => setStep(step - 1)} className="neu-btn-soft gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>上一步：{steps[step - 2]?.label || ''}
            </button>
            <button onClick={() => setStep(step + 1)} className="neu-btn-soft gap-2" disabled={currentRerunRound >= rerunRound - 1 && step >= finalConfirmStep}>
              下一步：{steps[step]?.label || ''}<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* ── 补选候选步骤 ── */}
      {step === rerunPickStep && isRerun && currentRerunRound === rerunRound && (
        <div className="space-y-5">
          {rerunLoading && (
            <div className="rounded-[20px] py-16 text-center" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
              <RefreshCw size={22} className="animate-spin mx-auto mb-4 text-[var(--accent)]" />
              <p className="text-sm font-bold text-[var(--foreground)]">AI 正在分析补选需求</p>
            </div>
          )}

          {rerunMode === 'ai' && rerunResult && !rerunLoading && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
              <div className="lg:col-span-2 space-y-4">
                {/* 智能分析摘要 */}
                <div className="rounded-[20px] p-5" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <FileSearch size={15} className="text-[var(--accent)]" />
                    <h2 className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">补选推荐</h2>
                  </div>
                  <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">{rerunResult.summary}</p>
                  <div className="flex gap-5 mt-3 text-xs">
                    <span className="tabular-nums">候选池 <strong className="text-[var(--foreground)]">{rerunResult.candidatePool}</strong></span>
                    <span className="tabular-nums">推荐 <strong className="text-[var(--foreground)]">{rerunResult.recommendations.length}</strong></span>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <button onClick={() => { const toAdd = rerunResult.recommendations; setRerunShortlist(prev => { const nm = new Map(prev); for (const r of toAdd) nm.set(r.supplierId, { item: r, note: '' }); return nm; }); }} className="neu-btn-xs gap-1"><ListPlus size={12} />全部加入</button>
                    <span className="text-[var(--muted-foreground)]/40">|</span>
                    <button onClick={() => setShowCompare(true)} className="neu-btn-xs gap-1"><Columns3 size={12} />对比</button>
                    <span className="text-[var(--muted-foreground)]/40">|</span>
                    <button onClick={() => setShowRerunManualAdd(v => !v)} className={`neu-btn-xs gap-1 ${showRerunManualAdd ? 'is-active' : ''}`}>
                      <Search size={12} />手动补充
                    </button>
                  </div>

                  {/* 手动补充搜索面板 */}
                  {showRerunManualAdd && (
                    <div className="rounded-[16px] p-4 space-y-3 mt-3" style={{ background: 'oklch(1 0 0 / 0.58)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.75)' }}>
                      <div className="flex gap-2">
                        <div className="flex-1 relative">
                          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
                          <input value={rerunManualSearch} onChange={e => { setRerunManualSearch(e.target.value); if (!e.target.value.trim()) { setRerunManualSuppliers([]); } }}
                            onKeyDown={e => { if (e.key === 'Enter') handleRerunManualSearch(); }}
                            placeholder="搜索供应商名称、标签或经营范围..." className="workbench-input w-full !pl-9 !pr-8 text-sm" />
                          {rerunManualSearch && (
                            <button type="button" onClick={() => { setRerunManualSearch(''); setRerunManualSuppliers([]); }}
                              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--muted-foreground)]/50 transition hover:text-[var(--muted-foreground)]">
                              <X size={14} />
                            </button>
                          )}
                        </div>
                        <button onClick={handleRerunManualSearch} disabled={rerunManualLoading} className="neu-btn-soft text-sm gap-1.5">
                          <Search size={14} />{rerunManualLoading ? '搜索中…' : '搜索'}
                        </button>
                      </div>
                      {rerunManualSearch.trim() && rerunManualSuppliers.length > 0 && (
                        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                          {rerunManualSuppliers.map(s => {
                            const inRerun = rerunShortlist.has(s.id);
                            const inOriginal = shortlist.has(s.id);
                            if (inOriginal) return null;
                            return (
                              <div key={s.id} className={`flex items-center justify-between rounded-[14px] p-3 ${inRerun ? 'ring-2 ring-[var(--success)]/20' : ''}`} style={{ background: 'oklch(1 0 0 / 0.5)' }}>
                                <div className="min-w-0 flex-1">
                                  <span className="text-sm font-bold text-[var(--foreground)]">{s.name}</span>
                                  {(s as any).enterpriseType && <span className="neu-tab-count ml-2">{normalizeEnterpriseType((s as any).enterpriseType)}</span>}
                                  {inRerun && <span className="text-[10px] font-bold text-[var(--success)] ml-2">✓ 已加入</span>}
                                </div>
                                <button onClick={() => toggleRerunManual(s)} className={`neu-btn-xs flex-shrink-0 ${inRerun ? 'is-danger' : 'is-success'}`}>
                                  {inRerun ? <><X size={12} />移除</> : <><Plus size={12} />加入</>}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {/* 推荐列表 */}
                {rerunResult.recommendations.map((r, idx) => {
                  const inList = rerunShortlist.has(r.supplierId);
                  const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
                  return (
                    <div key={r.supplierId} className={`rounded-[18px] p-4 transition-shadow duration-200 ${inList ? 'ring-2 ring-[var(--success)]/20' : ''}`}
                      style={{ background: 'oklch(1 0 0 / 0.58)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.75)' }}>
                      <div className="flex items-start gap-3">
                        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[10px] text-[12px] font-extrabold text-white tabular-nums"
                          style={{ background: 'linear-gradient(135deg, oklch(0.52 0.16 258), oklch(0.45 0.14 258))', boxShadow: '0 2px 6px oklch(0.5 0.12 258 / 0.3)' }}>{idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            <span className="text-sm font-bold text-[var(--foreground)] cursor-pointer hover:text-[var(--accent)] transition" onClick={() => openSupplierDetail(r)}>{r.name}</span>
                            {r.enterpriseType && <span className="neu-tab-count">{normalizeEnterpriseType(r.enterpriseType)}</span>}
                            {(r as any).evaluation && (
                              <span className="inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[10px] font-extrabold text-white tabular-nums"
                                style={{ background: (r as any).evaluation.level === 'A' ? 'var(--success)' : (r as any).evaluation.level === 'B' ? 'var(--accent)' : (r as any).evaluation.level === 'C' ? 'var(--warning)' : (r as any).evaluation.level === 'D' ? '#ca8a04' : 'var(--danger)' }}>
                                {(r as any).evaluation.level}
                              </span>
                            )}
                            {inList && <span className="text-[10px] font-bold text-[var(--success)]">✓ 已入选</span>}
                          </div>
                          {r.tags && r.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-2">
                              {r.tags.slice(0, 6).map((tg: string) => (
                                <span key={tg} className="inline-flex items-center rounded-[5px] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-strong)]"
                                  style={{ background: 'color-mix(in oklch, var(--accent) 9%, transparent)' }}>{tg}</span>
                              ))}
                            </div>
                          )}
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
                        <div className="flex flex-col gap-1.5 flex-shrink-0 self-center">
                          <button onClick={() => openSupplierDetail(r)} className="neu-btn-xs w-14 justify-center">详情</button>
                          <button onClick={() => toggleRerunShortlist(r)} className={`neu-btn-xs w-14 justify-center ${inList ? 'is-success' : ''}`}>
                            {inList ? <><X size={12} />移除</> : <><Plus size={12} />加入</>}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* 补选名单 sidebar */}
              <div className="lg:col-span-1 lg:sticky lg:top-20">
                <div className="rounded-[18px] p-4 space-y-3" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><Award size={14} className="text-[var(--accent)]" /><h2 className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">补选名单</h2></div>
                    <span className="tabular-nums text-[11px] font-bold text-[var(--foreground)]">{rerunShortlist.size}</span>
                  </div>
                  {rerunShortlist.size === 0 ? (
                    <div className="py-10 text-center"><Zap size={24} className="mx-auto mb-3 text-[var(--muted-foreground)]/25" /><p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed">点击推荐结果中的<br /><span className="font-bold text-[var(--accent)]">「加入」</span> 构建补选名单</p></div>
                  ) : (
                    <div className="space-y-1.5">
                      {[...rerunShortlist.entries()].map(([sid, { item: r }], idx) => {
                        const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
                        return (
                          <div key={sid} className="rounded-[12px] p-2.5 flex items-center gap-2 transition-shadow"
                            style={{ background: 'oklch(1 0 0 / 0.5)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5), 1px 1px 2px oklch(0.55 0.03 258 / 0.05)' }}>
                            <div className="flex flex-col gap-0.5 shrink-0">
                              <button onClick={() => moveRerunShortlistItem(idx, idx - 1)} disabled={idx === 0} className="p-0.5 text-[var(--muted-foreground)]/30 hover:text-[var(--muted-foreground)] disabled:opacity-15"><ChevronUp size={12} /></button>
                              <button onClick={() => moveRerunShortlistItem(idx, idx + 1)} disabled={idx === rerunShortlist.size - 1} className="p-0.5 text-[var(--muted-foreground)]/30 hover:text-[var(--muted-foreground)] disabled:opacity-15"><ChevronDown size={12} /></button>
                            </div>
                            <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[6px] text-[9px] font-extrabold text-white tabular-nums"
                              style={{ background: 'linear-gradient(135deg, oklch(0.55 0.14 150), oklch(0.48 0.12 150))' }}>{idx + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[12px] font-bold text-[var(--foreground)] truncate">{r.name}</span>
                                <button onClick={() => {
                                  setRerunShortlist(prev => { const n = new Map(prev); for (const [k, v] of n) { if (v.item.name === r.name) { n.delete(k); break; } } return n; });
                                }} className="shrink-0 text-[var(--muted-foreground)]/20 hover:text-[var(--danger)] transition"><X size={11} /></button>
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 text-[10px] tabular-nums">
                                <span className="font-bold" style={{ color: scoreVar(r.matchScore) }}>{r.matchScore}</span>
                                {contact && <span className="text-[var(--muted-foreground)] truncate">{contact.name}</span>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex gap-1.5 pt-1">
                        {rerunShortlist.size >= 2 && (
                          <button onClick={() => setShowCompare(true)} className="neu-btn-xs w-0 flex-1 justify-center gap-1.5"><Columns3 size={11} />横向对比</button>
                        )}
                        <button onClick={() => setRerunShortlist(new Map())} className="neu-btn-xs is-danger w-0 flex-1 justify-center gap-1"><X size={11} />清空</button>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-3 border-t border-[oklch(0.6_0.04_258_/_0.12)]">
                    <button onClick={() => { setIsRerun(false); setStep(baseConfirmStep); }} className="neu-btn-soft gap-2">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>上一步：第{rerunRound}轮确认
                    </button>
                    {rerunShortlist.size > 0 && (
                      <button onClick={() => setStep(rerunNotifyStep)} className="neu-btn-soft gap-2">
                        下一步：补选通知<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 手动选取模式 */}
          {rerunMode === 'manual' && !rerunLoading && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
              <div className="lg:col-span-2 space-y-4">
                <div className="rounded-[20px] p-5 space-y-4" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]" />
                      <input value={rerunManualSearch} onChange={e => { setRerunManualSearch(e.target.value); if (!e.target.value.trim()) { setRerunManualSuppliers([]); } }}
                        onKeyDown={e => { if (e.key === 'Enter') handleRerunManualSearch(); }}
                        placeholder="搜索供应商名称、标签或经营范围..." className="workbench-input w-full !pl-9 !pr-8 text-sm" />
                        {rerunManualSearch && (
                          <button type="button" onClick={() => { setRerunManualSearch(''); setRerunManualSuppliers([]); }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--muted-foreground)]/50 transition hover:text-[var(--muted-foreground)]">
                            <X size={14} />
                          </button>
                        )}
                    </div>
                    <button onClick={handleRerunManualSearch} disabled={rerunManualLoading} className="neu-btn-soft text-sm gap-1.5">
                      <Search size={14} />{rerunManualLoading ? '搜索中…' : '搜索'}
                    </button>
                  </div>
                </div>
                {rerunManualSuppliers.map(s => {
                  const inRerun = rerunShortlist.has(s.id);
                  const inOriginal = shortlist.has(s.id);
                  const origStatus = confirmations.get(s.id) || 'pending';
                  if (inOriginal) {
                    return (
                      <div key={s.id} className="flex items-center justify-between rounded-[14px] p-3" style={{ background: 'oklch(1 0 0 / 0.5)' }}>
                        <span className="text-sm font-bold">{s.name}</span>
                        <span className="text-[11px] font-semibold" style={{ color: origStatus === 'confirmed' ? 'var(--success)' : origStatus === 'declined' ? 'var(--danger)' : 'var(--muted-foreground)' }}>
                          {origStatus === 'confirmed' ? '已确认参加' : origStatus === 'declined' ? '已放弃' : '待确认'}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div key={s.id} className={`flex items-center justify-between rounded-[14px] p-3 ${inRerun ? 'ring-2 ring-[var(--success)]/20' : ''}`} style={{ background: 'oklch(1 0 0 / 0.5)' }}>
                      <span className="text-sm font-bold">{s.name}</span>
                      <button onClick={() => toggleRerunManual(s)} className={`neu-btn-xs ${inRerun ? 'is-danger' : 'is-success'}`}>
                        {inRerun ? <><X size={12} />移除</> : <><Plus size={12} />加入</>}
                      </button>
                    </div>
                  );
                })}
              </div>
              {/* 补选名单 sidebar (手动) */}
              <div className="lg:col-span-1 lg:sticky lg:top-20">
                <div className="rounded-[18px] p-4 space-y-3" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><Award size={14} className="text-[var(--accent)]" /><h2 className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">补选名单</h2></div>
                    <span className="tabular-nums text-[11px] font-bold text-[var(--foreground)]">{rerunShortlist.size}</span>
                  </div>
                  {rerunShortlist.size === 0 ? (
                    <div className="py-10 text-center"><Zap size={24} className="mx-auto mb-3 text-[var(--muted-foreground)]/25" /><p className="text-[11px] text-[var(--muted-foreground)]">搜索并加入供应商</p></div>
                  ) : (
                    <div className="space-y-1.5">
                      {[...rerunShortlist.entries()].map(([sid, { item: r }], idx) => {
                        const contact = r.contacts?.find(c => c.isPrimary) || r.contacts?.[0];
                        return (
                          <div key={sid} className="rounded-[12px] p-2.5 flex items-center gap-2 transition-shadow"
                            style={{ background: 'oklch(1 0 0 / 0.5)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5), 1px 1px 2px oklch(0.55 0.03 258 / 0.05)' }}>
                            <div className="flex flex-col gap-0.5 shrink-0">
                              <button onClick={() => moveRerunShortlistItem(idx, idx - 1)} disabled={idx === 0} className="p-0.5 text-[var(--muted-foreground)]/30 hover:text-[var(--muted-foreground)] disabled:opacity-15"><ChevronUp size={12} /></button>
                              <button onClick={() => moveRerunShortlistItem(idx, idx + 1)} disabled={idx === rerunShortlist.size - 1} className="p-0.5 text-[var(--muted-foreground)]/30 hover:text-[var(--muted-foreground)] disabled:opacity-15"><ChevronDown size={12} /></button>
                            </div>
                            <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[6px] text-[9px] font-extrabold text-white tabular-nums"
                              style={{ background: 'linear-gradient(135deg, oklch(0.55 0.14 150), oklch(0.48 0.12 150))' }}>{idx + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[12px] font-bold text-[var(--foreground)] truncate">{r.name}</span>
                                <button onClick={() => {
                                  setRerunShortlist(prev => { const n = new Map(prev); for (const [k, v] of n) { if (v.item.name === r.name) { n.delete(k); break; } } return n; });
                                }} className="shrink-0 text-[var(--muted-foreground)]/20 hover:text-[var(--danger)] transition"><X size={11} /></button>
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 text-[10px] tabular-nums">
                                <span className="font-bold" style={{ color: scoreVar(r.matchScore) }}>{r.matchScore}</span>
                                {contact && <span className="text-[var(--muted-foreground)] truncate">{contact.name}</span>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex gap-1.5 pt-1">
                        {rerunShortlist.size >= 2 && (
                          <button onClick={() => setShowCompare(true)} className="neu-btn-xs w-0 flex-1 justify-center gap-1.5"><Columns3 size={11} />横向对比</button>
                        )}
                        <button onClick={() => setRerunShortlist(new Map())} className="neu-btn-xs is-danger w-0 flex-1 justify-center gap-1"><X size={11} />清空</button>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-3 border-t border-[oklch(0.6_0.04_258_/_0.12)]">
                    <button onClick={() => { setIsRerun(false); setStep(baseConfirmStep); }} className="neu-btn-soft gap-2">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>上一步：第{rerunRound}轮确认
                    </button>
                    {rerunShortlist.size > 0 && (
                      <button onClick={() => setStep(rerunNotifyStep)} className="neu-btn-soft gap-2">
                        下一步：补选通知<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 补选通知步骤 ── */}
      {step === rerunNotifyStep && isRerun && currentRerunRound === rerunRound && (
        <div className="space-y-5">
          <div className="rounded-[20px] p-6 space-y-5" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88) 0%, oklch(0.985 0.005 258 / 0.58) 40%, oklch(1 0 0 / 0.14) 75%)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.75), 2px 3px 8px oklch(0.55 0.03 258 / 0.1), -2px -2px 8px oklch(1 0 0 / 0.88)' }}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">补选确认通知</h2>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  <strong className="tabular-nums text-[var(--foreground)]">{rerunShortlist.size}</strong> 家补选供应商
                  {rerunShortlist.size > 0 && <span className="ml-2">平均匹配度 <strong className="text-[var(--foreground)]">{Math.round([...rerunShortlist.values()].reduce((s, v) => s + v.item.matchScore, 0) / rerunShortlist.size)}</strong></span>}
                </p>
              </div>
            </div>

            {/* 候选标签云 */}
            <div className="flex flex-wrap gap-1.5">
              {[...rerunShortlist.entries()].map(([sid, { item: r }], idx) => (
                <span key={sid} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold text-[var(--foreground)]"
                  style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                  <span className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px] text-[9px] font-extrabold text-white tabular-nums"
                    style={{ background: 'linear-gradient(135deg, oklch(0.55 0.14 150), oklch(0.48 0.12 150))' }}>{idx + 1}</span>
                  {r.name}
                  <span className="text-[10px] font-bold tabular-nums" style={{ color: scoreVar(r.matchScore) }}>{r.matchScore}</span>
                </span>
              ))}
            </div>

            <div className="wb-section-rule" />

            {/* 渠道 + AI —— 标签 + 分组按钮同一行卡片 */}
            <div className="flex items-center gap-3 flex-wrap rounded-xl p-3" style={{ background: 'color-mix(in oklch, var(--accent) 5%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6)' }}>
              <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)] flex-shrink-0">
                <Send size={12} className="text-[var(--accent)]" />
                通知渠道
              </span>
              <div className="flex gap-1.5 items-center flex-wrap">
                {/* 站内 + 短信：内容一致，归为一组 */}
                <div className="flex gap-1 rounded-[8px] p-0.5" style={{ background: 'oklch(1 0 0 / 0.45)' }}>
                  {[
                    { key: 'in_app', label: '站内', icon: <MessageSquare size={13} /> },
                    { key: 'sms', label: '短信', icon: <Bell size={13} /> },
                  ].map(ch => {
                    const active = notifyChannels.includes(ch.key);
                    return (
                      <button key={ch.key}
                        onClick={() => setNotifyChannels(prev => active ? prev.filter(c => c !== ch.key) : [...prev, ch.key])}
                        className={`neu-tab flex-row items-center gap-1.5 py-1.5 px-3 ${active ? 'is-active' : ''}`}>
                        {ch.icon}<span className="text-[11px] font-semibold">{ch.label}</span>
                      </button>
                    );
                  })}
                </div>
                {/* 电话：内容独立（简短话术），单独一组 */}
                <div className="flex gap-1 rounded-[8px] p-0.5" style={{ background: 'oklch(1 0 0 / 0.45)' }}>
                  {[{ key: 'phone', label: '电话通知', icon: <Phone size={13} /> }].map(ch => {
                    const active = notifyChannels.includes(ch.key);
                    return (
                      <button key={ch.key}
                        onClick={() => setNotifyChannels(prev => active ? prev.filter(c => c !== ch.key) : [...prev, ch.key])}
                        className={`neu-tab flex-row items-center gap-1.5 py-1.5 px-3 ${active ? 'is-active' : ''}`}>
                        {ch.icon}<span className="text-[11px] font-semibold">{ch.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <span className="flex-1" />
              <button onClick={() => setRerunNotifyPerSupplier(new Map())} disabled={rerunNotifyPerSupplier.size === 0} className="neu-btn-xs gap-1 text-[var(--muted-foreground)]">
                <X size={10} />清空
              </button>
            </div>

            {/* 逐供应商通知：紧凑列表 + 点击查看展开编辑 */}
            <div className="space-y-2">
              {[...rerunShortlist.entries()].map(([sid, { item: r }], idx) => {
                const msg = rerunNotifyPerSupplier.get(sid);
                const hasContent = rerunNotifyPerSupplier.has(sid);
                const isExpanded = notifyActiveSupplier === sid;
                return (
                  <div key={sid}>
                    <div className={`rounded-[14px] px-3 py-2 flex items-center gap-2.5 transition-all ${hasContent ? '' : 'opacity-50'} ${isExpanded ? 'rounded-b-none' : ''}`}
                      style={{ background: isExpanded ? 'oklch(1 0 0 / 0.7)' : 'oklch(1 0 0 / 0.48)', boxShadow: `inset 0 1px 0 oklch(1 0 0 / ${hasContent ? '0.7' : '0.5'}), 1px 1px 3px oklch(0.55 0.03 258 / 0.06), -1px -1px 2px oklch(1 0 0 / 0.7)` }}>
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-[9px] font-extrabold text-white tabular-nums"
                        style={{ background: 'linear-gradient(135deg, oklch(0.55 0.14 150), oklch(0.48 0.12 150))' }}>{idx + 1}</span>
                      <span className="text-[11px] font-bold text-[var(--foreground)] truncate flex-1 min-w-0">{r.name}</span>
                      <span className="text-[10px] tabular-nums font-semibold shrink-0" style={{ color: scoreVar(r.matchScore) }}>{r.matchScore}</span>
                      {hasContent ? (
                        <button
                          onClick={() => setNotifyActiveSupplier(prev => prev === sid ? '' : sid)}
                          className="neu-btn-xs shrink-0 is-success">
                          <Check size={10} />{isExpanded ? '收起' : '查看'}
                        </button>
                      ) : (
                        <span className="text-[11px] italic text-[var(--muted-foreground)] shrink-0">请等待AI自动生成</span>
                      )}
                    </div>
                    {hasContent && isExpanded && (
                      <div className="rounded-b-[14px] p-4 space-y-4 border-t" style={{ background: 'oklch(1 0 0 / 0.58)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 3px 6px oklch(0.55 0.03 258 / 0.06), -1px -1px 3px oklch(1 0 0 / 0.75)', borderColor: 'oklch(0.6 0.04 258 / 0.1)' }}>
                        {/* 站内通知 / 短信通知 */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
                            <MessageSquare size={11} /><Bell size={11} /><span>站内通知 / 短信通知</span>
                          </div>
                          <input value={msg!.title}
                            onChange={e => setRerunNotifyPerSupplier(prev => { const n = new Map(prev); n.set(sid, { ...msg!, title: e.target.value }); return n; })}
                            placeholder="通知标题"
                            className="workbench-input w-full text-xs !h-8" />
                          <textarea value={msg!.body}
                            onChange={e => setRerunNotifyPerSupplier(prev => { const n = new Map(prev); n.set(sid, { ...msg!, body: e.target.value }); return n; })}
                            rows={10} className="neu-input w-full resize-y text-xs leading-relaxed !min-h-[200px]" />
                        </div>
                        {/* 电话通知话术 */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
                            <Phone size={11} /><span>电话通知话术</span>
                          </div>
                          <textarea value={msg!.phoneScript || ''}
                            onChange={e => setRerunNotifyPerSupplier(prev => { const n = new Map(prev); n.set(sid, { ...msg!, phoneScript: e.target.value }); return n; })}
                            rows={4} className="neu-input w-full resize-y text-xs leading-relaxed !min-h-[90px]" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

          </div>

          <div className="flex items-center justify-between">
            <button onClick={() => setStep(rerunPickStep)} className="neu-btn-soft gap-2">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>上一步：补选候选
            </button>
            <div className="flex items-center gap-2">
              <button onClick={handleRerunNotify} disabled={rerunNotifySending || rerunNotifyPerSupplier.size === 0}
                className="neu-btn-soft gap-2">
                <Bell size={14} />{rerunNotifySending ? '发送中…' : `一键通知 ${rerunShortlist.size} 家`}
              </button>
              <button onClick={() => setStep(finalConfirmStep)} disabled={!rerunNotified} className="neu-btn-soft gap-2" title={!rerunNotified ? '请先一键通知供应商' : undefined}>
                下一步：供应商确认<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 最终供应商确认步骤（正选 + 补选） ── */}
      {step === finalConfirmStep && isRerun && rerunNotified && currentRerunRound === rerunRound && (
        <div className="space-y-5">
          <div className="rounded-[20px] p-6 space-y-5" style={{ background: 'linear-gradient(105deg, oklch(1 0 0 / 0.88), oklch(1 0 0 / 0.18))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.7), 2px 2px 6px oklch(0.55 0.03 258 / 0.1), -2px -2px 6px oklch(1 0 0 / 0.82)' }}>
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px]" style={{ background: 'color-mix(in oklch, var(--success) 14%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                <ShieldCheck size={22} className="text-[var(--success)]" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-bold text-[var(--foreground)]">全部供应商确认状态</h3>
                <p className="text-[11px] text-[var(--muted-foreground)] mt-1 leading-relaxed">
                  共计 {shortlist.size + previousRerunShortlist.size + rerunShortlist.size} 家 · 正选 {shortlist.size} · 补选 {previousRerunShortlist.size + rerunShortlist.size}{rerunHistory.length > 0 ? `（${rerunHistory.length + 1} 轮）` : ''}
                </p>
                <div className="mt-3 flex items-center gap-x-4 gap-y-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="flex h-1.5 w-32 rounded-full overflow-hidden" style={{ background: 'color-mix(in oklch, var(--muted-foreground) 12%, transparent)' }}>
                      {allConfirmationStats.total > 0 && allConfirmationStats.confirmed > 0 && (
                        <div className="h-full transition-[width] duration-500" style={{ width: `${allConfirmationStats.confirmed / allConfirmationStats.total * 100}%`, background: 'var(--success)' }} />
                      )}
                      {allConfirmationStats.total > 0 && allConfirmationStats.declined > 0 && (
                        <div className="h-full transition-[width] duration-500" style={{ width: `${allConfirmationStats.declined / allConfirmationStats.total * 100}%`, background: 'var(--danger)' }} />
                      )}
                    </div>
                    <span className="text-[11px] tabular-nums font-bold text-[var(--foreground)]">{allConfirmationStats.confirmed}/{allConfirmationStats.total}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] tabular-nums">
                    <span className="font-bold text-[var(--success)]">{allConfirmationStats.confirmed} 已确认</span>
                    <span className="text-[var(--muted-foreground)]">{allConfirmationStats.pending} 待确认</span>
                    {allConfirmationStats.declined > 0 && <span className="font-bold text-[var(--danger)]">{allConfirmationStats.declined} 已放弃</span>}
                  </div>
                </div>
              </div>
            </div>

            {/* 正选供应商 */}
            <div className="space-y-1.5">
              <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)] mb-1">正选供应商</div>
              {[...shortlist.entries()].map(([sid, { item: r }]) =>
                renderSupplierRow(sid, r, [...allShortlist.keys()].indexOf(sid), allSupplierStatuses.get(sid) || 'pending', () => cycleConfirmation(sid), '正选', undefined, true)
              )}
            </div>

            {/* 历史轮次补选 */}
            {rerunHistory.length > 0 && rerunHistory.map((h, roundIdx) => (
              <div key={roundIdx} className="space-y-1.5">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)] mb-1">补选供应商（第{roundIdx + 1}轮）</div>
                {[...h.shortlist.entries()].map(([sid, { item: r }]) =>
                  renderSupplierRow(sid, r, [...allShortlist.keys()].indexOf(sid), allSupplierStatuses.get(sid) || 'pending', () => {
                    setRerunHistory(prev => { const n = [...prev]; const cm = new Map(n[roundIdx].confirmations); const cur = cm.get(sid) || 'pending'; cm.set(sid, cur === 'pending' ? 'confirmed' : cur === 'confirmed' ? 'declined' : 'pending'); n[roundIdx] = { ...n[roundIdx], confirmations: cm }; return n; });
                  }, '补选', undefined, true)
                )}
              </div>
            ))}

            {/* 当前轮次补选 */}
            {rerunShortlist.size > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)] mb-1">补选供应商（第{rerunHistory.length + 1}轮）</div>
                {[...rerunShortlist.entries()].map(([sid, { item: r }]) =>
                  renderSupplierRow(sid, r, [...allShortlist.keys()].indexOf(sid), allSupplierStatuses.get(sid) || 'pending', () => {
                    setRerunConfirmations(prev => { const n = new Map(prev); const cur = n.get(sid) || 'pending'; n.set(sid, cur === 'pending' ? 'confirmed' : cur === 'confirmed' ? 'declined' : 'pending'); return n; });
                  }, '补选', undefined, true)
                )}
              </div>
            )}

            {/* 底部操作按钮 */}
            <div className="flex items-center justify-between pt-2">
              <button onClick={() => setStep(rerunNotifyStep)} className="neu-btn-soft gap-2">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>上一步：补选通知
              </button>
              <button onClick={continueRerun} className="neu-btn-soft gap-2">
                <Plus size={14} />继续补选
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ═══ 补选弹窗 ═══ */}
      {showRerunDialog && (
        <div className="fixed inset-0 z-[750] flex items-center justify-center">
          <div className="absolute inset-0" style={{ background: 'oklch(0.1 0.02 258 / 0.42)', backdropFilter: 'blur(4px)' }} onClick={() => setShowRerunDialog(false)} />
          <div className="relative z-10 mx-4 w-full max-w-[400px] rounded-[22px] p-6" style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.95), oklch(0.985 0.005 258 / 0.65))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 4px 5px 18px oklch(0.45 0.07 258 / 0.2), -2px -2px 8px oklch(1 0 0 / 0.9)' }}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <h2 className="text-[0.95rem] font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">补选</h2>
              <button type="button" onClick={() => setShowRerunDialog(false)} className="neu-btn-xs"><X size={16} /></button>
            </div>
            <p className="text-sm leading-[1.6] text-[color:var(--muted-foreground)] mb-4">
              当前已选 {shortlist.size} 家供应商（含 {confirmedCount} 家已确认），补选不会清除已有名单。
            </p>
            <div className="space-y-2.5">
              <button type="button" onClick={() => confirmRerun('ai')} className="neu-card group flex w-full items-center gap-3 rounded-[16px] px-4 py-3.5 text-left">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]" style={{ background: 'color-mix(in oklch, var(--accent) 14%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}>
                  <Sparkles size={17} className="text-[var(--accent)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">智能选取</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-[var(--muted-foreground)]">沿用当前业务标签和采购需求，重新推荐</div>
                </div>
              </button>
              <button type="button" onClick={() => confirmRerun('manual')} className="neu-card group flex w-full items-center gap-3 rounded-[16px] px-4 py-3.5 text-left">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]" style={{ background: 'color-mix(in oklch, var(--accent) 14%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}>
                  <Search size={17} className="text-[var(--accent)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">人工选取</div>
                  <div className="mt-0.5 text-[11px] leading-4 text-[var(--muted-foreground)]">直接搜索供应商名称，逐家加入候选名单</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
      {detailSupplier && (
        <div className="fixed inset-0 z-[750] flex items-center justify-center" onClick={() => setDetailSupplier(null)}>
          <div className="absolute inset-0" style={{ background: 'oklch(0.1 0.02 258 / 0.45)', backdropFilter: 'blur(4px)' }} />
          <div className="relative z-10 mx-4 w-full max-w-[520px] max-h-[85vh] overflow-y-auto rounded-[24px] p-6"
            style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.96), oklch(0.99 0.003 258 / 0.72))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 3px 4px 16px oklch(0.46 0.07 258 / 0.2), -3px -3px 10px oklch(1 0 0 / 0.92)' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]" style={{ background: 'color-mix(in oklch, var(--accent-soft) 45%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.1)' }}>
                  <Building2 size={16} className="text-[var(--accent)]" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[var(--foreground)] truncate">{detailSupplier.name}</div>
                  <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">供应商详情</div>
                </div>
              </div>
              <button onClick={() => setDetailSupplier(null)} className="neu-btn-soft !p-2"><X size={16} /></button>
            </div>

            {detailLoading ? (
              <div className="py-12 flex items-center justify-center"><RefreshCw size={22} className="animate-spin text-[var(--accent)]" /></div>
            ) : detailData ? (
              <div className="space-y-4">
                {/* 基本信息 */}
                <div className="rounded-[16px] p-4 space-y-2.5" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.75)' }}>
                  <h4 className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">基本信息</h4>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                    {detailData.creditCode && <div><span className="text-[var(--muted-foreground)]">信用代码</span><p className="font-semibold text-[var(--foreground)]">{detailData.creditCode}</p></div>}
                    {detailData.legalPerson && <div><span className="text-[var(--muted-foreground)]">法定代表人</span><p className="font-semibold text-[var(--foreground)]">{detailData.legalPerson}</p></div>}
                    {detailData.enterpriseType && <div><span className="text-[var(--muted-foreground)]">企业类型</span><p className="font-semibold text-[var(--foreground)]">{normalizeEnterpriseType(detailData.enterpriseType)}</p></div>}
                    {detailData.registeredCapital && <div><span className="text-[var(--muted-foreground)]">注册资本</span><p className="font-semibold text-[var(--foreground)]">{detailData.registeredCapital}</p></div>}
                    {detailData.establishedDate && <div><span className="text-[var(--muted-foreground)]">成立日期</span><p className="font-semibold text-[var(--foreground)]">{detailData.establishedDate.slice(0, 10)}</p></div>}
                  </div>
                  {detailData.businessScope && (
                    <div>
                      <span className="text-[var(--muted-foreground)] text-[10px]">经营范围</span>
                      <p className="text-[11px] leading-relaxed text-[var(--foreground)] mt-0.5">{detailData.businessScope.slice(0, 200)}{detailData.businessScope.length > 200 ? '…' : ''}</p>
                    </div>
                  )}
                </div>

                {/* 联系人 */}
                {(detailData.contacts?.length > 0 || detailData.address || detailData.phone || detailData.email) && (
                  <div className="rounded-[16px] p-4 space-y-2.5" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.75)' }}>
                    <h4 className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">联系信息</h4>
                    <div className="space-y-1.5 text-[11px]">
                      {detailData.address && <div className="flex items-start gap-2"><MapPin size={12} className="text-[var(--muted-foreground)] mt-0.5 shrink-0" /><span className="text-[var(--foreground)]">{detailData.address}</span></div>}
                      {detailData.phone && <div className="flex items-center gap-2"><Phone size={12} className="text-[var(--muted-foreground)] shrink-0" /><span className="text-[var(--foreground)]">{detailData.phone}</span></div>}
                      {detailData.email && <div className="flex items-center gap-2"><Mail size={12} className="text-[var(--muted-foreground)] shrink-0" /><span className="text-[var(--foreground)]">{detailData.email}</span></div>}
                      {detailData.contacts?.map((c: any, i: number) => (
                        <div key={i} className="flex items-center gap-2"><User size={12} className="text-[var(--muted-foreground)] shrink-0" /><span className="text-[var(--foreground)]">{c.name}{c.phone ? ` · ${c.phone}` : ''}{c.isPrimary ? <span className="ml-1 text-[10px] font-bold text-[var(--accent)]">主联系人</span> : ''}</span></div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 评价 / 资料完整度 */}
                {detailData.completeness !== undefined && (
                  <div className="rounded-[16px] p-4 space-y-2.5" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 1px 2px 4px oklch(0.55 0.03 258 / 0.08), -1px -1px 3px oklch(1 0 0 / 0.75)' }}>
                    <h4 className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">资质概览</h4>
                    <div className="flex flex-wrap gap-2 text-[11px]">
                      {detailData.completeness !== undefined && <span className="inline-flex items-center rounded-[6px] px-2.5 py-1 font-semibold text-[var(--muted-foreground)]" style={{ background: 'color-mix(in oklch, var(--muted-foreground) 8%, transparent)' }}>资料完整度 {detailData.completeness}%</span>}
                    </div>
                    {detailData.qualifications?.length > 0 && (
                      <div className="space-y-1 mt-2">
                        {detailData.qualifications.slice(0, 5).map((q: any, i: number) => (
                          <div key={i} className="flex items-center justify-between text-[10px] text-[var(--muted-foreground)]">
                            <span>{q.name || q.fileName}</span>
                            <span>{q.expiryDate ? `有效期至 ${q.expiryDate.slice(0, 10)}` : ''}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-10 text-center text-sm text-[var(--muted-foreground)]">无法加载供应商详情</div>
            )}
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
            placeholder={`分享备注（必填），如：已根据水利工程施工需求筛选，建议约谈以下 ${shortlist.size} 家供应商。重点标签：水利工程施工、设备供应`}
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

    </div>
  );
}

export default function SupplierSelectionPageWrapper() {
  return <SupplierSelectionPage />;
}
