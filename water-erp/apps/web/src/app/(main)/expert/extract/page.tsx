'use client';

import { useEffect, useState, Suspense, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { listBidProjects, previewExtraction, confirmExtraction, sendExtractionNotify, prersvpLinks, getExtractionHistory, listSpecialties, listExperts, getBidProjectDetail, generateNotification, getProjectInvitations, confirmInvitation, declineInvitation, retrospectExtraction, analyzeExtractionFiles, analyzeProjectSpecialties, createCustomProject, uploadExtractionFile, type BidProjectOption, type BidProjectDetail, type ExtractionPreview, type CandidatePoolItem, type ExtractionSelected, type ExpertListItem, type ExtractionFileAnalysis } from '@/lib/api/expert';
import { StatusBadge, Modal } from '@/components/workbench';
import { RulesPopover } from '@/components/rules-popover';
import { StepTrack } from '@/components/step-track';
import { STAGE_LABEL } from '@water-erp/shared';
import { Sparkles, ShieldCheck, AlertTriangle, Check, X, RefreshCw, UsersRound, MessageSquare, Phone, Bell, Pencil, Plus, Clock, FileText, UserCircle, Search, ClipboardList, Upload, Loader2, Brain, Send } from 'lucide-react';


interface SpecialtyQuota { specialty: string; count: number; }

type ExtractMode = 'specialty_match' | 'random' | 'merit_best' | 'manual';
type ApiExtractMode = Exclude<ExtractMode, 'manual'>;
const MODE_LABELS: Record<ExtractMode, string> = { specialty_match: '专业匹配', random: '随机抽取', merit_best: '综合择优', manual: '专家选取' };
const MODE_DESCS: Record<ExtractMode, string> = {
  specialty_match: '按专业契合度加权抽取，优先专业对口，AI 推断各专业配比',
  random: '在各专业配额内加密随机抽签，公平合规、机会均等，不做能力排序',
  merit_best: '在各专业配额内按履职等级+偏离度+负荷+经验综合打分，择优录取',
  manual: '直接搜索专家姓名/专业/单位，人工精确指定评审组成员',
};

export function ExpertExtractPage({
  hideHeader,
  defaultProjectTitle,
  defaultPid,
  autoExtractResult,
}: {
  hideHeader?: boolean;
  defaultProjectTitle?: string;
  /** 由调用方（ExpertExtractModal）定位后直接传入的 bid project ID，不走页面内模糊匹配 */
  defaultPid?: string | null;
  autoExtractResult?: {
    preview: ExtractionPreview;
    selected: ExtractionSelected[];
    alternatives: ExtractionSelected[];
    quotas: { specialty: string; count: number }[];
    pid: string;
    notifyMessage: string;
  } | null;
}) {
  const router = useRouter(); const q = useSearchParams();
  const [projects, setProjects] = useState<BidProjectOption[]>([]);
  const [specs, setSpecs] = useState<string[]>([]);
  const [pid, setPid] = useState(q.get('projectId') || '');
  const [pd, setPd] = useState<BidProjectDetail | null>(null);
  const [pool, setPool] = useState<Map<string, number>>(new Map());
  const [tn, setTn] = useState(5); const [alt, setAlt] = useState(2);
  const [extractMode, setExtractMode] = useState<ExtractMode>('random');
  // ── 补选：弹窗内闭环（抽取→审核→一键通知），步骤4 只记录历史，不占主轨道 ──
  const ORDINAL = ['', '一', '二', '三', '四', '五', '六', '七'];
  // 已入库的补选轮次记录（步骤4 工作区展示 + 支持重开继续通知）
  type ReHistoryItem = {
    roundNo: number;               // 第几次补选（1-based）
    preview: ExtractionPreview | null;
    selected: ExtractionSelected[];
    alternatives: ExtractionSelected[];
    expertIds: string[];           // 入库的 BidExpert userId（按此从 invitationData 取回复）
    confirmed: boolean;            // 是否已 append 入库
    notified: boolean;             // 本轮是否已通知
  };
  const [reHistory, setReHistory] = useState<ReHistoryItem[]>([]);
  // 当前进行中的补选草稿（null = 弹窗关闭）；仅一个并发轮次
  type ReDraft = {
    phase: 'extracting' | 'configuring' | 'review' | 'sending' | 'done';
    preview: ExtractionPreview | null;
    selected: ExtractionSelected[];
    alternatives: ExtractionSelected[];
    quotas: SpecialtyQuota[];          // 配置阶段 AI 推荐的补选配额（用户可手动调整人数）
    confirmed: boolean;                // 已 append 入库
    notified: boolean;                 // 已一键通知
    expertIds: string[];
    roundNo: number;
  };
  const [reDraft, setReDraft] = useState<ReDraft | null>(null);
  const updateDraft = (patch: Partial<ReDraft>) => setReDraft(prev => prev ? { ...prev, ...patch } : prev);
  const [showReNotifyPreview, setShowReNotifyPreview] = useState(false); // 弹窗内通知内容预览展开
  const [reShortfallSpecs, setReShortfallSpecs] = useState<string[]>([]); // 池不足时需调整的专业列表
  // 步骤6：候补专家抽取与确认
  const [altPreview, setAltPreview] = useState<ExtractionPreview | null>(null);
  const [altSelected, setAltSelected] = useState<ExtractionSelected[]>([]);
  const [altExtracting, setAltExtracting] = useState(false);
  const [altNotified, setAltNotified] = useState(false);
  const [altNotifying, setAltNotifying] = useState(false);
  const [quotas, setQuotas] = useState<SpecialtyQuota[]>([{ specialty: '', count: 2 }]);
  // 需求方代表配置
  const [needDemandRep, setNeedDemandRep] = useState(false);
  const [demandRepMode, setDemandRepMode] = useState<'designated' | 'department' | null>(null);
  const [demandRepPersons, setDemandRepPersons] = useState<{ userId: string; name: string; specialty: string }[]>([]);
  const [demandRepCount, setDemandRepCount] = useState(1); // 需求方代表人数（>100万可选 1 或 2；≤100万固定 1）
  const [demandRepDept, setDemandRepDept] = useState('');
  const [demandRepDeptSpecialty, setDemandRepDeptSpecialty] = useState('');
  const [demandRepSearch, setDemandRepSearch] = useState('');
  const [demandRepResults, setDemandRepResults] = useState<ExpertListItem[]>([]);
  const [demandRepSearching, setDemandRepSearching] = useState(false);
  const [employers, setEmployers] = useState<string[]>([]); // 部门列表（专家工作单位去重）
  const [employerSpecs, setEmployerSpecs] = useState<Map<string, string[]>>(new Map()); // 部门 → 该部门专家的可选专业
  const [step, setStep] = useState(1); // 向导步骤：1=抽取配置 2=审核调整 3=确认通知 4=专家确认
  const [loading, setLoading] = useState(false); const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(''); const [preview, setPreview] = useState<ExtractionPreview | null>(null); const [done, setDone] = useState(false);
  // 手动调整后的名单
  const [selectedExperts, setSelectedExperts] = useState<ExtractionSelected[]>([]);
  const [alternativeExperts, setAlternativeExperts] = useState<ExtractionSelected[]>([]);
  const [leadExpertId, setLeadExpertId] = useState<string | null>(null);
  const [step3Confirmed, setStep3Confirmed] = useState(false); // 步骤3确认后启用下一步
  // 替换弹窗
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<{ userId: string; role: 'selected' | 'alternative' } | null>(null);
  const [replaceSearch, setReplaceSearch] = useState('');
  const [notifyChannelsByExpert, setNotifyChannelsByExpert] = useState<Map<string, string[]>>(new Map());
  const [notifyMessages, setNotifyMessages] = useState<Map<string, string>>(new Map());
  const [notifyVersion, setNotifyVersion] = useState(0);
  const updateMessages = (next: Map<string, string>) => { setNotifyMessages(next); setNotifyVersion(v => v + 1); };
  const [notifyActiveExpert, setNotifyActiveExpert] = useState<string>('');
  const [openTimeDate, setOpenTimeDate] = useState('');
  const [openTimeTime, setOpenTimeTime] = useState('');
  const openTimeFormatted = openTimeDate
    ? `${openTimeDate.replace(/-/g, '年').replace(/^(\d{4})年(\d{2})年(\d{2})$/, '$1年$2月$3日')} ${openTimeTime || '00:00'}`
    : '';
  const [notifying, setNotifying] = useState(false);
  const [notifyResults, setNotifyResults] = useState<any>(null);
  const [confirmedExpertIds, setConfirmedExpertIds] = useState<string[]>([]);
  const [notifyExpertList, setNotifyExpertList] = useState<ExtractionSelected[]>([]);
  // 候补专家通知状态
  const [candidateNotifiedIds, setCandidateNotifiedIds] = useState<string[]>([]);
  // 预排除专家（随机抽取 / 综合择优模式下可用）
  const [excludedExpertIds, setExcludedExpertIds] = useState<string[]>([]);
  const [excludedExpertMap, setExcludedExpertMap] = useState<Map<string, { name: string; specialty: string }>>(new Map());
  const [excludeSearch, setExcludeSearch] = useState('');
  const [excludeResults, setExcludeResults] = useState<ExpertListItem[]>([]);
  const [excludeSearching, setExcludeSearching] = useState(false);
  // 专家选取
  const [manualSearch, setManualSearch] = useState('');
  const [manualResults, setManualResults] = useState<ExpertListItem[]>([]);
  const [manualSearching, setManualSearching] = useState(false);
  const [manualExperts, setManualExperts] = useState<ExtractionSelected[]>([]);
  // 抽取历史弹窗
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState<{ total: number; page: number; pageSize: number; items: any[] } | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  // 抽取质量复盘
  const [retrospect, setRetrospect] = useState<{ loading: boolean; data: Awaited<ReturnType<typeof retrospectExtraction>> | null } | null>(null);
  // 专家确认状态
  const [invitationData, setInvitationData] = useState<Awaited<ReturnType<typeof getProjectInvitations>> | null>(null);
  // 自定义项目（文件上传 + AI 分析 + 影子项目）
  const [projectSource, setProjectSource] = useState<'existing' | 'custom'>('existing');
  const [customFiles, setCustomFiles] = useState<{ id: string; name: string; size: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [quotaAnalyzing, setQuotaAnalyzing] = useState(false); // AI 配额推断中
  const [analysis, setAnalysis] = useState<ExtractionFileAnalysis | null>(null);
  const [customName, setCustomName] = useState('');
  const [customMethod, setCustomMethod] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoAnalyzedRef = useRef(false);
  // 通知发送标记（ref 不受 state 重置影响，补选 flow 里 done=false 后仍能判定已通知）
  const notifySentRef = useRef(false);
  // 原始正选专家组 userId 集合（步骤2确认入的，不受补选覆盖），步骤4仅展示此集合内专家
  const originalConfirmedIdsRef = useRef<Set<string>>(new Set());
  // 上次补选用户确认的专业配额（跳过 configuring 直接抽取，直到该专业池空）
  const lastReQuotasRef = useRef<{ specialty: string; count: number }[]>([]);
  // 由调用方传入的 defaultPid 在一次匹配成功后标记为已消费，避免后续 deps 变化重复触发
  const defaultPidAppliedRef = useRef(false);
  // 会话恢复标记：本次 pid 由 localStorage 恢复写入时记录，[pid] effect 对该 pid 跳过一次重置
  const restoredPidRef = useRef('');
  // [pid] effect 是否已以非空 pid 真正执行过（首次挂载时状态均为初始值，无需重置）
  const pidEffectRanRef = useRef(false);
  // 搜索竞态守卫：递增 requestId，过期响应直接丢弃，避免旧结果覆盖新结果
  const manualReqIdRef = useRef(0);
  const excludeReqIdRef = useRef(0);
  const storageKey = 'expert-extract-session';
  const LAST_PID_KEY = 'expert-extract-last-pid';

  // 步骤3 渲染时：拉 RSVP 链接、替换占位符、查服务端通知状态（补选已无独立通知步，一键发送时即时拉取）
  useEffect(() => {
    if (step !== 3 || !pid) return;
    (async () => {
      let links = rsvpLinks;
      if (!Object.keys(links).length) {
        try { const d = await prersvpLinks(pid); links = d.links || {}; setRsvpLinks(links); } catch { return; }
      }
      // 替换已有通知内容中的 {RSVP_LINK} 占位符
      const updated = new Map(notifyMessages);
      let changed = false;
      for (const [uid, msg] of updated) {
        if (msg.includes('{RSVP_LINK}') && links[uid]) {
          updated.set(uid, msg.replace(/\{RSVP_LINK\}/g, links[uid]));
          changed = true;
        }
      }
      if (changed) updateMessages(updated);
    })();
    // 并行查询服务端专家通知状态（BidExpert 表有 token 即已通知）
    getProjectInvitations(pid).then(setInvitationData).catch(() => {});
  }, [step, pid, notifyVersion]);
  useEffect(() => {
    // 步骤4/5 + 补选弹窗打开时：轮询服务端回复状态（实时反映专家确认/拒绝）
    if ((step !== 4 && step !== 5 && !reDraft) || !pid) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
      try {
        const data = await getProjectInvitations(pid);
        setInvitationData(data);
        // 所有邀请均为终态（confirmed/declined，无 pending）时清除轮询定时器
        if (data.experts.length > 0 && data.experts.every(e => e.invitationStatus !== 'pending') && timer) {
          clearInterval(timer);
        }
      } catch {}
    };
    poll();
    timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  }, [step, pid, reDraft]);

  // 步骤6：进入时自动抽取候补专家（仅首次，已抽过时直接展示）
  useEffect(() => {
    if (step !== 6 || !pid || altPreview) return;
    extractAlternates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, pid, altPreview]);

  // 状态变更时自动保存到 localStorage（页面切换后恢复）
  const stateRef = useRef({ pid, step, extractMode, quotas, selectedExperts, alternativeExperts, leadExpertId, preview, done, notifyResults, confirmedExpertIds, manualExperts, openTimeDate, openTimeTime, tn, alt, error, pd, step3Confirmed, candidateNotifiedIds, reHistory });
  stateRef.current = { pid, step, extractMode, quotas, selectedExperts, alternativeExperts, leadExpertId, preview, done, notifyResults, confirmedExpertIds, manualExperts, openTimeDate, openTimeTime, tn, alt, error, pd, step3Confirmed, candidateNotifiedIds, reHistory };
  useEffect(() => {
    const save = () => {
      const s = stateRef.current;
      if (!s.pid) return;
      localStorage.setItem(`${storageKey}-${s.pid}`, JSON.stringify({ ...s, notifyMessagesArr: [...notifyMessages.entries()] }));
      localStorage.setItem(LAST_PID_KEY, s.pid);
    };
    window.addEventListener('beforeunload', save);
    return () => { save(); window.removeEventListener('beforeunload', save); };
  }, [storageKey, notifyMessages]);

  // 初始化时从 localStorage 恢复状态（按项目唯一性匹配）
  useEffect(() => {
    try {
      // 确定要恢复的项目：URL 指定 > 上次会话
      const urlPid = q.get('projectId');
      const targetPid = urlPid || localStorage.getItem(LAST_PID_KEY);
      if (!targetPid) return;
      // URL 已指定项目时，只恢复该项目会话，不恢复其他项目
      if (urlPid && targetPid !== urlPid) return;
      const raw = localStorage.getItem(`${storageKey}-${targetPid}`);
      if (!raw || autoAnalyzedRef.current) return;
      const snap = JSON.parse(raw);
      if (snap.pid) { restoredPidRef.current = snap.pid; setPid(snap.pid); }
      if (snap.extractMode) setExtractMode(snap.extractMode);
      if (snap.quotas?.length) setQuotas(snap.quotas);
      if (snap.selectedExperts?.length) setSelectedExperts(snap.selectedExperts);
      if (snap.alternativeExperts?.length) setAlternativeExperts(snap.alternativeExperts);
      if (snap.leadExpertId != null) setLeadExpertId(snap.leadExpertId);
      if (snap.preview) setPreview(snap.preview);
      if (snap.done) setDone(snap.done);
      if (snap.notifyResults) setNotifyResults(snap.notifyResults);
      if (snap.confirmedExpertIds?.length) { setConfirmedExpertIds(snap.confirmedExpertIds); originalConfirmedIdsRef.current = new Set(snap.confirmedExpertIds); setStep3Confirmed(true); }
      if (snap.reHistory?.length) setReHistory(snap.reHistory);
      if (snap.step3Confirmed) setStep3Confirmed(snap.step3Confirmed);
      if (snap.candidateNotifiedIds?.length) setCandidateNotifiedIds(snap.candidateNotifiedIds);
      if (snap.manualExperts?.length) setManualExperts(snap.manualExperts);
      if (snap.notifyMessagesArr?.length) setNotifyMessages(new Map(snap.notifyMessagesArr));
      if (snap.openTimeDate) setOpenTimeDate(snap.openTimeDate);
      if (snap.openTimeTime) setOpenTimeTime(snap.openTimeTime);
      if (snap.tn != null) setTn(snap.tn);
      if (snap.alt != null) setAlt(snap.alt);
      if (snap.error) setError(snap.error);
      if (snap.pd) setPd(snap.pd);
      if (snap.step) setStep(snap.step);
    } catch { localStorage.removeItem(LAST_PID_KEY); }
  }, []);
  useEffect(() => {
    if (!autoExtractResult || autoAnalyzedRef.current) return;
    autoAnalyzedRef.current = true;
    setPid(autoExtractResult.pid);
    setQuotas(autoExtractResult.quotas);
    setPreview(autoExtractResult.preview);
    setSelectedExperts(autoExtractResult.selected);
    setAlternativeExperts(autoExtractResult.alternatives);
    setNotifyMessages(new Map(autoExtractResult.selected.map((s: ExtractionSelected) => [s.userId, autoExtractResult.notifyMessage])));
    setStep(2); // 已有抽取结果 → 直接进入审核调整
  }, [autoExtractResult]);

  useEffect(() => { listBidProjects().then(setProjects).catch(() => toast.error('加载项目列表失败')); listSpecialties().then(setSpecs).catch(() => {}); }, []);

  // 从 modal 传入 defaultPid 时预选该项目（不自动抽取，由用户在步骤1配置后手动「开始抽取」）
  useEffect(() => {
    if (!defaultPid || defaultPidAppliedRef.current) return;
    defaultPidAppliedRef.current = true;
    setPid(defaultPid);
  }, [defaultPid]);

  // 回退：无 defaultPid 时根据项目名称模糊匹配并预选（不自动抽取）
  useEffect(() => {
    if (defaultPid) return;
    if (!defaultProjectTitle || !projects.length || autoAnalyzedRef.current) return;
    const match = projects.find(
      p => p.name === defaultProjectTitle || p.name.includes(defaultProjectTitle) || defaultProjectTitle.includes(p.name),
    );
    if (!match) return;
    autoAnalyzedRef.current = true;
    setPid(match.id);
  }, [defaultProjectTitle, defaultPid, projects]);

  useEffect(() => {
    if (!pid) { setPd(null); return; }
    getBidProjectDetail(pid).then(setPd).catch(() => setPd(null));
    const firstRealRun = !pidEffectRanRef.current;
    pidEffectRanRef.current = true;
    // 跳过重置的两种情形：
    // 1) 首次以非空 pid 执行（挂载时各状态均为初始值，无内容可清）；
    // 2) 该 pid 来自 localStorage 恢复——必须保留刚恢复的名单/预览/完成态，否则恢复等于无效
    if (firstRealRun || restoredPidRef.current === pid) { restoredPidRef.current = ''; return; }
    // 切换项目后清空已选专家和抽取结果，避免跨项目混淆
    setSelectedExperts([]);
    setAlternativeExperts([]);
    setManualExperts([]);
    setLeadExpertId(null);
    setPreview(null);
    setDone(false);
    notifySentRef.current = false;
    // 重置需求方代表配置（预算/项目变化时 demandRepCount 可能不再适用）
    setNeedDemandRep(false);
    setDemandRepMode(null);
    setDemandRepPersons([]);
    setDemandRepCount(1);
    setDemandRepDept('');
    setDemandRepDeptSpecialty('');
    setError('');
    lastReQuotasRef.current = [];
  }, [pid]);
  useEffect(() => { if (!pid || specs.length === 0) return; Promise.all(specs.map(s => listExperts({ specialty: s }).then(l => ({ s, c: Array.isArray(l) ? l.length : 0 })))).then(rs => { const m = new Map<string, number>(); rs.forEach(({ s, c }) => { if (c > 0) m.set(s, c); }); setPool(m); }).catch(() => {}); }, [pid, specs]);

  // 已有项目 AI 自动推断专业配额（pd 加载后、且用户尚未手动配置配额时触发）
  useEffect(() => {
    if (!pid || !pd || specs.length === 0) return;
    // 已有用户手动填写的专业 → 不覆盖（含 localStorage 恢复及用户主动选择）
    if (quotas.some(q => q.specialty.trim())) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await analyzeProjectSpecialties(pid);
        if (cancelled) return;
        if (!res.requiredSpecialties?.length) return;
        const matchSpec = (sp: string): string => {
          const t = sp.trim();
          if (!t) return '';
          if (specs.includes(t)) return t;
          return specs.find(x => x.includes(t) || t.includes(x)) || '';
        };
        const merged = new Map<string, number>();
        for (const s of res.requiredSpecialties) {
          const key = matchSpec(s.specialty);
          if (!key) continue;
          merged.set(key, (merged.get(key) ?? 0) + Math.max(1, s.count));
        }
        const newQuotas = Array.from(merged.entries()).map(([specialty, count]) => ({ specialty, count }));
        if (newQuotas.length > 0 && !cancelled) {
          setQuotas(clampToExpertSeats(newQuotas));
        }
      } catch {
        // 静默失败，AI 不可用时用户可手动配置
      }
    })();
    return () => { cancelled = true; };
    // 配额依赖仅作为"是否已有配置"的守卫取值，不应触发重新分析
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, pd, specs]);

  // 专家选取：搜索专家（防抖 300ms）
  useEffect(() => {
    if (extractMode !== 'manual' || !manualSearch.trim()) { setManualResults([]); return; }
    const t = setTimeout(async () => {
      setManualSearching(true);
      const rid = ++manualReqIdRef.current;
      try {
        const list = await listExperts({ search: manualSearch.trim() }) as ExpertListItem[];
        if (rid !== manualReqIdRef.current) return;
        setManualResults(list);
      } catch {
        if (rid !== manualReqIdRef.current) return;
        setManualResults([]);
      }
      setManualSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [manualSearch, extractMode]);

  // 部门列表：一次性拉取全部专家，按工作单位去重（供需求方代表「选择部门」）
  useEffect(() => {
    listExperts({}).then(list => {
      const empSpecs = new Map<string, Set<string>>();
      for (const e of (list as ExpertListItem[])) {
        const emp = e.expertProfile?.employer?.trim();
        if (!emp) continue;
        if (!empSpecs.has(emp)) empSpecs.set(emp, new Set());
        const sp = e.expertProfile?.specialty?.trim();
        if (sp) empSpecs.get(emp)!.add(sp);
      }
      setEmployers([...empSpecs.keys()].sort());
      setEmployerSpecs(new Map([...empSpecs.entries()].map(([k, v]) => [k, [...v].sort()])));
    }).catch(() => {});
  }, []);

  // 指定需求方代表：搜索专家（防抖 300ms）
  const demandRepReqIdRef = useRef(0);
  useEffect(() => {
    if (demandRepMode !== 'designated' || !demandRepSearch.trim()) { setDemandRepResults([]); return; }
    const t = setTimeout(async () => {
      setDemandRepSearching(true);
      const rid = ++demandRepReqIdRef.current;
      try {
        const list = await listExperts({ search: demandRepSearch.trim() }) as ExpertListItem[];
        if (rid !== demandRepReqIdRef.current) return;
        setDemandRepResults(list);
      } catch {
        if (rid !== demandRepReqIdRef.current) return;
        setDemandRepResults([]);
      }
      setDemandRepSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [demandRepSearch, demandRepMode]);

  const addManualExpert = (e: ExpertListItem) => {
    if (manualExperts.some(x => x.userId === e.id)) return;
    setManualExperts(prev => [...prev, {
      userId: e.id,
      name: e.displayName,
      specialty: e.expertProfile?.specialty ?? '',
      title: e.expertProfile?.title || null,
      employer: e.expertProfile?.employer || null,
      matchScore: 100,
      reason: '管理员手动指定',
      role: '正选',
    }]);
  };
  const removeManualExpert = (userId: string) => setManualExperts(prev => prev.filter(x => x.userId !== userId));

  // 预排除：搜索专家（防抖 300ms，随机抽取/综合择优模式下可用）
  useEffect(() => {
    if (!excludeSearch.trim() || (extractMode !== 'random' && extractMode !== 'merit_best')) { setExcludeResults([]); return; }
    const t = setTimeout(async () => {
      setExcludeSearching(true);
      const rid = ++excludeReqIdRef.current;
      try {
        const list = await listExperts({ search: excludeSearch.trim() }) as ExpertListItem[];
        if (rid !== excludeReqIdRef.current) return;
        setExcludeResults(list);
      } catch {
        if (rid !== excludeReqIdRef.current) return;
        setExcludeResults([]);
      }
      setExcludeSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [excludeSearch, extractMode]);

  const toggleExcludeExpert = (e: ExpertListItem) => {
    if (excludedExpertIds.includes(e.id)) {
      setExcludedExpertIds(prev => prev.filter(id => id !== e.id));
      setExcludedExpertMap(prev => { const m = new Map(prev); m.delete(e.id); return m; });
    } else {
      setExcludedExpertIds(prev => [...prev, e.id]);
      setExcludedExpertMap(prev => new Map(prev).set(e.id, { name: e.displayName, specialty: e.expertProfile?.specialty ?? '' }));
    }
  };

  const sel = useMemo<BidProjectOption | undefined>(() => {
    const found = projects.find(p => p.id === pid);
    if (found) return found;
    // 影子项目（自定义抽取创建）被列表过滤掉，用按 id 加载的详情 pd 兜底
    if (pd && pd.id === pid) {
      return { id: pd.id, name: pd.name, projectCode: pd.projectCode, stage: pd.stage, procurementMethod: pd.procurementMethod, deadline: pd.deadline, _count: { suppliers: pd.suppliers?.length ?? 0 } };
    }
    return undefined;
  }, [projects, pid, pd]);
  // ── 预算驱动的委员会席位 ──
  const budgetNum = pd?.budget != null && String(pd.budget).trim() !== '' ? Number(pd.budget) : null;
  const isLargeBudget = budgetNum != null && !Number.isNaN(budgetNum) && budgetNum > 1_000_000;
  const totalSeats = isLargeBudget ? 7 : 5; // >100万 7 席；≤100万（含未填）5 席
  const demandRepSeats = needDemandRep ? demandRepCount : 0;
  const workerRepSeats = isLargeBudget ? 1 : 0; // >100万 固定 1 席职工代表
  const expertSeats = Math.max(0, totalSeats - demandRepSeats - workerRepSeats); // 专业专家可分配席位
  const quotaSum = quotas.reduce((s, q) => s + q.count, 0); // 所有专业行的人数和（含未选专业的占位行，与 addQ/adjustQuota 调配一致）
  const seatsBalanced = quotaSum === expertSeats && expertSeats > 0;
  // 把配额总和拉到 expertSeats（均匀分配：优先补 count<2 的专业，每专业≤2；多余再溢出到 count≥2 的）；用于初始/选项目/切席位/AI 配额等场景
  const clampToExpertSeats = (list: SpecialtyQuota[]): SpecialtyQuota[] => {
    if (list.length === 0) return list;
    const sum = list.reduce((s, q) => s + q.count, 0);
    if (sum === expertSeats) return list;
    const next = [...list];
    const diff = expertSeats - sum;
    if (diff > 0) {
      let remain = diff;
      // 第一遍：优先补 count<2 的专业到 2
      for (let i = 0; i < next.length && remain > 0; i++) {
        if (next[i].count < 2) {
          const add = Math.min(remain, 2 - next[i].count);
          next[i] = { ...next[i], count: next[i].count + add };
          remain -= add;
        }
      }
      // 第二遍：如果还有余，均分给各专业（每轮一个，从不超2的优先）
      while (remain > 0) {
        let done = false;
        for (let i = 0; i < next.length && remain > 0; i++) {
          next[i] = { ...next[i], count: next[i].count + 1 };
          remain--;
          done = true;
        }
        if (!done) break; // 兜底：如果 next 长度异常
      }
    } else if (diff < 0) {
      let remain = -diff;
      // 从 count>2 的专业减，再不行从 count>1 的专业减
      while (remain > 0) {
        let mi = -1, mc = 0;
        for (let i = 0; i < next.length; i++) if (next[i].count > 2 && next[i].count > mc) { mi = i; mc = next[i].count; }
        if (mi < 0) {
          // 没有 >2 的，退而求其次找 >1 的
          for (let i = 0; i < next.length; i++) if (next[i].count > 1 && next[i].count > mc) { mi = i; mc = next[i].count; }
        }
        if (mi < 0) break;
        const take = Math.min(remain, next[mi].count - 1);
        next[mi] = { ...next[mi], count: next[mi].count - take };
        remain -= take;
      }
    }
    return next;
  };
  // 可分配席位变化时（初始/选项目/切需求方代表/切人数），自动把配额总和拉到 expertSeats
  useEffect(() => {
    setQuotas(prev => clampToExpertSeats(prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expertSeats]);
  const demandRepOk = !needDemandRep || (demandRepMode === 'designated' ? demandRepPersons.length === demandRepCount : demandRepMode === 'department' ? !!demandRepDept : false);
  // 手动选取模式 UI 已移除；其余模式须配平专业配额
  const canExtract = !!pid && extractMode !== 'manual' && seatsBalanced && demandRepOk;

  // 专业配额增删改：始终在专业间调配席位，总和恒 = expertSeats（"一定要分配满"）
  const addQ = () => setQuotas(p => {
    const sum = p.reduce((s, q) => s + q.count, 0);
    const next = [...p, { specialty: '', count: 1 } as SpecialtyQuota];
    // 总和已满 → 从 count 最大的现有专业借 1 席给新专业；未满 → 直接占 1 席（向 expertSeats 靠拢）
    if (sum >= expertSeats) {
      let donor = 0; for (let i = 1; i < p.length; i++) if (p[i].count > p[donor].count) donor = i;
      if (next[donor].count > 1) next[donor] = { ...next[donor], count: next[donor].count - 1 };
    }
    return next;
  });
  const rmQ = (i: number) => setQuotas(p => {
    if (p.length <= 1) return p;
    const removedCount = p[i].count;
    const next = p.filter((_, x) => x !== i);
    // 删掉的专业席位转给剩余专业中 count 最小者，保持总和不变
    let target = 0; for (let j = 1; j < next.length; j++) if (next[j].count < next[target].count) target = j;
    next[target] = { ...next[target], count: next[target].count + removedCount };
    return next;
  });
  const upQ = (i: number, f: keyof SpecialtyQuota, v: string | number) => setQuotas(p => p.map((q, x) => x === i ? { ...q, [f]: v } : q));
  // 加/减某专业人数：未满 expertSeats 时向其靠拢；已满则在专业间调配（加=从最大专业借，减=补到最小专业）
  const adjustQuota = (idx: number, delta: 1 | -1) => setQuotas(p => {
    const sum = p.reduce((s, q) => s + q.count, 0);
    const next = [...p];
    if (delta === 1) {
      if (sum < expertSeats) {
        next[idx] = { ...next[idx], count: next[idx].count + 1 };
      } else {
        let donor = -1, maxC = 0;
        for (let i = 0; i < next.length; i++) if (i !== idx && next[i].count > maxC) { donor = i; maxC = next[i].count; }
        if (donor < 0 || next[donor].count <= 1) return p;
        next[idx] = { ...next[idx], count: next[idx].count + 1 };
        next[donor] = { ...next[donor], count: next[donor].count - 1 };
      }
    } else {
      if (next[idx].count <= 1) return p;
      let donee = -1, minC = Infinity;
      for (let i = 0; i < next.length; i++) if (i !== idx && next[i].count < minC) { donee = i; minC = next[i].count; }
      if (donee < 0) return p; // 只有一个专业，无处转移
      next[idx] = { ...next[idx], count: next[idx].count - 1 };
      next[donee] = { ...next[donee], count: next[donee].count + 1 };
    }
    return next;
  });

  // AI 配额：手动触发，读取项目需求/立项/采购文件等生成专业配额（仅保留库内真实存在的专业）
  const aiQuota = async () => {
    if (!pid) { toast.warning('请先选择采购项目'); return; }
    setQuotaAnalyzing(true); setError('');
    toast.loading('正在根据项目信息生成专业配额…', { id: 'ai-quota' });
    try {
      const res = await analyzeProjectSpecialties(pid);
      if (!res.requiredSpecialties?.length) { toast.warning('未能生成专业配额，请手动配置', { id: 'ai-quota' }); return; }
      // 与专家库已有专业对齐：仅保留能匹配库内专业的项（命中词缀包含关系），库内无对应专业的丢弃
      const matchSpec = (sp: string): string => {
        const t = sp.trim();
        if (!t) return '';
        if (specs.includes(t)) return t;
        return specs.find(x => x.includes(t) || t.includes(x)) || '';
      };
      const merged = new Map<string, number>();
      for (const s of res.requiredSpecialties) {
        const key = matchSpec(s.specialty);
        if (!key) continue;
        merged.set(key, (merged.get(key) ?? 0) + Math.max(1, s.count));
      }
      const newQuotas = Array.from(merged.entries()).map(([specialty, count]) => ({ specialty, count }));
      if (newQuotas.length > 0) {
        setQuotas(clampToExpertSeats(newQuotas));
        toast.success(`已根据项目信息生成 ${newQuotas.length} 个专业配额，请核对后开始抽取`, { id: 'ai-quota' });
      } else {
        toast.warning('库内无匹配专业，请手动配置', { id: 'ai-quota' });
      }
    } catch (e: any) {
      toast.error(e?.message || 'AI 配额推断失败，请手动配置', { id: 'ai-quota' });
    } finally {
      setQuotaAnalyzing(false);
    }
  };

  // 切换需求方代表：同步把专业配额总和自动调整到新的可分配席位数（避免「可分配 4 席、已配 5 席」的矛盾态）
  const toggleDemandRep = (next: boolean) => {
    if (next === needDemandRep) return;
    setNeedDemandRep(next);
    if (!next) { setDemandRepMode(null); setDemandRepPersons([]); setDemandRepCount(1); setDemandRepDept(''); setDemandRepDeptSpecialty(''); setDemandRepSearch(''); }
    const newFixed = (next ? demandRepCount : 0) + workerRepSeats;
    const newExpert = Math.max(0, totalSeats - newFixed);
    setQuotas(prev => {
      const filled = prev.filter(q => q.specialty.trim());
      const empties = prev.filter(q => !q.specialty.trim());
      const list = filled.length ? filled : [{ specialty: '', count: 1 } as SpecialtyQuota];
      let sum = list.reduce((s, q) => s + q.count, 0);
      let target = Math.max(newExpert, list.length); // 至少每专业 1 席
      if (target < sum) {
        let reduce = sum - target;
        for (let i = list.length - 1; i >= 0 && reduce > 0; i--) { const t = Math.min(list[i].count - 1, reduce); list[i] = { ...list[i], count: list[i].count - t }; reduce -= t; }
      } else if (target > sum) {
        let add = target - sum;
        for (let i = list.length - 1; i >= 0 && add > 0; i--) { list[i] = { ...list[i], count: list[i].count + 1 }; add--; }
      }
      return [...list, ...empties];
    });
  };
  // 切换需求方代表人数（仅 >100万 可选 1/2）：同步截断已选指定代表 + 重平衡专业配额
  const changeDemandRepCount = (n: 1 | 2) => {
    if (n === demandRepCount) return;
    setDemandRepCount(n);
    setDemandRepPersons(prev => prev.slice(0, n));
    const newFixed = n + workerRepSeats;
    const newExpert = Math.max(0, totalSeats - newFixed);
    setQuotas(prev => {
      const filled = prev.filter(q => q.specialty.trim());
      const empties = prev.filter(q => !q.specialty.trim());
      const list = filled.length ? filled : [{ specialty: '', count: 1 } as SpecialtyQuota];
      let sum = list.reduce((s, q) => s + q.count, 0);
      const target = Math.max(newExpert, list.length);
      if (target < sum) {
        let reduce = sum - target;
        for (let i = list.length - 1; i >= 0 && reduce > 0; i--) { const t = Math.min(list[i].count - 1, reduce); list[i] = { ...list[i], count: list[i].count - t }; reduce -= t; }
      } else if (target > sum) {
        let add = target - sum;
        for (let i = list.length - 1; i >= 0 && add > 0; i--) { list[i] = { ...list[i], count: list[i].count + 1 }; add--; }
      }
      return [...list, ...empties];
    });
  };
  const qt = quotas.reduce((s, q) => s + (q.specialty ? q.count : 0), 0);
  const qp = extractMode === 'specialty_match' ? quotas.filter(q => q.specialty.trim()).map(q => ({ specialty: q.specialty, count: q.count })) : undefined;
  const et = extractMode === 'specialty_match' ? Math.max(qt, 1) : tn;

  // 候选池去重：补选弹窗打开时基于 reDraft，否则基于初始抽取
  const availablePool = useMemo(() => {
    const src = reDraft?.preview ?? preview;
    if (!src?.candidatePool) return [];
    const usedList = reDraft ? reDraft.selected : [...selectedExperts, ...alternativeExperts];
    const used = new Set(usedList.map(e => e.userId));
    return src.candidatePool.filter(c => !used.has(c.userId));
  }, [preview, reDraft, selectedExperts, alternativeExperts]);

  const filteredPool = useMemo(() =>
    availablePool.filter(c =>
      !replaceSearch.trim() ||
      c.name.includes(replaceSearch.trim()) ||
      c.specialty.includes(replaceSearch.trim())
    ),
  [availablePool, replaceSearch]);

  // ── 自定义项目：上传文件 / AI 分析 / 创建影子项目并进入抽取 ──
  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    let okCount = 0;
    for (const f of Array.from(files)) {
      try {
        const res = await uploadExtractionFile(f);
        setCustomFiles(prev => [...prev, { id: res.id, name: res.originalName, size: res.size }]);
        okCount++;
      } catch (e: any) {
        toast.error(`「${f.name}」上传失败：${e?.message || '未知错误'}`);
      }
    }
    if (okCount > 0) toast.success(`已上传 ${okCount} 个文件`);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAnalyze = async () => {
    if (customFiles.length === 0) { setError('请先上传项目文件'); return; }
    setError(''); setAnalyzing(true); setAnalysis(null);
    try {
      const res = await analyzeExtractionFiles(customFiles.map(f => f.id));
      setAnalysis(res);
      setCustomName(res.suggestedName || '');
      setCustomMethod(res.procurementType || '公开招标');
      toast.success(res.engine === 'ai' ? 'AI 分析完成，请核对推断结果' : '已给出默认推断（AI 暂不可用），请手动调整');
    } catch (e: any) {
      setError(e?.message || 'AI 分析失败');
      toast.error(e?.message || 'AI 分析失败');
    }
    setAnalyzing(false);
  };

  const handleCreateCustomAndProceed = async () => {
    if (!analysis) { setError('请先点击「AI 分析文件」'); return; }
    if (!customName.trim()) { setError('请填写项目名称'); return; }
    setCreatingProject(true); setError('');
    try {
      const res = await createCustomProject({
        name: customName.trim(),
        procurementMethod: customMethod.trim() || '公开招标',
        background: analysis.projectBackground || analysis.analysis || '',
      });
      // 预填抽取配置：专业配额 + 总人数 + 专业匹配模式
      // 生成专业先向库内专业对齐（精确→包含匹配），库内无匹配则丢弃
      const matchSpec = (sp: string): string => {
        const t = sp.trim();
        if (!t) return '';
        if (specs.includes(t)) return t;
        return specs.find(x => x.includes(t) || t.includes(x)) || '';
      };
      const merged = new Map<string, number>();
      for (const s of analysis.requiredSpecialties) {
        const key = matchSpec(s.specialty);
        if (!key) continue;
        merged.set(key, (merged.get(key) ?? 0) + Math.max(1, s.count));
      }
      const q = Array.from(merged.entries()).map(([specialty, count]) => ({ specialty, count }));
      setQuotas(clampToExpertSeats(q.length ? q : [{ specialty: '', count: expertSeats }]));
      setTn(Math.max(analysis.totalExperts || 3, 1));
      setExtractMode('random');
      setPid(res.projectId); // 触发 [pid] effect 加载影子项目详情（留在步骤1，展开配置区）
      toast.success('已根据文件分析预填专业配额，可在下方配置后开始抽取');
    } catch (e: any) {
      setError(e?.message || '创建项目失败');
      toast.error(e?.message || '创建项目失败');
    }
    setCreatingProject(false);
  };

  const run = async () => {
    if (!pid) { setError('请选择采购项目'); return; }
    if (extractMode !== 'manual' && !quotas.some(q => q.specialty.trim())) { setError('请至少选择一个专业'); return; }
    if (extractMode !== 'manual' && !seatsBalanced) { setError(`专业配额合计须等于可分配席位 ${expertSeats} 席（当前 ${quotaSum} 席）`); return; }
    if (needDemandRep) {
      if (demandRepMode === 'designated' && demandRepPersons.length !== demandRepCount) { setError(`请指定 ${demandRepCount} 名需求方代表（已选 ${demandRepPersons.length} 名）`); return; }
      if (demandRepMode === 'department' && !demandRepDept) { setError('请选择需求方代表部门'); return; }
    }
    setError(''); setLoading(true); setPreview(null); setDone(false); setLeadExpertId(null); setStep3Confirmed(false); setConfirmedExpertIds([]); setNotifyExpertList([]); setNotifyResults(null); notifySentRef.current = false; originalConfirmedIdsRef.current = new Set(); lastReQuotasRef.current = []; setReHistory([]); setAltPreview(null); setAltSelected([]); setAltNotified(false); updateMessages(new Map());
    toast.loading('AI 正在分析项目需求并抽取专家组...', { id: 'extract-loading' });

    // 组装抽取配额：常规席位（职工代表>100万 + 各专业配额）；部门需求方代表走 employer 限定配额
    const manualQuotas: { specialty: string; count: number; employer?: string }[] = [];
    if (isLargeBudget) manualQuotas.push({ specialty: '职工代表', count: 1 });
    for (const qq of quotas.filter(q => q.specialty.trim())) manualQuotas.push({ specialty: qq.specialty, count: qq.count });
    const regularQuotaCount = manualQuotas.length; // 候补 = 每个专业 1 位
    const allQuotas = (needDemandRep && demandRepMode === 'department')
      ? [...manualQuotas, { specialty: demandRepDeptSpecialty || '', count: demandRepCount, employer: demandRepDept }]
      : manualQuotas;
    const totalNeeded = allQuotas.reduce((s, q) => s + q.count, 0);

    try {
      const result = await previewExtraction({ projectId: pid, totalNeeded, alternatives: 0, extractMode, manualQuotas: allQuotas });
      if (!result?.selected) throw new Error('服务器返回数据异常');
      setPreview(result);
      setSelectedExperts([...result.selected]);
      setAlternativeExperts([...result.alternatives]);
      setStep(2); // 重新抽取 → 审核调整（初始专家组）
      toast.dismiss('extract-loading');
    } catch (e: any) {
      toast.dismiss('extract-loading');
      setError(e?.message || '抽取失败');
    } finally {
      setLoading(false);
    }
  };

  // 指定的需求方代表（作为正选成员，不参与 AI 抽取；支持 1-2 人）
  const demandRepItems: ExtractionSelected[] = (needDemandRep && demandRepMode === 'designated')
    ? demandRepPersons.map(p => ({ userId: p.userId, name: p.name, specialty: p.specialty || '需求方代表', matchScore: 100, reason: '指定需求方代表', role: '正选' as const }))
    : [];

  // 步骤4正选专家列表（含指定需求方代表）
  // 补选前用原始正选，补选后用补选专家；步骤1-4始终用原始数据
  const step4Experts = useMemo(() => {
    return [...selectedExperts, ...demandRepItems];
  }, [selectedExperts, demandRepItems]);

  // 步骤2 展示用：按步骤1「内容二」专业配额顺序排序的正选/候补视图（仅展示，不改原数组）
  const quotaOrderMap = useMemo(() => {
    const m = new Map<string, number>();
    // 按库内人数降序（与步骤1 配额行展示顺序一致），不在库内的专业排最后
    [...specs].sort((a, b) => (pool.get(b) ?? 0) - (pool.get(a) ?? 0)).forEach((s, i) => m.set(s, i));
    return m;
  }, [specs, pool]);
  const sortByQuota = (list: ExtractionSelected[]) =>
    [...list].sort((a, b) => {
      const oa = quotaOrderMap.has(a.specialty) ? quotaOrderMap.get(a.specialty)! : 9999;
      const ob = quotaOrderMap.has(b.specialty) ? quotaOrderMap.get(b.specialty)! : 9999;
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name, 'zh-CN'); // 同专业按姓名
    });
  const sortedSelectedExperts = useMemo(() => sortByQuota(selectedExperts), [selectedExperts, quotaOrderMap]);

  // userId → 第几次补选（1-based），用于步骤5 专家组确认中的来源标注
  const reHistoryRoundMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of reHistory) { for (const uid of h.expertIds) m.set(uid, h.roundNo); }
    return m;
  }, [reHistory]);

  const confirm = async () => {
    if (!pid || selectedExperts.length === 0) return;
    setConfirming(true);
    try {
      const exps = [...selectedExperts, ...demandRepItems].map(s => ({ userId: s.userId, expertName: s.name, major: s.specialty, isLead: false }));
      const result = await confirmExtraction({ projectId: pid, experts: exps });
      const ids = result.expertIds || exps.map(e => e.userId);
      setConfirmedExpertIds(ids);
      originalConfirmedIdsRef.current = new Set(ids);

      if (pd?.openTime) {
        const d = new Date(pd.openTime);
        setOpenTimeDate(d.toISOString().slice(0, 10));
        setOpenTimeTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
      }

      setNotifyActiveExpert(exps[0]?.userId || '');
      const notifyList: ExtractionSelected[] = [...selectedExperts, ...demandRepItems];
      setNotifyExpertList(notifyList);
      setStep3Confirmed(true);
      toast.success(`专家组已确认（${exps.length} 人），可进入下一步发送通知`);
    } catch (e: any) { toast.error(e?.message || '确认失败'); }
    setConfirming(false);
  };

  const [rsvpLinks, setRsvpLinks] = useState<Record<string, string>>({});

  /** 打开补选弹窗：AI 分析项目 → 推荐补选专业与人数 → 用户调整 → 开始抽取。
   *  如果上次用户已手动调整过配额且池仍有可用专家，则跳过 configuring，直接用旧配额抽取。 */
  const openReModal = async () => {
    if (!invitationData || !pid) return;
    const allMain = invitationData.experts.filter(e => e.expertRole === '正选');
    const confirmedCount = allMain.filter(e => e.invitationStatus === 'confirmed').length;
    const shortfall = totalSeats - confirmedCount;
    if (shortfall <= 0) { toast.warning('专家组已满员'); return; }
    if (!allMain.some(e => e.invitationStatus === 'declined')) {
      toast.warning('没有需要补选的专家（若有待回复成员可等其回复后再补）'); return;
    }
    const roundNo = reHistory.length + 1;
    // 如果用户上次手动调整过配额，且该配额池仍有专家 → 直接抽取
    if (lastReQuotasRef.current.length > 0) {
      const shortages: string[] = [];
      for (const q of lastReQuotasRef.current) {
        const pc = pool.get(q.specialty) ?? 0;
        const invited = invitationData.experts.filter(e => e.major === q.specialty).length;
        if (pc - invited < q.count) shortages.push(`${q.specialty}（池${pc}人/已邀${invited}人/需${q.count}人）`);
      }
      if (shortages.length === 0) {
        const totalNeeded = lastReQuotasRef.current.reduce((s, q) => s + q.count, 0);
        const excludedIds = Array.from(new Set(invitationData.experts.map(e => e.userId)));
        setReDraft({ phase: 'extracting', preview: null, selected: [], alternatives: [], quotas: lastReQuotasRef.current.map(q => ({ ...q })), confirmed: false, notified: false, expertIds: [], roundNo });
        try {
          const result = await previewExtraction({ projectId: pid, totalNeeded, alternatives: Math.min(lastReQuotasRef.current.length, 9), extractMode, manualQuotas: lastReQuotasRef.current, excludedUserIds: excludedIds.length > 0 ? excludedIds : undefined });
          if (!result?.selected) throw new Error('返回数据异常');
          updateDraft({ phase: 'review', preview: result, selected: [...result.selected], alternatives: [...result.alternatives] });
          if (result.suggestedLeaderId) setLeadExpertId(result.suggestedLeaderId);
        } catch (e: any) { toast.error(e?.message || '补选抽取失败'); setReDraft(null); }
        return;
      }
      // 池空了 → 清除旧配额，走 AI 推荐重新配置
      lastReQuotasRef.current = [];
      toast.warning('上次补选的专业配额已用完，请重新配置');
    }
    setReDraft({ phase: 'extracting', preview: null, selected: [], alternatives: [], quotas: [], confirmed: false, notified: false, expertIds: [], roundNo });
    try {
      // AI 分析项目 → 推荐补选专业配额
      const aiRes = await analyzeProjectSpecialties(pid);
      if (aiRes?.requiredSpecialties?.length) {
        const matchSpec = (sp: string): string => { const t = sp.trim(); if (!t) return ''; if (specs.includes(t)) return t; return specs.find(x => x.includes(t) || t.includes(x)) || ''; };
        const merged = new Map<string, number>();
        for (const s of aiRes.requiredSpecialties) { const key = matchSpec(s.specialty); if (key) merged.set(key, (merged.get(key) ?? 0) + Math.max(1, s.count)); }
        let remaining = shortfall;
        const quotas: SpecialtyQuota[] = [];
        for (const [spec, count] of Array.from(merged.entries()).sort((a, b) => b[1] - a[1])) {
          if (remaining <= 0) break;
          const take = Math.min(count, remaining);
          quotas.push({ specialty: spec, count: take });
          remaining -= take;
        }
        const declinedSpecs = new Set(allMain.filter(e => e.invitationStatus === 'declined').map(e => e.major || '综合'));
        for (const spec of declinedSpecs) { if (!quotas.some(q => q.specialty === spec) && remaining > 0) { quotas.push({ specialty: spec, count: 1 }); remaining--; } }
        if (quotas.length > 0) {
          updateDraft({ phase: 'configuring', quotas });
          return;
        }
      }
      updateDraft({ phase: 'configuring', quotas: [{ specialty: '', count: 0 }] });
    } catch (e: any) {
      toast.error(e?.message || 'AI 分析失败');
      setReDraft(null);
    }
  };

  /** 弹窗配置阶段 → 开始抽取：用户调整配额后触发 previewExtraction */
  const extractReDraft = async () => {
    if (!reDraft || !pid || !invitationData) return;
    const quotas = reDraft.quotas.filter(q => q.specialty.trim() && q.count > 0);
    if (quotas.length === 0) { toast.warning('请至少配置一个专业'); return; }
    // 检查池
    const shortages: string[] = [];
    for (const q of quotas) {
      const pc = pool.get(q.specialty) ?? 0;
      const invited = invitationData.experts.filter(e => e.major === q.specialty).length;
      if (pc - invited < q.count) shortages.push(`${q.specialty}（池内${pc}人，已邀请${invited}人，需补${q.count}人）`);
    }
    if (shortages.length > 0) { setReShortfallSpecs(quotas.map(q => q.specialty)); toast.warning(shortages.join('；')); return; }
    setReShortfallSpecs([]);
    const totalNeeded = quotas.reduce((s, q) => s + q.count, 0);
    const excludedIds = Array.from(new Set(invitationData.experts.map(e => e.userId)));
    const manualQuotas: { specialty: string; count: number }[] = quotas.map(q => ({ specialty: q.specialty, count: q.count }));
    updateDraft({ phase: 'extracting' });
    try {
      const result = await previewExtraction({ projectId: pid, totalNeeded, alternatives: Math.min(manualQuotas.length, 9), extractMode, manualQuotas, excludedUserIds: excludedIds.length > 0 ? excludedIds : undefined });
      if (!result?.selected) throw new Error('返回数据异常');
      updateDraft({ phase: 'review', preview: result, selected: [...result.selected], alternatives: [...result.alternatives] });
      if (result.suggestedLeaderId) setLeadExpertId(result.suggestedLeaderId);
      // 记住本次用户确认的配额（下次补选直接用，不再询问）
      lastReQuotasRef.current = quotas.filter(q => q.specialty.trim() && q.count > 0).map(q => ({ specialty: q.specialty, count: q.count }));
    } catch (e: any) {
      toast.error(e?.message || '补选抽取失败');
      updateDraft({ phase: 'configuring' });
    }
  };

  /** 弹窗内：确认补选专家 → append 入库 + 立即写入历史（避免关闭弹窗后专家"消失") */
  const confirmReDraft = async () => {
    if (!reDraft || !pid || reDraft.selected.length === 0) return;
    setConfirming(true); setError('');
    try {
      const exps = reDraft.selected.map(s => ({ userId: s.userId, expertName: s.name, major: s.specialty, isLead: false }));
      const result = await confirmExtraction({ projectId: pid, experts: exps, append: true });
      const ids = result.expertIds || exps.map(e => e.userId);
      updateDraft({ confirmed: true, expertIds: ids });
      // 入库即入历史（roundNo 已存在则更新，避免重开时重复 push）
      const item: ReHistoryItem = {
        roundNo: reDraft.roundNo,
        preview: reDraft.preview,
        selected: [...reDraft.selected],
        alternatives: [...reDraft.alternatives],
        expertIds: ids,
        confirmed: true,
        notified: false,
      };
      setReHistory(prev => prev.some(h => h.roundNo === item.roundNo)
        ? prev.map(h => h.roundNo === item.roundNo ? { ...h, ...item } : h)
        : [...prev, item]);
      // 入库后立即预拉 RSVP 链接（await 等就绪，供通知预览和发送使用，避免预览时链接未生成）
      const linksRes = await prersvpLinks(pid).catch(() => ({ links: {} as Record<string, string> }));
      if (linksRes.links) setRsvpLinks(prev => ({ ...prev, ...linksRes.links }));
      toast.success(`第${reDraft.roundNo}次补选专家组已确认（${exps.length} 人），可一键通知`);
    } catch (e: any) { toast.error(e?.message || '确认失败'); }
    setConfirming(false);
  };

  /** 弹窗内：一键通知（派生步骤3模板） */
  const sendReDraftNotify = async () => {
    if (!reDraft || !pid) return;
    if (!openTimeDate || !openTimeTime) { toast.warning('请先填写开标日期与时间'); return; }
    const tplExpert = step4Experts[0];
    const tplMsg = tplExpert ? (notifyMessages.get(tplExpert.userId) || '') : '';
    if (!tplMsg) { toast.warning('步骤3「确认通知」尚未生成通知内容，请先返回步骤3生成模板'); return; }
    updateDraft({ phase: 'sending' });
    setNotifying(true);
    try {
      const rsvpData = await prersvpLinks(pid).catch(() => ({ links: {} as Record<string, string> }));
      const links = rsvpData.links || {};
      setRsvpLinks(links);
      const tplLink = tplExpert ? (links[tplExpert.userId] || rsvpLinks[tplExpert.userId] || '') : '';
      const tplName = tplExpert?.name || '';
      const nameRe = tplName ? new RegExp(tplName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : null;
      const tplLinkRe = tplLink ? new RegExp(tplLink.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : null;
      const tasks = reDraft.selected.map(e => {
        let content = tplMsg;
        if (nameRe) content = content.replace(nameRe, e.name);
        const eLink = links[e.userId];
        if (eLink) {
          if (tplLinkRe) content = content.replace(tplLinkRe, eLink);
          content = content.replace(/\{RSVP_LINK\}/g, eLink);
        }
        const channels = notifyChannelsByExpert.get(e.userId) || ['in_app', 'sms', 'phone'];
        if (!content || channels.length === 0) return null;
        return { eid: e.userId, msg: content, channels };
      }).filter((x): x is { eid: string; msg: string; channels: string[] } => x !== null);
      if (tasks.length === 0) { toast.warning('无可用通知文案'); return; }
      const reMsg = new Map(notifyMessages);
      for (const t of tasks) reMsg.set(t.eid, t.msg);
      updateMessages(reMsg);
      await Promise.allSettled(tasks.map(t => sendExtractionNotify({ projectId: pid, expertIds: [t.eid], channels: t.channels, message: t.msg })));
      updateDraft({ notified: true, phase: 'done' });
      setReHistory(prev => prev.map(h => h.roundNo === reDraft.roundNo ? { ...h, notified: true } : h));
      toast.success(`已一键通知 ${tasks.length} 名补选专家`);
    } catch (e: any) {
      toast.error(e?.message || '一键通知失败');
      updateDraft({ phase: 'review' });
    } finally {
      setNotifying(false);
    }
  };

  /** 弹窗内：完成/关闭 → 同步排除集合（去重）+ 关闭弹窗。历史已在 confirmReDraft 入库时写入，不会丢 */
  const closeReModal = () => {
    // 把当前 declined 专家加入排除集合（去重），避免下一轮重复抽到
    const declinedIds = (invitationData?.experts ?? []).filter(e => e.invitationStatus === 'declined').map(e => e.userId);
    if (declinedIds.length > 0) {
      setExcludedExpertIds(prev => Array.from(new Set([...prev, ...declinedIds])));
      const exclMap = new Map(excludedExpertMap);
      for (const e of (invitationData?.experts ?? [])) if (e.invitationStatus === 'declined') exclMap.set(e.userId, { name: e.expertName, specialty: e.major });
      setExcludedExpertMap(exclMap);
    }
    setReDraft(null);
    setReShortfallSpecs([]);
  };

  /** 重开历史中某轮的弹窗（继续通知/查看）：仅未通知轮次需要继续 */
  const reopenReModal = (roundNo: number) => {
    const h = reHistory.find(x => x.roundNo === roundNo);
    if (!h) return;
    setReDraft({
      phase: 'review',
      preview: h.preview,
      selected: [...h.selected],
      alternatives: [...h.alternatives],
      confirmed: true,
      notified: h.notified,
      expertIds: [...h.expertIds],
      roundNo,
    });
  };

  /** 步骤6：按步骤1专业配额抽候补（每专业1人），池空自动换专业，排除所有已邀请专家 */
  const extractAlternates = async () => {
    if (!pid || !invitationData) return;
    const allInvited = new Set(invitationData.experts.map(e => e.userId));
    const quotaSpecs = quotas.filter(q => q.specialty.trim()).map(q => q.specialty);
    if (quotaSpecs.length === 0) { toast.warning('无专业配额，无法抽取候补'); return; }
    const mainExperts = invitationData.experts.filter(e => e.expertRole === '正选');
    setAltExtracting(true);
    try {
      const manualQuotas: { specialty: string; count: number }[] = [];
      const usedSpecs = new Set<string>();
      for (const spec of quotaSpecs) {
        let target = spec;
        const pc = pool.get(target) ?? 0;
        const invited = mainExperts.filter(e => e.major === target).length;
        if (pc - invited < 1) {
          // 一级 fallback：配额表内其他专业
          for (const s of quotaSpecs) {
            if (!usedSpecs.has(s) && s !== target) { const sp = pool.get(s) ?? 0; const si = mainExperts.filter(e => e.major === s).length; if (sp - si > 0) { target = s; break; } }
          }
          // 二级 fallback：全库按人数降序（排除职工代表/需求方代表等非专业角色）
          if (target === spec) {
            for (const s of [...specs].sort((a, b) => (pool.get(b) ?? 0) - (pool.get(a) ?? 0))) {
              if (!usedSpecs.has(s) && !['职工代表', '需求方代表'].includes(s)) { const sp = pool.get(s) ?? 0; const si = mainExperts.filter(e => e.major === s).length; if (sp - si > 0) { target = s; break; } }
            }
          }
          // 两级都找不到 → 跳过（避免 previewExtraction 部分失败导致人数不对）
          if (target === spec) continue;
        }
        usedSpecs.add(target);
        manualQuotas.push({ specialty: target, count: 1 });
      }
      const totalNeeded = manualQuotas.length;
      const excludedIds = [...allInvited];
      const result = await previewExtraction({ projectId: pid, totalNeeded, extractMode, manualQuotas, excludedUserIds: excludedIds.length > 0 ? excludedIds : undefined });
      if (!result?.selected) throw new Error('返回数据异常');
      setAltPreview(result);
      setAltSelected([...result.selected]);
      if (result.suggestedLeaderId) setLeadExpertId(result.suggestedLeaderId);
      // 候补通知：专属文案（不含 RSVP 链接，不要求确认，仅告知准备参加）
      const projectName = sel?.name || pd?.name || '采购项目';
      const altMsg = new Map(notifyMessages);
      for (const e of result.selected) {
        altMsg.set(e.userId, `${e.name}专家您好！\n您被选为「${projectName}」的候补评审专家，若参与评审专家因故无法参加，将按序递补您参加评标。请您提前做好准备并保持通讯畅通。感谢您的支持与配合。\n\n四川水发集团\n${new Date().toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric' })}`);
      }
      updateMessages(altMsg);
      toast.success(`候补专家抽取完成，共 ${result.selected.length} 人`);
    } catch (e: any) { toast.error(e?.message || '抽取失败'); }
    setAltExtracting(false);
  };

  const goToNotify = async () => {
    setStep(3);
    if (step4Experts.length > 0 && !notifyActiveExpert) {
      setNotifyActiveExpert(step4Experts[0].userId);
    }
    if (pid) {
      try {
        const data = await prersvpLinks(pid);
        setRsvpLinks(data.links || {});
      } catch {}
    }
  };

  // O4：仅确认专家组入库、暂不发通知——支持"先组队、延后通知"。
  // 落库后直接进完成态（step4 done），可从完成页"发送通知"按钮重新打开通知弹窗补发。
  const confirmOnly = async () => {
    if (!pid || selectedExperts.length === 0) return;
    setConfirming(true); setError('');
    try {
      const exps = [...selectedExperts, ...demandRepItems].map(s => ({ userId: s.userId, expertName: s.name, major: s.specialty, isLead: false }));
      const result = await confirmExtraction({ projectId: pid, experts: exps });
      const ids = result.expertIds || exps.map(e => e.userId);
      setConfirmedExpertIds(ids);
      originalConfirmedIdsRef.current = new Set(ids);
      const notifyList: ExtractionSelected[] = [...selectedExperts, ...demandRepItems];
      setNotifyExpertList(notifyList);
      setDone(true);
      setStep(3);
      toast.success(`专家组已确认（${exps.length} 人），未发通知，可稍后补发`);
    } catch (e: any) { toast.error(e?.message || '确认失败'); }
    setConfirming(false);
  };

  const sendNotify = async () => {
    if (confirmedExpertIds.length === 0) return;
    // 开标时间必填校验：留空会导致文案中的时间占位无法替换
    if (!openTimeDate || !openTimeTime) {
      toast.warning('请先填写开标日期与时间（必填）后再发送通知');
      return;
    }
    setNotifying(true);
    try {
      // 构造待发送任务（有文案 + 有渠道），跳过无文案/无渠道的专家
      const tasks = confirmedExpertIds
        .map(eid => {
          const msg = notifyMessages.get(eid) || '';
          const channels = notifyChannelsByExpert.get(eid) || ['in_app', 'sms', 'phone'];
          if (!msg || channels.length === 0) return null;
          return { eid, msg, channels };
        })
        .filter((x): x is { eid: string; msg: string; channels: string[] } => x !== null);

      // 全员无文案时实际 0 条发送：不置完成态、不进步骤5，提示用户先生成文案
      if (tasks.length === 0) {
        toast.warning('未发送任何通知：无可用通知文案，请先生成文案');
        return;
      }

      // 并行发送，逐条独立成败（部分失败不阻断其余），便于汇总与重试
      const settled = await Promise.allSettled(
        tasks.map(t => sendExtractionNotify({ projectId: pid, expertIds: [t.eid], channels: t.channels, message: t.msg })),
      );
      const allResults: any[] = [];
      let okCount = 0;
      let failCount = 0;
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          okCount++;
          if (r.value.results) allResults.push(...r.value.results);
        } else {
          failCount++;
          allResults.push({ userId: tasks[i].eid, results: { error: (r.reason as any)?.message || '发送失败' } });
        }
      });

      setNotifyResults(allResults);
      setDone(true);
      notifySentRef.current = true;
      setStep(4);
      if (failCount === 0) {
        toast.success(`通知已发送（${okCount} 名专家）`);
      } else {
        toast.warning(`通知部分成功：成功 ${okCount} 名，失败 ${failCount} 名（可稍后重试失败项）`);
      }
    } catch (e: any) { toast.error(e?.message || '通知发送失败'); }
    finally { setNotifying(false); }
  };

  const toggleChannelForExpert = (expertId: string, ch: string) => {
    setNotifyChannelsByExpert(prev => {
      const current = prev.get(expertId) || ['in_app', 'sms', 'phone'];
      const updated = current.includes(ch) ? current.filter(c => c !== ch) : [...current, ch];
      return new Map(prev).set(expertId, updated);
    });
  };
  const getChannelsForExpert = (expertId: string) => notifyChannelsByExpert.get(expertId) || ['in_app', 'sms', 'phone'];

  // 抽取历史
  const openHistory = async (page = 1) => {
    setShowHistory(true); setHistoryLoading(true); setHistoryPage(page);
    try {
      const data = await getExtractionHistory({ page, pageSize: 15 });
      setHistoryData(data);
    } catch { setHistoryData(null); }
    setHistoryLoading(false);
  };

  // 抽取质量复盘（AI 总结，失败降级）
  const openRetrospect = async (projectId: string) => {
    setRetrospect({ loading: true, data: null });
    try {
      const data = await retrospectExtraction(projectId);
      setRetrospect({ loading: false, data });
    } catch (e: any) {
      toast.error(e?.message || '复盘生成失败');
      setRetrospect(null);
    }
  };

  // 手动调整（按 userId 定位，避免排序后 index 错位）
  const removeExpert = (userId: string, role: 'selected' | 'alternative') => {
    if (role === 'selected') setSelectedExperts(prev => prev.filter(e => e.userId !== userId));
    else setAlternativeExperts(prev => prev.filter(e => e.userId !== userId));
  };
  const openReplace = (userId: string, role: 'selected' | 'alternative') => {
    setReplaceTarget({ userId, role });
    setReplaceSearch('');
    setShowReplaceModal(true);
  };
  const doReplace = (candidate: CandidatePoolItem) => {
    if (!replaceTarget) return;
    const newExpert: ExtractionSelected = {
      userId: candidate.userId, name: candidate.name, specialty: candidate.specialty,
      title: candidate.title || null, employer: candidate.employer || null,
      matchScore: candidate.matchScore, reason: candidate.reason, role: replaceTarget.role === 'selected' ? '正选' : '候补',
    };
    if (reDraft) {
      updateDraft({ selected: reDraft.selected.map(e => e.userId === replaceTarget.userId ? newExpert : e) });
    } else if (replaceTarget.role === 'selected') {
      setSelectedExperts(prev => prev.map(e => e.userId === replaceTarget.userId ? newExpert : e));
    } else {
      setAlternativeExperts(prev => prev.map(e => e.userId === replaceTarget.userId ? newExpert : e));
    }
    setShowReplaceModal(false);
    setReplaceTarget(null);
  };
  const addExpert = (candidate: CandidatePoolItem) => {
    const newExpert: ExtractionSelected = {
      userId: candidate.userId, name: candidate.name, specialty: candidate.specialty,
      title: candidate.title || null, employer: candidate.employer || null,
      matchScore: candidate.matchScore, reason: candidate.reason, role: '正选',
    };
    if (reDraft) {
      updateDraft({ selected: [...reDraft.selected, newExpert] });
    } else {
      setSelectedExperts(prev => [...prev, newExpert]);
    }
    setShowReplaceModal(false);
    setReplaceTarget(null);
  };
  const reset = () => { setStep(1); setDone(false); setPreview(null); setSelectedExperts([]); setAlternativeExperts([]); setNotifyResults(null); setConfirmedExpertIds([]); setStep3Confirmed(false); notifySentRef.current = false; originalConfirmedIdsRef.current = new Set(); lastReQuotasRef.current = []; setReHistory([]); setAltPreview(null); setAltSelected([]); setAltNotified(false); localStorage.removeItem(`${storageKey}-${pid}`); localStorage.removeItem(LAST_PID_KEY); };

  // ── 配置卡片 ──
  // ── 替换/添加弹窗 ──
  // 被替换的原专家信息
  const replacedExpert = useMemo(() => {
    if (!replaceTarget) return null;
    const list = reDraft ? reDraft.selected : (replaceTarget.role === 'selected' ? selectedExperts : alternativeExperts);
    return list.find(e => e.userId === replaceTarget.userId) || null;
  }, [replaceTarget, selectedExperts, alternativeExperts, reDraft]);

  const replaceModal = showReplaceModal && (
    <Modal
      open
      onClose={() => { setShowReplaceModal(false); setReplaceTarget(null); }}
      size="lg"
      title={replaceTarget ? '替换专家' : '添加专家'}
    >
      {/* 原专家对比 */}
      {replacedExpert && (
        <div className="rounded-xl bg-[color-mix(in_oklch,var(--surface)_80%,transparent)] p-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">
          <div className="text-[10px] font-semibold uppercase text-[var(--muted-foreground)] mb-2">当前专家</div>
          <div className="flex items-center gap-3 text-xs">
            <span className="font-bold text-[var(--foreground)]">{replacedExpert.name}</span>
            <span className="text-[var(--muted-foreground)]">{replacedExpert.specialty}</span>
            {replacedExpert.title && <span className="text-[var(--muted-foreground)]">· {replacedExpert.title}</span>}
          </div>
          <p className="text-[11px] text-[var(--muted-foreground)] mt-1">{replacedExpert.reason}</p>
        </div>
      )}
      <input value={replaceSearch} onChange={e => setReplaceSearch(e.target.value)} placeholder="搜索候选专家姓名/专业..." className="neu-input text-sm w-full" autoFocus />
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {filteredPool.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)] text-center py-8">暂无可用候选专家</p>
        ) : (
          filteredPool.map(c => { return (
              <div key={c.userId} className="flex items-center justify-between rounded-lg bg-[var(--surface)] px-3 py-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[var(--foreground)] truncate">{c.name}</span>
                    {c.evaluationLevel && <StatusBadge tone={c.evaluationLevel === 'A' ? 'green' : c.evaluationLevel === 'B' ? 'blue' : c.evaluationLevel === 'D' ? 'orange' : c.evaluationLevel === 'E' ? 'red' : 'gray'}>{c.evaluationLevel}</StatusBadge>}
                    {c.currentLoadStatus && <span className="text-[10px] text-[var(--muted-foreground)]">{c.currentLoadStatus}</span>}
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)] truncate">{c.specialty}{c.title ? ` · ${c.title}` : ''}</div>
                </div>
                <div className="flex items-center gap-2 ml-3">
                  <button onClick={() => replaceTarget ? doReplace(c) : addExpert(c)} className="neu-btn-xs">选择</button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );

  // ── 通知弹窗 ──
  return (
    <div className="flex flex-col gap-5 pb-8">
      {!hideHeader && (
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><UsersRound size={17} /></div>
            <div><div className="page-hero__title">专家智能抽取</div><div className="page-hero__sub">按专业配额抽取，随机或综合择优组建专家组</div></div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => openHistory()} className="neu-btn-soft gap-1.5">
              <Clock size={15} />抽取历史
            </button>
            <RulesPopover>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-3">专家抽取规则</h3>
              <ol className="space-y-2 text-xs text-[var(--muted-foreground)] leading-relaxed">
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">1.</span>合规过滤：仅「可用」状态专家，工作单位与供应商无关联，未被重复分配至同一项目，自动回避利益相关方</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">2.</span>席位规则：预算＞100万设 7 席（含固定 1 席职工代表），≤100万设 5 席；需求方代表可选（指定人员或按部门抽取）；其余席位按专业配额抽取，每专业候补 1 位</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">3.</span>多维评估：AI 综合专家履职评价等级(A/B/C/D)、出勤/质量/廉洁三维度评分、评分偏离度、历史经验与当前负荷</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">4.</span>手动调整：抽取后可替换/移除/添加专家，灵活组建最终专家组</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">5.</span>通知送达：确认后支持 OA站内信 / 短信 / 电话 多渠道通知被选专家</li>
              </ol>
            </RulesPopover>
          </div>
        </div>
      </div>
      )}

      {/* ══ 步骤轨道 ══ */}
      <StepTrack
        steps={[
          { num: 1, label: '抽取配置', desc: '委员会席位、需求方代表与专业配额' },
          { num: 2, label: '审核调整', desc: '查看 AI 推荐结果，手动调整专家组' },
          { num: 3, label: '确认通知', desc: '确定组长、发送通知给专家' },
          { num: 4, label: '专家确认与补选', desc: '查看专家回复，弹窗内补选并记录历史' },
          { num: 5, label: '专家组确认', desc: '完成组建，查看最终专家组成员' },
          { num: 6, label: '候补专家抽取与确认', desc: '按专业配额抽取候补，确认并通知候补专家' },
        ]}
        current={step}
        onStepClick={(s) => setStep(s)}
        reachable={(s) => {
          if (s <= step) return true;
          if (s === 2 && !!preview) return true;
          if (s === 3 && confirmedExpertIds.length > 0) return true;
          if (s === 4 && notifySentRef.current) return true;
          if (s === 5 && notifySentRef.current) return true;
          if (s === 6 && notifySentRef.current) return true;
          return false;
        }}
      />

      {error && <div className="rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">{error}</div>}

      {/* ── 步骤 1：抽取配置 ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="neu-table-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-extrabold text-white">1</span>
              <div><span className="text-sm font-bold text-[var(--foreground)]">抽取配置</span>{(pid || defaultProjectTitle) && <span className="ml-2 text-xs text-[var(--muted-foreground)]">委员会 {totalSeats} 席（{isLargeBudget ? '预算＞100万' : '预算≤100万'}）</span>}</div>
            </div>

            {/* 项目上下文：未选项目 → 来源选择；已选 → 项目摘要 */}
            {!pid && !defaultProjectTitle ? (
              <div className="space-y-4">
                {/* 来源切换 */}
                <div className="neu-tab-bar inline-flex p-1">
                  {(['existing', 'custom'] as const).map(src => (
                    <button key={src} type="button" onClick={() => { setProjectSource(src); setError(''); }}
                      className={`neu-tab px-4 py-1.5 text-xs font-bold ${projectSource === src ? 'is-active' : ''}`}>
                      {src === 'existing' ? '已有项目' : '自定义项目'}
                    </button>
                  ))}
                </div>

                {/* 已有项目 */}
                {projectSource === 'existing' && (
                  <div>
                    <label className="text-xs font-semibold text-[var(--muted-foreground)] block mb-1.5">采购项目 *</label>
                    {projects.length === 0 ? (
                      <div className="neu-input text-sm w-full flex items-center justify-center py-3 text-[var(--muted-foreground)]">暂无采购项目，请先在开评标管理端创建，或切换到「自定义项目」</div>
                    ) : (
                      <select value={pid} onChange={e => setPid(e.target.value)} className="neu-input text-sm max-w-[600px]"><option value="">请选择需要组建评审组的项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}（{p.projectCode}）</option>)}</select>
                    )}
                  </div>
                )}

                {/* 自定义项目：上传文件 + AI 分析 */}
                {projectSource === 'custom' && (
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-semibold text-[var(--muted-foreground)] block mb-1.5">上传项目相关文件 *（招标公告/采购需求/项目背景等，支持 PDF/Word/图片，可多选）</label>
                      <input ref={fileInputRef} type="file" multiple accept=".pdf,.doc,.docx,image/*,.txt" className="hidden" onChange={e => handleUploadFiles(e.target.files)} />
                      <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                        className="neu-drop-zone w-full">
                        {uploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
                        <span className="text-xs font-semibold">{uploading ? '上传中...' : '点击选择文件上传'}</span>
                        <span className="text-[10px] text-[var(--muted-foreground)]">PDF / Word / 图片 / TXT，可多选</span>
                      </button>
                      {customFiles.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {customFiles.map(f => (
                            <div key={f.id} className="neu-attachment-item flex items-center gap-2 px-3 py-2 text-xs">
                              <FileText size={13} className="shrink-0 text-[var(--accent)]" />
                              <span className="min-w-0 flex-1 truncate text-[var(--foreground)]">{f.name}</span>
                              <span className="shrink-0 text-[var(--muted-foreground)] tabular-nums">{(f.size / 1024).toFixed(0)} KB</span>
                              <button type="button" onClick={() => setCustomFiles(prev => prev.filter(x => x.id !== f.id))} className="neu-btn-xs is-danger shrink-0 !h-5 !w-5 !p-0 justify-center"><X size={11} /></button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <button type="button" onClick={handleAnalyze} disabled={analyzing || customFiles.length === 0}
                      className="neu-btn-soft is-info">
                      {analyzing ? <Loader2 size={13} className="animate-spin" /> : <Brain size={13} />}
                      {analyzing ? 'AI 正在读取文件并推断需求...' : analysis ? '重新分析' : 'AI 分析文件'}
                    </button>

                    {analysis && (
                      <div className="space-y-3 rounded-xl bg-[color-mix(in_oklch,var(--accent)_5%,transparent)] p-4 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                        <div className="flex items-center gap-2 text-xs font-bold text-[var(--accent)]">
                          <Sparkles size={13} /> {analysis.engine === 'ai' ? '分析结果（请核对后可编辑）' : '默认配额（分析暂不可用，请手动调整）'}
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <label className="text-[11px] font-semibold text-[var(--muted-foreground)] block mb-1">项目名称 *</label>
                            <input value={customName} onChange={e => setCustomName(e.target.value)} className="neu-input text-sm w-full" placeholder="项目名称" />
                          </div>
                          <div>
                            <label className="text-[11px] font-semibold text-[var(--muted-foreground)] block mb-1">采购方式</label>
                            <input value={customMethod} onChange={e => setCustomMethod(e.target.value)} className="neu-input text-sm w-full" placeholder="如：公开招标" />
                          </div>
                        </div>
                        {analysis.projectBackground && (
                          <div>
                            <span className="text-[11px] font-semibold text-[var(--muted-foreground)] block mb-1">项目背景</span>
                            <p className="rounded-lg bg-[color-mix(in_oklch,var(--surface)_70%,transparent)] px-3 py-2 text-xs leading-relaxed text-[var(--foreground)]">{analysis.projectBackground}</p>
                          </div>
                        )}
                        <div>
                          <span className="text-[11px] font-semibold text-[var(--muted-foreground)] block mb-1">推断所需专业（将预填到抽取配置）</span>
                          <div className="space-y-1">
                            {[...analysis.requiredSpecialties].sort((a,b)=>(quotaOrderMap.get(a.specialty)??999)-(quotaOrderMap.get(b.specialty)??999)).map((s, i) => (
                              <div key={i} className="flex items-center gap-2 rounded-lg bg-[color-mix(in_oklch,var(--surface)_70%,transparent)] px-3 py-1.5 text-xs">
                                <span className="font-bold text-[var(--foreground)]">{s.specialty}</span>
                                <span className="rounded bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-1.5 py-0.5 font-bold text-[var(--accent)]">{s.count} 人</span>
                                {s.reason && <span className="min-w-0 flex-1 truncate text-[var(--muted-foreground)]">{s.reason}</span>}
                              </div>
                            ))}
                          </div>
                          <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">建议评审专家总数：<span className="font-bold text-[var(--foreground)]">{analysis.totalExperts} 人</span></p>
                        </div>
                        {analysis.analysis && (
                          <p className="rounded-lg bg-[color-mix(in_oklch,var(--surface)_70%,transparent)] px-3 py-2 text-[11px] leading-relaxed text-[var(--muted-foreground)]">推断依据：{analysis.analysis}</p>
                        )}
                        <button onClick={handleCreateCustomAndProceed} disabled={!analysis || creatingProject || !customName.trim()} className="neu-btn-soft is-info">
                          {creatingProject ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                          {creatingProject ? '创建项目并进入抽取...' : '创建项目并配置抽取'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* 项目摘要：名称 + 编号 + 采购方式 + 阶段 + 回避提示 */
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-sm font-bold text-[var(--foreground)]">{defaultProjectTitle || sel?.name}</span>
                  {sel && <span className="rounded-lg bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 font-semibold text-[var(--accent-strong)]">{sel.projectCode}</span>}
                  {sel && <span className="rounded-lg bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 font-semibold text-[var(--accent-strong)]">{sel.procurementMethod}</span>}
                  {sel && <span className="rounded-lg bg-[color-mix(in_oklch,var(--accent)_8%,transparent)] px-2 py-0.5 font-semibold text-[var(--accent-strong)]">{STAGE_LABEL[sel.stage] || sel.stage}</span>}
                </div>
                {pd?.suppliers?.length > 0 && <div className="rounded-lg bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-3 py-2 text-xs font-semibold text-[var(--warning)]">⚠ 参与供应商（将自动回避）：{pd.suppliers.map(s => s.supplierName).join('、')}</div>}
                {pd?.experts?.length > 0 && <div className="rounded-lg bg-[color-mix(in_oklch,var(--success)_8%,transparent)] px-3 py-2 text-xs font-semibold text-[var(--success)]">✓ 已分配专家：{pd.experts.map(e => `${e.expertName}（${e.major}）`).join('、')}</div>}
              </div>
            )}

            {/* 抽取配置区（项目确定后显示） */}
            {(pid || defaultProjectTitle) && (
            <>
            {/* 委员会席位构成（预算驱动） */}
            <div className="rounded-xl bg-[color-mix(in_oklch,var(--accent)_5%,transparent)] p-4 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-xs font-bold text-[var(--accent)]">
                  <UsersRound size={13} /> 委员会席位构成
                </div>
                <div className="flex items-center gap-1.5">
                  {demandRepSeats > 0 && <span className="rounded bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-2 py-0.5 text-xs font-semibold text-[var(--accent)]">需求方代表 × {demandRepSeats}</span>}
                  {workerRepSeats > 0 && <span className="rounded bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] px-2 py-0.5 text-xs font-semibold text-[var(--warning)]">职工代表 × {workerRepSeats}</span>}
                  <span className="rounded bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-2 py-0.5 text-xs font-semibold text-[var(--success)]">专业专家 × {expertSeats}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-lg bg-[var(--surface)] px-2.5 py-1 font-semibold text-[var(--foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">
                  项目预算：{budgetNum != null ? `¥ ${budgetNum.toLocaleString('zh-CN')}` : '未设置'}
                </span>
                <span className="rounded-lg bg-[var(--surface)] px-2.5 py-1 font-semibold text-[var(--foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">
                  委员会总席位：<strong className="text-[var(--accent)]">{totalSeats} 席</strong>
                  <span className="ml-1 text-[10px] font-normal text-[var(--muted-foreground)]">（{isLargeBudget ? '预算＞100万' : '预算≤100万'}）</span>
                </span>
              </div>

            </div>

            {/* 内容一 / 内容二：左右布局（窄屏自动堆叠） */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
              {/* 左列：内容一 */}
              <div className="neu-table-card p-4">
            {/* 内容一：需求方代表（可选） */}
            <div className="space-y-3">
              <div className="space-y-2">
                <span className="text-xs font-semibold text-[var(--muted-foreground)] block">内容一 · 需求方代表（可选{isLargeBudget ? `，占 ${demandRepCount} 席` : '，占 1 席'}）</span>
                <div className="flex justify-end">
                <div className="neu-tab-bar">
                  <button
                    onClick={() => toggleDemandRep(false)}
                    className={`neu-tab px-4 py-1.5 text-xs font-bold ${!needDemandRep ? 'is-active' : ''}`}
                  >
                    不需要
                  </button>
                  <button
                    onClick={() => toggleDemandRep(true)}
                    className={`neu-tab px-4 py-1.5 text-xs font-bold ${needDemandRep ? 'is-active' : ''}`}
                  >
                    需要
                  </button>
                </div>
                </div>
              </div>

              {needDemandRep && (
                <>
                  {/* 人数选择（仅预算＞100万） */}
                  {isLargeBudget && (
                    <div className="flex items-center gap-2 rounded-lg bg-[color-mix(in_oklch,var(--accent)_4%,transparent)] px-3 py-2">
                      <span className="text-xs font-semibold text-[var(--foreground)]">代表人数</span>
                      <div className="ml-auto neu-tab-bar">
                        <button onClick={() => changeDemandRepCount(1)} className={`neu-tab px-3 py-1 text-xs font-bold ${demandRepCount === 1 ? 'is-active' : ''}`}>1 人</button>
                        <button onClick={() => changeDemandRepCount(2)} className={`neu-tab px-3 py-1 text-xs font-bold ${demandRepCount === 2 ? 'is-active' : ''}`}>2 人</button>
                      </div>
                    </div>
                  )}
                  {/* 两种方式二选一 */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => { setDemandRepMode('designated'); setDemandRepDept(''); setDemandRepDeptSpecialty(''); }}
                      className={`neu-tab flex-col gap-0.5 py-2.5 ${demandRepMode === 'designated' ? 'is-active' : ''}`}
                    >
                      <span className="text-xs font-bold">1. 指定代表</span>
                      <span className="text-[10px] text-[var(--muted-foreground)] leading-tight">搜索并直接指定具体人员</span>
                    </button>
                    <button
                      onClick={() => { setDemandRepMode('department'); setDemandRepPersons([]); setDemandRepSearch(''); }}
                      className={`neu-tab flex-col gap-0.5 py-2.5 ${demandRepMode === 'department' ? 'is-active' : ''}`}
                    >
                      <span className="text-xs font-bold">2. 选择部门</span>
                      <span className="text-[10px] text-[var(--muted-foreground)] leading-tight">按部门抽取，专业可不选</span>
                    </button>
                  </div>

                  {/* 指定代表：搜索选人（支持 1-2 人，受 demandRepCount 限制） */}
                  {demandRepMode === 'designated' && (
                    <div className="space-y-2">
                      <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" />
                        <input value={demandRepSearch} onChange={e => setDemandRepSearch(e.target.value)} placeholder="搜索代表姓名、专业或单位..." className="neu-input !pl-9 text-sm" />
                      </div>
                      {demandRepPersons.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {demandRepPersons.map(p => (
                            <span key={p.userId} className="inline-flex items-center gap-1.5 rounded-lg bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] px-2.5 py-1 text-xs font-semibold text-[var(--accent)]">
                              {p.name}{p.specialty && <span className="font-normal text-[var(--muted-foreground)]">{p.specialty}</span>}
                              <button onClick={() => setDemandRepPersons(prev => prev.filter(x => x.userId !== p.userId))} className="ml-0.5 opacity-70 hover:opacity-100"><X size={11} /></button>
                            </span>
                          ))}
                        </div>
                      )}
                      {demandRepSearch.trim() && demandRepPersons.length < demandRepCount && (
                        <div className="max-h-[200px] overflow-y-auto space-y-1 rounded-xl bg-[var(--surface)] p-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                          {demandRepSearching ? <p className="text-xs text-[var(--muted-foreground)] text-center py-3"><RefreshCw size={12} className="animate-spin inline mr-1" />搜索中...</p>
                          : demandRepResults.length === 0 ? <p className="text-xs text-[var(--muted-foreground)] text-center py-3">未匹配到人员</p>
                          : demandRepResults.slice(0, 10).map(e => (
                            <div key={e.id} className="flex items-center justify-between rounded-lg px-2.5 py-1.5">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2"><span className="text-sm font-bold text-[var(--foreground)]">{e.displayName}</span>{e.expertProfile?.specialty && <span className="text-xs text-[var(--muted-foreground)]">{e.expertProfile.specialty}</span>}</div>
                                <div className="text-[11px] text-[var(--muted-foreground)] truncate">{e.expertProfile?.employer || ''}</div>
                              </div>
                              <button onClick={() => { setDemandRepPersons(prev => prev.some(x => x.userId === e.id) ? prev : [...prev, { userId: e.id, name: e.displayName, specialty: e.expertProfile?.specialty ?? '' }]); setDemandRepSearch(''); }} className="neu-btn-xs is-info shrink-0 ml-2">选定</button>
                            </div>
                          ))}
                        </div>
                      )}
                      {demandRepPersons.length < demandRepCount && <p className="text-[10px] text-[var(--muted-foreground)]">还需选定 {demandRepCount - demandRepPersons.length} 名代表（共需 {demandRepCount} 名）</p>}
                    </div>
                  )}

                  {/* 选择部门：部门 +（可选）专业 */}
                  {demandRepMode === 'department' && (
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <select value={demandRepDept} onChange={e => { setDemandRepDept(e.target.value); setDemandRepDeptSpecialty(''); }} className="neu-input text-sm flex-1">
                          <option value="">选择部门</option>
                          {employers.map(emp => <option key={emp} value={emp}>{emp}</option>)}
                        </select>
                        <select value={demandRepDeptSpecialty} onChange={e => setDemandRepDeptSpecialty(e.target.value)} disabled={!demandRepDept} className="neu-input text-sm flex-1 disabled:opacity-50">
                          <option value="">专业不限（可选）</option>
                          {(employerSpecs.get(demandRepDept) || []).map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      {demandRepDept && <p className="text-[10px] text-[var(--muted-foreground)]">将从「{demandRepDept}」{demandRepDeptSpecialty ? `·「${demandRepDeptSpecialty}」` : ''}的专家中抽取 1 名需求方代表。</p>}
                    </div>
                  )}
                </>
              )}
              </div>
              </div>

              {/* 右列：内容二 */}
              <div className="neu-table-card p-4">
            {/* 内容二：抽取专家（专业配额，必填） */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-[var(--muted-foreground)]">
                  内容二 · 抽取专家（专业配额，可分配 <strong className="text-[var(--foreground)]">{expertSeats}</strong> 席，已配 <strong className={seatsBalanced ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>{quotaSum}</strong> 席）
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={aiQuota} disabled={quotaAnalyzing || !pid} className="neu-btn-xs is-info" title="读取项目需求/立项/采购文件生成专业配额">
                    {quotaAnalyzing ? <><RefreshCw size={12} className="animate-spin inline mr-0.5" />分析中…</> : <><Sparkles size={12} className="inline mr-0.5" />AI 配额</>}
                  </button>
                  <button onClick={addQ} className="neu-btn-xs"><Plus size={12} />添加专业</button>
                </div>
              </div>
              {quotas
                .map((q, idx) => ({ q, idx }))
                .sort((a, b) => {
                  const ca = a.q.specialty ? (pool.get(a.q.specialty) ?? 0) : -1;
                  const cb = b.q.specialty ? (pool.get(b.q.specialty) ?? 0) : -1;
                  return cb - ca; // 库内人数降序，未选专业排末尾
                })
                .map(({ q, idx }) => (
                <div key={idx} className="flex items-center gap-2 mb-2">
                  <select value={q.specialty} onChange={e => upQ(idx, 'specialty', e.target.value)} className="neu-input text-sm flex-1"><option value="">选择专业</option>{[...specs].sort((a,b) => (pool.get(b)||0) - (pool.get(a)||0)).map(s => <option key={s} value={s}>{s}{pool.has(s) ? `（${pool.get(s)}人·库内）` : ''}</option>)}</select>
                  <div className="flex items-center gap-1"><button onClick={() => adjustQuota(idx, -1)} className="neu-btn-xs">−</button><span className="w-6 text-center text-sm font-extrabold tabular-nums text-[var(--foreground)]">{q.count}</span><button onClick={() => adjustQuota(idx, 1)} className="neu-btn-xs">+</button></div>
                  <button onClick={() => rmQ(idx)} disabled={quotas.length <= 1} className="neu-btn-xs is-danger">×</button>
                </div>
              ))}
              {!seatsBalanced && (
                <div className="rounded-lg bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-3 py-2 text-[11px] font-semibold text-[var(--warning)]">
                  专业配额合计须等于可分配席位 {expertSeats} 席（当前 {quotaSum} 席）
                </div>
              )}
            </div>
            </div>
            </div>

            {/* 职工代表席位（预算＞100万 自动固定 1 席；置于两列网格下方，全宽） */}
            {isLargeBudget && (
              <div className="flex items-center gap-2 rounded-xl bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-3 py-2.5 text-xs font-semibold text-[var(--warning)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                <ShieldCheck size={14} className="shrink-0" />
                <span>职工代表席位：预算超过 100 万，固定 <strong>1 席职工代表</strong>（抽取时自动从「职工代表」专业中抽取）。</span>
              </div>
            )}

            {/* 抽取方式：标签与按钮同处一个右对齐组件 */}
            <div className="flex justify-end">
              <div className="inline-flex items-center gap-2.5 rounded-xl bg-[color-mix(in_oklch,var(--surface)_70%,transparent)] py-1.5 pl-3.5 pr-1.5 shadow-[inset_0_1px_0_oklch(1_0_0/0.6),1.5px_1.5px_3px_oklch(0.55_0.03_258/0.08),-1px_-1px_2.5px_oklch(1_0_0/0.8)]">
                <span className="text-xs font-semibold text-[var(--muted-foreground)] whitespace-nowrap">抽取方式</span>
                <div className="neu-tab-bar">
                {(['random', 'merit_best'] as ExtractMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setExtractMode(m)}
                    title={MODE_DESCS[m]}
                    className={`neu-tab px-3.5 py-1.5 text-xs font-bold ${extractMode === m ? 'is-active' : ''}`}
                  >
                    {MODE_LABELS[m]}
                  </button>
                ))}
              </div>
              </div>
            </div>

            {/* 开始抽取 */}
            <div className="flex items-center justify-end gap-3">
              {!canExtract && pid && (
                <span className="text-[11px] text-[var(--muted-foreground)]">
                  {!seatsBalanced ? '请先配平专业配额' : needDemandRep && !demandRepMode ? '请选择需求方代表方式' : needDemandRep && demandRepMode === 'designated' && demandRepPersons.length !== demandRepCount ? `请指定 ${demandRepCount} 名需求方代表（已选 ${demandRepPersons.length} 名）` : needDemandRep && demandRepMode === 'department' && !demandRepDept ? '请选择需求方代表部门' : ''}
                </span>
              )}
              <button onClick={run} disabled={loading || !canExtract} className="neu-btn-soft !w-auto justify-center px-6"><Sparkles size={15} />{loading ? '抽取中...' : '开始抽取'}</button>
            </div>
            </>
            )}
          </div>
          {preview && (
            <div className="flex justify-end pr-4">
              <button onClick={() => setStep(2)} className="neu-btn-soft is-info">
                下一步：审核调整<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── 步骤 2：审核调整 ── */}
      {step === 2 && (
        <div className="space-y-4">
          {loading && <div className="neu-table-card py-14 text-center"><div className="inline-flex items-center gap-2 text-sm font-bold text-[var(--accent)]"><RefreshCw size={14} className="animate-spin" />AI 正在分析项目需求并抽取专家组...</div></div>}

          {preview && !loading && (
              <div className="space-y-4">
                {/* AI 分析 */}
                <div className="neu-table-card p-4">
                  <div className="flex items-center gap-2 mb-3">
                    {preview.engine === 'deepseek' ? <Sparkles size={16} className="text-[var(--accent)]" /> : <ShieldCheck size={16} className="text-[var(--warning)]" />}
                    <h2 className="text-sm font-bold text-[var(--foreground)]">{preview.engine === 'deepseek' ? 'AI 评审组分析' : '规则引擎组建'}</h2>
                    <span className={`inline-flex items-center rounded-[6px] px-1.5 py-0.5 text-[10px] font-bold shadow-[inset_0_0.5px_0_oklch(1_0_0/0.5)] ${preview.engine === 'deepseek' ? 'bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent)]' : 'bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] text-[var(--warning)]'}`}>{preview.engine === 'deepseek' ? 'AI' : '规则'}</span>
                  </div>
                  <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">{preview.analysis}</p>
                  {preview.requiredSpecialties.length > 0 && <div className="flex flex-wrap items-center gap-2 mt-3">{[...preview.requiredSpecialties].sort((a,b)=>(quotaOrderMap.get(a.specialty)??999)-(quotaOrderMap.get(b.specialty)??999)).map(q => <span key={q.specialty} className="neu-tab-count">{q.specialty} × {q.count}</span>)}</div>}
                </div>

                {preview.shortages.length > 0 && <div className="rounded-xl bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] px-4 py-3 text-sm text-[var(--warning)]"><AlertTriangle size={16} className="inline mr-2" />专业候选人不足{preview.shortages.map(s => `：${s.specialty} 需${s.needed}人/仅${s.available}人`).join('')}</div>}

                {/* 指定需求方代表（固定成员，不参与抽取；1-2 人） */}
                {demandRepItems.map(item => (
                  <div key={item.userId} className="flex items-center gap-3 rounded-xl bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] px-4 py-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                    <UserCircle size={18} className="shrink-0 text-[var(--accent)]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><span className="text-sm font-bold text-[var(--foreground)]">{item.name}</span><StatusBadge tone="blue">{item.specialty}</StatusBadge><StatusBadge tone="purple">需求方代表</StatusBadge></div>
                      <p className="text-[11px] text-[var(--muted-foreground)]">指定需求方代表 · 确认组建时将作为正选成员加入</p>
                    </div>
                  </div>
                ))}

                {/* 正选专家组（可调整） */}
                <div className="neu-table-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">正选专家组 · {selectedExperts.length} 人</span>
                    <button onClick={() => { setReplaceTarget(null); setReplaceSearch(''); setShowReplaceModal(true); }} className="neu-btn-xs"><Plus size={12} />添加专家</button>
                  </div>
                  {sortedSelectedExperts.map((s, i) => (
                    <div key={s.userId} className={`flex items-start gap-3 mt-3 ${i > 0 ? 'border-t border-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] pt-3' : ''}`}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-bold text-[var(--foreground)] cursor-pointer hover:text-[var(--accent)]" onClick={() => router.push('/expert/' + s.userId)}>{s.name}</span><StatusBadge tone="blue">{s.specialty}</StatusBadge><StatusBadge tone="green">正选</StatusBadge>{s.evaluationLevel && <StatusBadge tone={s.evaluationLevel === 'A' ? 'green' : s.evaluationLevel === 'B' ? 'blue' : s.evaluationLevel === 'D' ? 'orange' : s.evaluationLevel === 'E' ? 'red' : 'gray'}>{s.evaluationLevel}</StatusBadge>}</div>
                        <p className="text-xs text-[var(--muted-foreground)] mt-1 mb-1">{s.reason}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => openReplace(s.userId, 'selected')} className="neu-btn-xs" title="替换"><Pencil size={11} /></button>
                        <button onClick={() => removeExpert(s.userId, 'selected')} className="neu-btn-xs is-danger" title="移除"><X size={11} /></button>
                      </div>
                    </div>
                  ))}
                </div>




              </div>
            )}



            <div className="flex items-center justify-between pt-4 border-t border-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]">
              <div className="flex items-center gap-3">
                <button onClick={() => { setStep(1); setStep3Confirmed(false); }} className="neu-btn-soft"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg> 上一步：抽取配置</button>
              </div>
              <div className="flex items-center gap-3">
                {step3Confirmed || confirmedExpertIds.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 rounded-xl bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-4 py-2 text-sm font-bold text-[var(--success)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">
                    <Check size={15} strokeWidth={2.5} />已组建
                  </span>
                ) : (
                  <button onClick={confirm} disabled={confirming || selectedExperts.length === 0} className="neu-btn-soft is-success">
                    <Check size={16} />{confirming ? '组建中...' : `组建专家组（${selectedExperts.length} 人）`}
                  </button>
                )}
                <button onClick={goToNotify} disabled={!step3Confirmed && confirmedExpertIds.length === 0} className="neu-btn-soft is-info">
                  下一步：通知专家<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </button>
              </div>
            </div>
        </div>
      )}

      {/* ── 步骤 3：发送通知 ── */}
      {step === 3 && (
        <div className="space-y-4">

          {/* 通知表单（发送通知后可回看编辑） */}

            <div className="neu-table-card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-extrabold text-white">3</span>
                <span className="text-sm font-bold text-[var(--foreground)]">发送通知 · {confirmedExpertIds.length} 名专家</span>
              </div>

              {/* 开标时间 */}
              <div>
                <span className="text-xs font-semibold text-[var(--muted-foreground)] block mb-1.5">
                  开标时间 <span className="text-[var(--danger)]">*</span>
                </span>
                <div className="flex gap-2">
                  <div className="w-[150px]">
                    <span className="text-[10px] font-semibold text-[var(--muted-foreground)] block mb-0.5">日期</span>
                    <input type="date" value={openTimeDate} onChange={e => setOpenTimeDate(e.target.value)} className="neu-input text-sm w-full" />
                  </div>
                  <div className="w-[100px]">
                    <span className="text-[10px] font-semibold text-[var(--muted-foreground)] block mb-0.5">时间</span>
                    <input type="time" value={openTimeTime} onChange={e => setOpenTimeTime(e.target.value)} className="neu-input text-sm w-full" />
                  </div>
                </div>
                {openTimeFormatted && <p className="text-[10px] text-[var(--accent)]/70 mt-1">已设置：{openTimeFormatted}</p>}
              </div>

              {/* 通知渠道（统一，适用于全部专家，居左紧凑） */}
              <div>
                <span className="text-xs font-semibold text-[var(--muted-foreground)] block mb-2">通知渠道</span>
                <div className="flex gap-2 w-fit">
                  {[
                    { key: 'in_app', icon: Bell, label: 'OA站内信' },
                    { key: 'sms', icon: MessageSquare, label: '短信通知' },
                    { key: 'phone', icon: Phone, label: '电话通知' },
                  ].map(ch => {
                    const active = getChannelsForExpert(notifyActiveExpert || step4Experts[0]?.userId || '').includes(ch.key);
                    return (
                      <button
                        key={ch.key}
                        onClick={() => {
                          const allExperts = step4Experts;
                          const current = new Set(notifyChannelsByExpert.get(allExperts[0]?.userId || '') || ['in_app', 'sms', 'phone']);
                          const updated = current.has(ch.key) ? [...current].filter(c => c !== ch.key) : [...current, ch.key];
                          const newMap = new Map(notifyChannelsByExpert);
                          for (const e of allExperts) newMap.set(e.userId, updated.length > 0 ? updated : ['in_app']);
                          setNotifyChannelsByExpert(newMap);
                          if (!notifyActiveExpert && step4Experts[0]) setNotifyActiveExpert(step4Experts[0].userId);
                        }}
                        className={`neu-tab flex-col gap-1 py-2 px-4 ${active ? 'is-active' : ''}`}
                      >
                        <ch.icon size={16} />
                        <span className="text-[11px]">{ch.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 正选通知内容 */}
              <div className="rounded-xl bg-[color-mix(in_oklch,var(--accent)_4%,transparent)] p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--accent)]">正选专家组通知 · {step4Experts.length} 人</span>
                  <button
                    onClick={async () => {
                      const projectName = sel?.name || '采购项目';
                      const t0 = Date.now();
                      toast.loading('AI 生成通知…', { id: 'notif-all' });
                      try {
                        // 1. 先拉取 RSVP 链接，失败则直接报错不继续
                        if (!pid) throw new Error('缺少项目 ID');
                        const data = await prersvpLinks(pid);
                        const links = data.links || {};
                        if (!Object.keys(links).length) throw new Error('未找到专家记录，请先确认专家组组建');
                        setRsvpLinks(links);
                        // 2. AI 生成通知模板
                        const newMessages = new Map(notifyMessages);
                        const mainRes = await generateNotification({ projectName, expertName: '[[专家姓名]]', isLead: false, totalExperts: step4Experts.length, extractMode: MODE_LABELS[extractMode], openTime: openTimeFormatted, projectId: pid });
                        if (mainRes.generated && mainRes.content) {
                          for (const e of step4Experts) {
                            const link = links[e.userId];
                            let content = mainRes.content.replace(/\[\[专家姓名\]\]/g, e.name);
                            // 有链接则替换，无则用明确提示文案（比 {RSVP_LINK} 占位符更直观）
                            content = content.replace(/\{RSVP_LINK\}/g, link || '【确认链接待生成，请刷新重试】');
                            newMessages.set(e.userId, content);
                          }
                        }
                        updateMessages(newMessages);
                        const elapsed = Date.now() - t0;
                        if (elapsed < 600) await new Promise(r => setTimeout(r, 600 - elapsed));
                        toast.success('已生成通知内容', { id: 'notif-all' });
                      } catch (e: any) { toast.error(e?.message || '生成失败', { id: 'notif-all' }); }
                    }}
                    className="neu-btn-xs is-info"
                  >
                    <Sparkles size={11} />AI 生成全部通知
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {step4Experts.map(e => (
                    <button
                      key={e.userId}
                      onClick={() => setNotifyActiveExpert(e.userId)}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold shadow-[inset_0_1px_0_oklch(1_0_0/0.6),1px_1px_3px_oklch(0.55_0.03_258/0.1)] transition-colors ${e.userId === notifyActiveExpert ? 'bg-[var(--accent)] text-white' : 'bg-[var(--neu-raised-bg)] text-[var(--foreground)] hover:bg-[color-mix(in_oklch,var(--accent)_8%,var(--neu-raised-bg))]'}`}
                    >
                      <span>{e.name || '未知'}</span>
                      <span className="text-xs font-normal opacity-70">{e.specialty}</span>
                    </button>
                  ))}
                </div>
                <textarea
                  key={notifyVersion}
                  value={notifyMessages.get(notifyActiveExpert && step4Experts.some(e => e.userId === notifyActiveExpert) ? notifyActiveExpert : step4Experts[0]?.userId || '') || ''}
                  onChange={e => updateMessages(new Map(notifyMessages).set(notifyActiveExpert && step4Experts.some(e => e.userId === notifyActiveExpert) ? notifyActiveExpert : step4Experts[0]?.userId || '', e.target.value))}
                  placeholder="点击上方专家姓名查看/编辑其通知内容"
                  className="neu-input text-sm w-full min-h-[160px] resize-y"
                  rows={8}
                />
              </div>


            </div>
          <div className="flex items-center justify-between pt-4 border-t border-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]">
            <button onClick={() => { setStep(2); setStep3Confirmed(false); }} className="neu-btn-soft">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg> 上一步：审核调整
            </button>
            <div className="flex items-center gap-3">
              {done || (notifyResults && notifyResults.length > 0) || notifySentRef.current ? (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-4 py-2 text-sm font-bold text-[var(--success)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">
                  <Check size={15} strokeWidth={2.5} />已通知
                </span>
              ) : (
                <button onClick={sendNotify} disabled={notifying} className="neu-btn-soft is-success">
                  {notifying ? '发送中...' : '发送通知并邀请确认'}
                </button>
              )}
              <button onClick={() => setStep(4)} disabled={!done && !(notifyResults && notifyResults.length > 0)} className="neu-btn-soft is-info">
                下一步：专家确认与补选<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 步骤 4：专家确认与补选 ── */}
      {step === 4 && (
        <div className="space-y-4">
          {invitationData && (
            <>
              {(() => {
                const mainExperts = invitationData.experts.filter(e => e.expertRole === '正选' && originalConfirmedIdsRef.current.has(e.userId));
                const mainConfirmed = mainExperts.filter(e => e.invitationStatus === 'confirmed').length;
                const allResponded = mainExperts.every(e => e.invitationStatus !== 'pending');
                if (!allResponded || mainConfirmed >= totalSeats) return null;
                return (
                <div className="rounded-xl bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--warning)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">
                  <AlertTriangle size={16} className="inline mr-2" />
                  当前专家组成员未满 {totalSeats} 人（已确认 {mainConfirmed} 人），请点击下方「补选」按钮进行补选
                </div>
                );
              })()}

              {/* 总席位汇总：原始 + 各轮补选的总体进度 */}
              {(() => {
                const allMain = (invitationData?.experts ?? []).filter(e => e.expertRole === '正选');
                const totalConfirmed = allMain.filter(e => e.invitationStatus === 'confirmed').length;
                const totalPending = allMain.filter(e => e.invitationStatus === 'pending').length;
                const totalDeclined = allMain.filter(e => e.invitationStatus === 'declined').length;
                const reached = totalConfirmed >= totalSeats;
                return (
                <div className={`rounded-xl px-4 py-2.5 text-xs font-bold flex items-center gap-3 ${reached ? 'bg-[color-mix(in_oklch,var(--success)_10%,transparent)] text-[var(--success)]' : 'bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] text-[var(--foreground)]'}`}>
                  <Check size={14} className={reached ? '' : 'text-[var(--accent)]'} />
                  <span>{reached ? '专家组已满员' : '专家组组建进度'}</span>
                  <span className="ml-1">{totalConfirmed} / {totalSeats} 席</span>
                  <div className="ml-auto flex gap-1.5">
                    <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--success)]">{totalConfirmed} 已确认</span>
                    {totalPending > 0 && <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--warning)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--warning)]">{totalPending} 待回复</span>}
                    {totalDeclined > 0 && <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--danger)]">{totalDeclined} 已拒绝</span>}
                  </div>
                </div>
                );
              })()}

              <div className="neu-table-card">
                <div className="flex items-center gap-3 py-2 mb-3 border-b border-[color-mix(in_oklch,var(--success)_20%,transparent)]">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[color-mix(in_oklch,var(--success)_15%,transparent)] text-[11px] font-extrabold text-[var(--success)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">
                    {invitationData.experts.filter(e=>e.expertRole==='正选' && originalConfirmedIdsRef.current.has(e.userId)).length}</div>
                  <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">正选评审专家</span>
                  {(() => {
                    const experts = invitationData.experts.filter(e=>e.expertRole==='正选' && originalConfirmedIdsRef.current.has(e.userId));
                    const confirmedByMajor = new Map<string,number>();
                    experts.filter(e=>e.invitationStatus==='confirmed').forEach(e=>{const m=e.major||'综合';confirmedByMajor.set(m,(confirmedByMajor.get(m)||0)+1);});
                    return (
                  <div className="flex items-center gap-1.5">
                    {quotas.filter(q=>q.specialty&&q.count>0).map(q=>{const done=confirmedByMajor.get(q.specialty)||0;return(<span key={q.specialty} className={`rounded-[6px] px-2 py-0.5 text-[10px] font-bold ${done>=q.count?'bg-[color-mix(in_oklch,var(--success)_12%,transparent)] text-[var(--success)]':'bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] text-[var(--warning)]'}`}>{q.specialty} {done}/{q.count}</span>);})}
                    {isLargeBudget && <span className={`rounded-[6px] px-2 py-0.5 text-[10px] font-bold ${(confirmedByMajor.get('职工代表')||0)>=1?'bg-[color-mix(in_oklch,var(--success)_12%,transparent)] text-[var(--success)]':'bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] text-[var(--warning)]'}`}>职工代表 {confirmedByMajor.get('职工代表')||0}/1</span>}
                    {needDemandRep && (() => { const repConfirmed = demandRepItems.filter(r => experts.some(e => e.userId === r.userId && e.invitationStatus === 'confirmed')).length; const repTotal = demandRepItems.length || demandRepCount; return <span className={`rounded-[6px] px-2 py-0.5 text-[10px] font-bold ${repConfirmed>=repTotal?'bg-[color-mix(in_oklch,var(--success)_12%,transparent)] text-[var(--success)]':'bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] text-[var(--warning)]'}`}>需求方代表 {repConfirmed}/{repTotal}</span>; })()}
                  </div>
                    );
                  })()}
                  <div className="flex gap-1.5 ml-auto">
                    <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--success)]">{invitationData.experts.filter(e=>e.expertRole==='正选' && originalConfirmedIdsRef.current.has(e.userId)&&e.invitationStatus==='confirmed').length} 已确认</span>
                    <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--warning)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--warning)]">{invitationData.experts.filter(e=>e.expertRole==='正选' && originalConfirmedIdsRef.current.has(e.userId)&&e.invitationStatus==='pending').length} 待回复</span>
                    {invitationData.experts.filter(e=>e.expertRole==='正选' && originalConfirmedIdsRef.current.has(e.userId)&&e.invitationStatus==='declined').length>0 && <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--danger)]">{invitationData.experts.filter(e=>e.expertRole==='正选' && originalConfirmedIdsRef.current.has(e.userId)&&e.invitationStatus==='declined').length} 已拒绝</span>}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="neu-table w-full table-fixed">
                    <thead><tr><th className="text-center">专家</th><th className="text-center">专业</th><th className="text-center">职称</th><th className="text-center">回复状态</th><th className="text-center">回执号</th><th className="text-center">操作</th></tr></thead>
                    <tbody>
                      {invitationData.experts.filter(e=>e.expertRole==='正选' && originalConfirmedIdsRef.current.has(e.userId)).sort((a,b)=>(a.invitationStatus==='declined'?1:0)-(b.invitationStatus==='declined'?1:0)).map(e => (
                        <tr key={e.id}>
                          <td className="text-center"><span className="text-sm font-bold text-[var(--foreground)]">{e.expertName}</span></td>
                          <td className="text-center text-sm text-[var(--muted-foreground)]">{e.major}</td>
                          <td className="text-center text-xs text-[var(--muted-foreground)]">{e.title || '—'}</td>
                          <td className="text-center">{e.invitationStatus==='confirmed'?<StatusBadge tone="green">确认参加</StatusBadge>:e.invitationStatus==='pending'?<StatusBadge tone="blue">待回复</StatusBadge>:(e.rsvpExpiresAt && e.rsvpRespondedAt && new Date(e.rsvpRespondedAt).getTime() >= new Date(e.rsvpExpiresAt).getTime() ? <StatusBadge tone="red">超时拒绝</StatusBadge> : <StatusBadge tone="red">无法参加</StatusBadge>)}</td>
                          <td className="text-center text-[11px] font-mono text-[var(--muted-foreground)]">{e.rsvpRespondedAt?(e.rsvpNo||'—'):'—'}</td>
                          <td className="text-center">{e.invitationStatus==='pending'&&(<div className="flex justify-center gap-1"><button onClick={async()=>{try{await confirmInvitation(pid,e.userId);setInvitationData(await getProjectInvitations(pid));toast.success(e.expertName+' 已确认')}catch(err:any){toast.error(err?.message||'操作失败')}}} className="neu-btn-xs is-success">确认参加</button><button onClick={async()=>{try{const res=await declineInvitation(pid,e.userId);setInvitationData(await getProjectInvitations(pid));toast.success(e.expertName+' 已标记无法参加')}catch(err:any){toast.error(err?.message||'操作失败')}}} className="neu-btn-xs is-danger">无法参加</button></div>)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 补选历史记录：每次补选的专家 + 回复状态（从 invitationData 按 expertIds 取） */}
              {reHistory.length > 0 && (
                <div className="neu-table-card">
                  <div className="flex items-center gap-3 py-2 mb-3 border-b border-[color-mix(in_oklch,var(--accent)_20%,transparent)]">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[color-mix(in_oklch,var(--accent)_15%,transparent)] text-[11px] font-extrabold text-[var(--accent)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">{reHistory.length}</div>
                    <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">补选历史</span>
                  </div>
                  <div className="space-y-3">
                    {reHistory.map((h, hi) => {
                      const idSet = new Set(h.expertIds);
                      const experts = (invitationData?.experts ?? []).filter(e => idSet.has(e.userId));
                      const confirmed = experts.filter(e => e.invitationStatus === 'confirmed').length;
                      return (
                        <div key={hi} className="rounded-xl border border-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)] overflow-hidden">
                          <div className="flex items-center gap-2 px-3 py-2 bg-[color-mix(in_oklch,var(--accent)_4%,transparent)]">
                            <span className="text-xs font-bold text-[var(--foreground)]">第{h.roundNo}次补选</span>
                            <span className="text-[11px] text-[var(--muted-foreground)]">· {h.selected.length} 人</span>
                            <div className="ml-auto flex items-center gap-1.5">
                              <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--success)]">{confirmed} 确认</span>
                              {experts.filter(e => e.invitationStatus === 'pending').length > 0 && <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--warning)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--warning)]">{experts.filter(e => e.invitationStatus === 'pending').length} 待回</span>}
                              {experts.filter(e => e.invitationStatus === 'declined').length > 0 && <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--danger)]">{experts.filter(e => e.invitationStatus === 'declined').length} 拒绝</span>}
                              {!h.notified && <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--muted-foreground)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--muted-foreground)]">未通知</span>}
                              {!h.notified && <button onClick={() => reopenReModal(h.roundNo)} disabled={!!reDraft} className="neu-btn-xs is-info">继续通知</button>}
                            </div>
                          </div>
                          <table className="neu-table w-full table-fixed">
                            <thead><tr><th className="text-center">专家</th><th className="text-center">专业</th><th className="text-center">职称</th><th className="text-center">回复状态</th><th className="text-center">回执号</th><th className="text-center">操作</th></tr></thead>
                            <tbody>
                              {experts.map(e => (
                                <tr key={e.id}>
                                  <td className="text-center"><span className="text-sm font-bold text-[var(--foreground)]">{e.expertName}</span></td>
                                  <td className="text-center text-sm text-[var(--muted-foreground)]">{e.major}</td>
                                  <td className="text-center text-xs text-[var(--muted-foreground)]">{e.title || '—'}</td>
                                  <td className="text-center">{e.invitationStatus==='confirmed'?<StatusBadge tone="green">确认参加</StatusBadge>:e.invitationStatus==='pending'?<StatusBadge tone="blue">待回复</StatusBadge>:(e.rsvpExpiresAt && e.rsvpRespondedAt && new Date(e.rsvpRespondedAt).getTime() >= new Date(e.rsvpExpiresAt).getTime() ? <StatusBadge tone="red">超时拒绝</StatusBadge> : <StatusBadge tone="red">无法参加</StatusBadge>)}</td>
                                  <td className="text-center text-[11px] font-mono text-[var(--muted-foreground)]">{e.rsvpRespondedAt?(e.rsvpNo||'—'):'—'}</td>
                                  <td className="text-center">{e.invitationStatus==='pending'&&(<div className="flex justify-center gap-1"><button onClick={async()=>{try{await confirmInvitation(pid,e.userId);setInvitationData(await getProjectInvitations(pid));toast.success(e.expertName+' 已确认')}catch(err:any){toast.error(err?.message||'操作失败')}}} className="neu-btn-xs is-success">确认参加</button><button onClick={async()=>{try{const res=await declineInvitation(pid,e.userId);setInvitationData(await getProjectInvitations(pid));toast.success(e.expertName+' 已标记无法参加')}catch(err:any){toast.error(err?.message||'操作失败')}}} className="neu-btn-xs is-danger">无法参加</button></div>)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
          {!invitationData && (
            <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]"><RefreshCw size={14} className="animate-spin inline mr-2" />加载专家确认状态...</div>
          )}

              <div className="flex justify-between pr-4 pt-4 border-t border-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]">
                <button onClick={() => setStep(3)} className="neu-btn-soft"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg> 返回上一步：确认通知</button>
                {(() => {
                  const full = (invitationData?.experts?.filter(e => e.expertRole === '正选' && e.invitationStatus === 'confirmed').length ?? 0) >= totalSeats;
                  if (full) return (
                    <button onClick={() => setStep(5)} className="neu-btn-soft is-info">
                      下一步：专家组确认<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                    </button>
                  );
                  return (
                    <button onClick={openReModal} disabled={!!reDraft} className="neu-btn-soft"><Plus size={13} className="mr-0.5" />{reDraft ? '补选中…' : '补选'}</button>
                  );
                })()}
              </div>

        </div>
      )}

      {/* ── 步骤 5：专家组确认（常态化，展示最终专家组成员）── */}
      {step === 5 && (
        <div className="space-y-4">
          {invitationData && (
            <>
              <div className="rounded-xl bg-[color-mix(in_oklch,var(--success)_10%,transparent)] px-4 py-3 text-sm font-bold text-[var(--success)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5)] flex items-center gap-2">
                <Check size={16} strokeWidth={2.5} />
                {(() => {
                  const finalMain = invitationData.experts.filter(e => e.expertRole === '正选');
                  const confirmed = finalMain.filter(e => e.invitationStatus === 'confirmed').length;
                  const pending = finalMain.filter(e => e.invitationStatus === 'pending').length;
                  if (confirmed >= totalSeats) return <span>专家组已组建完成，共 {totalSeats} 席，全部确认参加</span>;
                  if (pending > 0) return <span>专家组组建中，{confirmed}/{totalSeats} 已确认，{pending} 待回复</span>;
                  return <span>专家组已组建，{confirmed}/{totalSeats} 人确认参加</span>;
                })()}
              </div>

              {/* 最终专家组成员表 */}
              <div className="neu-table-card">
                <div className="flex items-center gap-3 py-2 mb-3 border-b border-[color-mix(in_oklch,var(--success)_20%,transparent)]">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[color-mix(in_oklch,var(--success)_15%,transparent)] text-[11px] font-extrabold text-[var(--success)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">
                    {invitationData.experts.filter(e => e.expertRole === '正选' && e.invitationStatus === 'confirmed').length}</div>
                  <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">最终专家组成员</span>
                  <div className="flex gap-1.5 ml-auto">
                    <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--success)]">{invitationData.experts.filter(e => e.expertRole === '正选' && e.invitationStatus === 'confirmed').length} 已确认</span>
                    {invitationData.experts.filter(e => e.expertRole === '正选' && e.invitationStatus === 'pending').length > 0 && <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--warning)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--warning)]">{invitationData.experts.filter(e => e.expertRole === '正选' && e.invitationStatus === 'pending').length} 待回复</span>}
                    {invitationData.experts.filter(e => e.expertRole === '正选' && e.invitationStatus === 'declined').length > 0 && <span className="rounded-[6px] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] px-2 py-0.5 text-[10px] font-bold text-[var(--danger)]">{invitationData.experts.filter(e => e.expertRole === '正选' && e.invitationStatus === 'declined').length} 已拒绝</span>}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="neu-table w-full table-fixed">
                    <thead><tr><th className="text-center">专家</th><th className="text-center">专业</th><th className="text-center">职称</th><th className="text-center">来源</th><th className="text-center">回复状态</th><th className="text-center">回执号</th></tr></thead>
                    <tbody>
                      {invitationData.experts.filter(e => e.expertRole === '正选' && e.invitationStatus !== 'declined').sort((a, b) => (a.invitationStatus === 'confirmed' ? -1 : 1) - (b.invitationStatus === 'confirmed' ? -1 : 1)).map(e => {
                        const isOriginal = originalConfirmedIdsRef.current.has(e.userId);
                        const roundNo = reHistoryRoundMap.get(e.userId);
                        return (
                        <tr key={e.id}>
                          <td className="text-center"><span className="text-sm font-bold text-[var(--foreground)]">{e.expertName}</span></td>
                          <td className="text-center text-sm text-[var(--muted-foreground)]">{e.major}</td>
                          <td className="text-center text-xs text-[var(--muted-foreground)]">{e.title || '—'}</td>
                          <td className="text-center">{isOriginal ? <StatusBadge tone="green">正选</StatusBadge> : <StatusBadge tone="blue">第{roundNo || '?'}次补选</StatusBadge>}</td>
                          <td className="text-center">{e.invitationStatus === 'confirmed' ? <StatusBadge tone="green">确认参加</StatusBadge> : <StatusBadge tone="blue">待回复</StatusBadge>}</td>
                          <td className="text-center text-[11px] font-mono text-[var(--muted-foreground)]">{e.rsvpRespondedAt ? (e.rsvpNo || '—') : '—'}</td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-between pt-4 border-t border-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]">
                <button onClick={() => setStep(4)} className="neu-btn-soft"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg> 上一步：专家确认与补选</button>
                <button onClick={() => setStep(6)} className="neu-btn-soft is-info">下一步：候补专家抽取与确认<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg></button>
              </div>
            </>
          )}
          {!invitationData && (
            <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]"><RefreshCw size={14} className="animate-spin inline mr-2" />加载专家确认状态...</div>
          )}
        </div>
      )}

      {/* ── 步骤 6：候补专家抽取与确认 ── */}
      {step === 6 && (
        <div className="space-y-4">
          {altExtracting ? (
            <div className="neu-table-card py-14 text-center">
              <RefreshCw size={26} className="animate-spin text-[var(--accent)] mx-auto mb-3" />
              <p className="text-sm font-bold text-[var(--foreground)]">AI 正在抽取候补专家...</p>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">按专业配额抽取，自动排除已邀请专家</p>
            </div>
          ) : altPreview ? (
            <>
              {/* AI 分析 */}
              <div className="neu-table-card p-4">
                <div className="flex items-center gap-2 mb-2">
                  {altPreview.engine === 'deepseek' ? <Sparkles size={16} className="text-[var(--accent)]" /> : <ShieldCheck size={16} className="text-[var(--warning)]" />}
                  <h2 className="text-sm font-bold text-[var(--foreground)]">候补专家抽取结果</h2>
                  <span className={`inline-flex items-center rounded-[6px] px-1.5 py-0.5 text-[10px] font-bold shadow-[inset_0_0.5px_0_oklch(1_0_0/0.5)] ${altPreview.engine === 'deepseek' ? 'bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent)]' : 'bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] text-[var(--warning)]'}`}>{altPreview.engine === 'deepseek' ? 'AI' : '规则'}</span>
                </div>
                <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">{altPreview.analysis}</p>
              </div>

              {/* 候补专家名单 */}
              <div className="neu-table-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">候补专家组 · {altSelected.length} 人</span>
                  <button onClick={() => { setAltPreview(null); setAltSelected([]); extractAlternates(); }} disabled={altExtracting} className="neu-btn-xs"><RefreshCw size={12} className="inline mr-0.5" />重新抽取</button>
                </div>
                {altSelected.map((s, i) => (
                  <div key={s.userId} className={`flex items-start gap-3 mt-3 ${i > 0 ? 'border-t border-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] pt-3' : ''}`}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklch,var(--warning)_40%,transparent)] text-xs font-extrabold text-[var(--warning)]">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-[var(--foreground)] cursor-pointer hover:text-[var(--accent)]" onClick={() => router.push('/expert/' + s.userId)}>{s.name}</span>
                        <StatusBadge tone="blue">{s.specialty}</StatusBadge>
                        <StatusBadge tone="orange">候补</StatusBadge>
                        {s.evaluationLevel && <StatusBadge tone={s.evaluationLevel === 'A' ? 'green' : s.evaluationLevel === 'B' ? 'blue' : s.evaluationLevel === 'D' ? 'orange' : s.evaluationLevel === 'E' ? 'red' : 'gray'}>{s.evaluationLevel}</StatusBadge>}
                      </div>
                      <p className="text-xs text-[var(--muted-foreground)] mt-1 mb-1">{s.reason}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* 通知渠道（适用于全部候补专家） */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-[var(--muted-foreground)] block">通知渠道</span>
                <div className="flex flex-wrap gap-2">
                  {([{ key: 'in_app', icon: Bell, label: 'OA站内信' }, { key: 'sms', icon: MessageSquare, label: '短信通知' }, { key: 'phone', icon: Phone, label: '电话通知' }] as const).map(ch => {
                    const active = (notifyChannelsByExpert.get(altSelected[0]?.userId || '') || ['in_app', 'sms', 'phone']).includes(ch.key);
                    return (
                      <button key={ch.key} onClick={() => {
                        const current = new Set(notifyChannelsByExpert.get(altSelected[0]?.userId || '') || ['in_app', 'sms', 'phone']);
                        if (current.has(ch.key)) current.delete(ch.key); else current.add(ch.key);
                        const updated = [...current];
                        const newMap = new Map(notifyChannelsByExpert);
                        for (const e of altSelected) newMap.set(e.userId, updated.length > 0 ? updated : ['in_app']);
                        setNotifyChannelsByExpert(newMap);
                      }} className={`neu-tab px-3 py-1.5 text-xs font-bold ${active ? 'is-active' : ''}`}>
                        <ch.icon size={12} className="inline mr-1" />{ch.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 通知内容预览 */}
              <div className="neu-table-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare size={14} className="text-[var(--accent)]" />
                  <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">候补通知内容</span>
                </div>
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {altSelected.map(e => (
                    <div key={e.userId} className="rounded-xl bg-[var(--surface)] p-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-[var(--foreground)]">{e.name}</span>
                        <StatusBadge tone="blue">{e.specialty}</StatusBadge>
                      </div>
                      <textarea readOnly value={notifyMessages.get(e.userId) || ''} className="neu-input text-xs w-full min-h-[100px] resize-none bg-transparent opacity-90" rows={5} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]">
                <button onClick={() => setStep(5)} className="neu-btn-soft"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg> 上一步：专家组确认</button>
                <div className="flex items-center gap-3">
                  {altNotified ? (
                    <span className="inline-flex items-center gap-1.5 rounded-xl bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-4 py-2 text-sm font-bold text-[var(--success)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">
                      <Check size={15} strokeWidth={2.5} />已通知
                    </span>
                  ) : (
                    <button onClick={async () => {
                      setAltNotifying(true);
                      try {
                        const tasks = altSelected.map(e => {
                          const msg = notifyMessages.get(e.userId) || '';
                          const channels = notifyChannelsByExpert.get(e.userId) || ['in_app', 'sms', 'phone'];
                          if (!msg || channels.length === 0) return null;
                          return { eid: e.userId, msg, channels };
                        }).filter((x): x is { eid: string; msg: string; channels: string[] } => x !== null);
                        if (tasks.length === 0) { toast.warning('无可用通知文案'); return; }
                        await Promise.allSettled(tasks.map(t => sendExtractionNotify({ projectId: pid, expertIds: [t.eid], channels: t.channels, message: t.msg })));
                        setAltNotified(true);
                        toast.success(`候补通知已发送（${tasks.length} 名专家）`);
                      } catch (e: any) { toast.error(e?.message || '发送失败'); }
                      setAltNotifying(false);
                    }} disabled={altNotifying} className="neu-btn-soft is-success">
                      {altNotifying ? '发送中...' : '确认并通知候补专家'}
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]">候补抽取未就绪，请返回上一步重新进入</div>
          )}
        </div>
      )}

      {/* ── 补选弹窗：抽取 → 审核 → 一键通知，闭环后写入历史 ── */}
      {reDraft && (
        <Modal open onClose={() => { if (reDraft.phase !== 'extracting' && reDraft.phase !== 'sending') closeReModal(); }} size="lg"
          title={<span className="flex items-center gap-2"><RefreshCw size={15} className="text-[var(--accent)]" />第{reDraft.roundNo}次补选</span>}
          description="补选专家抽取 · 审核 · 一键通知（默认复用步骤3通知模板）"
        >
          {reDraft.phase === 'extracting' ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <RefreshCw size={26} className="animate-spin text-[var(--accent)]" />
              <p className="text-sm font-bold text-[var(--foreground)]">{reDraft.quotas.length > 0 ? 'AI 正在抽取补选专家...' : 'AI 正在分析项目，推荐补选专业...'}</p>
            </div>
          ) : reDraft.phase === 'configuring' ? (
            <div className="space-y-4">
              <div className="rounded-xl bg-[color-mix(in_oklch,var(--accent)_4%,transparent)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
                缺 {totalSeats - (invitationData?.experts?.filter(e => e.expertRole === '正选' && e.invitationStatus === 'confirmed').length ?? 0)} 席，AI 推荐以下补选专业配额，可手动调整人数后开始抽取
              </div>
              <div className="space-y-2">
                {reDraft.quotas.map((q, qi) => (
                <div key={qi} className="flex items-center gap-2">
                  <select value={q.specialty} onChange={e => updateDraft({ quotas: reDraft.quotas.map((x, i) => i === qi ? { ...x, specialty: e.target.value } : x) })} className="neu-input text-sm flex-1">
                    <option value="">选择专业</option>
                    {[...specs].sort((a,b) => (pool.get(b)??0) - (pool.get(a)??0)).map(s => <option key={s} value={s}>{s}{pool.has(s) ? `（${pool.get(s)}人·库内）` : ''}</option>)}
                  </select>
                  <div className="flex items-center gap-1">
                    <button onClick={() => updateDraft({ quotas: reDraft.quotas.map((x, i) => i === qi ? { ...x, count: x.count > 0 ? x.count - 1 : 0 } : x) })} className="neu-btn-xs">−</button>
                    <span className="w-8 text-center text-sm font-extrabold tabular-nums text-[var(--foreground)]">{q.count}</span>
                    <button onClick={() => updateDraft({ quotas: reDraft.quotas.map((x, i) => i === qi ? { ...x, count: x.count + 1 } : x) })} className="neu-btn-xs">+</button>
                  </div>
                  <button onClick={() => updateDraft({ quotas: reDraft.quotas.filter((_, i) => i !== qi) })} className="neu-btn-xs is-danger">×</button>
                </div>
                ))}
                <button onClick={() => updateDraft({ quotas: [...reDraft.quotas, { specialty: '', count: 1 }] })} className="neu-btn-xs"><Plus size={12} />添加专业</button>
              </div>
              {reShortfallSpecs.length > 0 && (
                <div className="rounded-xl bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-3 py-2 text-xs text-[var(--warning)] flex items-center gap-2">
                  <AlertTriangle size={14} />{reShortfallSpecs.join('、')}池内可用专家不足，请调整后重试
                </div>
              )}
              <div className="flex justify-end pt-2 border-t border-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]">
                <button onClick={extractReDraft} disabled={!reDraft.quotas.some(q => q.specialty.trim() && q.count > 0)} className="neu-btn-soft is-info">
                  <Search size={14} className="inline mr-1" />开始抽取
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {reDraft.preview && (
                <div className="rounded-xl bg-[color-mix(in_oklch,var(--accent)_4%,transparent)] p-3">
                  <div className="flex items-center gap-2 mb-1">
                    {reDraft.preview.engine === 'deepseek' ? <Sparkles size={14} className="text-[var(--accent)]" /> : <ShieldCheck size={14} className="text-[var(--warning)]" />}
                    <span className="text-xs font-bold">{reDraft.preview.engine === 'deepseek' ? 'AI 评审组分析' : '规则引擎组建'}</span>
                  </div>
                  <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{reDraft.preview.analysis}</p>
                </div>
              )}

              <div className="neu-table-card p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">补选专家 · {reDraft.selected.length} 人{reDraft.confirmed ? '（已确认入库）' : '（确认后入库）'}</span>
                  {!reDraft.confirmed && <button onClick={() => { setReplaceTarget(null); setReplaceSearch(''); setShowReplaceModal(true); }} className="neu-btn-xs"><Plus size={12} />添加专家</button>}
                </div>
                {reDraft.selected.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)] text-center py-4">无补选专家</p>
                ) : reDraft.selected.map((s, i) => (
                  <div key={s.userId} className={`flex items-start gap-3 ${i > 0 ? 'border-t border-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] mt-2 pt-2' : 'mt-2'}`}>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1"><div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-bold text-[var(--foreground)]">{s.name}</span><StatusBadge tone="blue">{s.specialty}</StatusBadge>{s.evaluationLevel && <StatusBadge tone={s.evaluationLevel === 'A' ? 'green' : s.evaluationLevel === 'B' ? 'blue' : s.evaluationLevel === 'D' ? 'orange' : s.evaluationLevel === 'E' ? 'red' : 'gray'}>{s.evaluationLevel}</StatusBadge>}</div><p className="text-[11px] text-[var(--muted-foreground)] mt-0.5">{s.reason}</p></div>
                    {!reDraft.confirmed && <div className="flex items-center gap-1 shrink-0"><button onClick={() => { setReplaceTarget({ userId: s.userId, role: 'selected' }); setReplaceSearch(''); setShowReplaceModal(true); }} className="neu-btn-xs" title="替换"><Pencil size={11} /></button><button onClick={() => updateDraft({ selected: reDraft.selected.filter(x => x.userId !== s.userId) })} className="neu-btn-xs is-danger" title="移除"><X size={11} /></button></div>}
                  </div>
                ))}
              </div>

              {reDraft.confirmed && reDraft.notified && (
                <div className="rounded-xl bg-[color-mix(in_oklch,var(--success)_10%,transparent)] px-3 py-2 text-xs font-bold text-[var(--success)] flex items-center gap-2">
                  <Check size={14} />已确认入库并通知 {reDraft.expertIds.length} 名专家，专家回复可在步骤4「补选历史」查看
                </div>
              )}

              <div className="flex items-center gap-2 pt-3 border-t border-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]">
                <span className="flex-1 text-[11px] text-[var(--muted-foreground)]">{!reDraft.confirmed ? '确认后追加入库（不影响已确认专家）' : !reDraft.notified ? '通知内容默认复用步骤3模板' : '本轮补选已完成'}</span>
                <div className="flex items-center gap-2">
                  {!reDraft.confirmed ? (
                    <button onClick={confirmReDraft} disabled={confirming || reDraft.selected.length === 0} className="neu-btn-soft is-success">
                      <Check size={14} />{confirming ? '确认中...' : `确认补选专家（${reDraft.selected.length} 人）`}
                    </button>
                  ) : !reDraft.notified ? (
                    <>
                      <button onClick={() => setShowReNotifyPreview(v => !v)} className="neu-btn-soft">
                        <FileText size={14} className="inline mr-1" />通知内容
                      </button>
                      <button onClick={sendReDraftNotify} disabled={notifying} className="neu-btn-soft is-info">
                        {notifying ? <><RefreshCw size={14} className="animate-spin inline mr-1" />通知中...</> : <><Send size={14} className="inline mr-1" />一键通知</>}
                      </button>
                    </>
                  ) : (
                    <button onClick={closeReModal} className="neu-btn-soft is-success">
                      <Check size={14} />完成
                    </button>
                  )}
                </div>
              </div>
              {/* 通知内容预览（展开时显示，同步派生模板，不调 API） */}
              {showReNotifyPreview && reDraft.confirmed && !reDraft.notified && (() => {
                const tplExpert = step4Experts[0];
                const tplMsg = tplExpert ? (notifyMessages.get(tplExpert.userId) || '') : '';
                if (!tplMsg) return <div className="mt-3 text-xs text-[var(--muted-foreground)]">步骤3「确认通知」尚未生成通知内容，请先返回步骤3</div>;
                const tplName = tplExpert?.name || '';
                const nameRe = tplName ? new RegExp(tplName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : null;
                return (
                <div className="mt-3 space-y-2 max-h-[300px] overflow-y-auto">
                  {reDraft.selected.map(e => {
                    let content = tplMsg;
                    if (nameRe) content = content.replace(nameRe, e.name);
                    const eLink = rsvpLinks[e.userId];
                    if (eLink) {
                      // 把模板消息中所有 http/https 链接替换为该专家的 RSVP 链接
                      content = content.replace(/https?:\/\/\S+/g, eLink);
                      content = content.replace(/\{RSVP_LINK\}/g, eLink);
                    }
                    return (
                      <div key={e.userId} className="rounded-xl bg-[var(--surface)] p-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-[var(--foreground)]">{e.name}</span>
                          <StatusBadge tone="blue">{e.specialty}</StatusBadge>
                        </div>
                        <textarea readOnly value={content} className="neu-input text-xs w-full min-h-[80px] resize-none bg-transparent opacity-90" rows={4} />
                      </div>
                    );
                  })}
                </div>
                );
              })()}
            </div>
          )}
        </Modal>
      )}

      {replaceModal}

      {/* 抽取历史弹窗 */}
      {showHistory && (
        <Modal
          open
          onClose={() => setShowHistory(false)}
          size="lg"
          title={
            <span className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-[10px] shadow-[inset_2px_2px_5px_oklch(0.55_0.03_258/0.12),inset_-2px_-2px_5px_oklch(1_0_0/0.55)]">
                <Clock size={15} className="text-[var(--accent)]" />
              </span>
              抽取历史
            </span>
          }
          description="全部项目的专家组抽取与组建记录"
        >
          {/* 内容区 */}
          {historyLoading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm font-bold text-[var(--accent)]">
              <RefreshCw size={14} className="animate-spin" />加载中...
            </div>
          ) : !historyData || historyData.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-14">
              <FileText size={36} className="text-[var(--muted-foreground)]/40" />
              <p className="text-sm text-[var(--muted-foreground)]">暂无抽取记录</p>
              <p className="text-[11px] text-[var(--muted-foreground)]/60">确认专家抽取后将自动记录于此</p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {historyData.items.map((item: any) => {
                  const d = item.details || {};
                  const time = new Date(item.createdAt).toLocaleString('zh-CN', {
                    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                  });
                  return (
                    <div
                      key={item.id}
                      className="rounded-[14px] bg-[color-mix(in_oklch,var(--surface)_70%,transparent)] px-4 py-3
                        shadow-[inset_0_1px_0_oklch(1_0_0/0.65),1.5px_1.5px_3px_oklch(0.55_0.03_258/0.08),-1px_-1px_2.5px_oklch(1_0_0/0.8)]
                        hover:shadow-[inset_0_1px_0_oklch(1_0_0/0.75),2.5px_2.5px_5px_oklch(0.55_0.03_258/0.12),-1.5px_-1.5px_4px_oklch(1_0_0/0.88)]
                        transition-all duration-300 ease-out"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1.5">
                          {/* 第一行：项目名 + 时间 */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[13px] font-bold text-[var(--foreground)] truncate">
                              {d.projectName || '采购项目'}
                            </span>
                            <span className="text-[10px] tabular-nums text-[var(--muted-foreground)] shrink-0">
                              {time}
                            </span>
                          </div>
                          {/* 第二行：操作人 + 专家数 */}
                          <div className="flex items-center gap-3 text-[11px] text-[var(--muted-foreground)]">
                            <span className="inline-flex items-center gap-1">
                              <UserCircle size={12} className="text-[var(--muted-foreground)]/60" />
                              {item.user?.displayName || '系统'}
                            </span>
                            <span>组建专家组 {d.expertCount ?? (Array.isArray(d.experts) ? d.experts.length : 0)} 人</span>
                          </div>
                          {/* 第三行：专家名单 */}
                          {Array.isArray(d.experts) && d.experts.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {d.experts.map((ex: any, ei: number) => (
                                <span
                                  key={ei}
                                  className={`inline-flex items-center rounded-[7px] px-2 py-0.5 text-[10px] font-medium
                                    shadow-[inset_0_0.5px_0_oklch(1_0_0/0.5),0.5px_0.5px_1.5px_oklch(0.55_0.03_258/0.06)]
                                    ${ex.isLead ? 'bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent)]' : 'text-[var(--foreground)] bg-[color-mix(in_oklch,var(--surface)_50%,transparent)]'}`}
                                >
                                  {ex.name}
                                  <span className="ml-1 text-[var(--muted-foreground)]/70">{ex.major}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => item.resourceId && openRetrospect(item.resourceId)}
                          disabled={!item.resourceId}
                          className="neu-btn-xs shrink-0"
                          title={item.resourceId ? '对本次抽取做质量复盘' : '该记录缺少项目关联，无法复盘'}
                        >
                          <ClipboardList size={12} />复盘
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 分页 */}
              {historyData.total > historyData.pageSize && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--muted-foreground)] tabular-nums">
                    共 {historyData.total} 条 · 第 {historyData.page}/{Math.ceil(historyData.total / historyData.pageSize)} 页
                  </span>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => openHistory(historyPage - 1)}
                      disabled={historyPage <= 1}
                      className="neu-btn-xs"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                    </button>
                    <button
                      onClick={() => openHistory(historyPage + 1)}
                      disabled={historyPage >= Math.ceil(historyData.total / historyData.pageSize)}
                      className="neu-btn-xs"
                    >
                       <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </Modal>
      )}

      {retrospect && (
        <Modal
          open
          onClose={() => setRetrospect(null)}
          size="md"
          title={
            <span className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-[10px] shadow-[inset_2px_2px_5px_oklch(0.55_0.03_258/0.12),inset_-2px_-2px_5px_oklch(1_0_0/0.55)]">
                <ClipboardList size={15} className="text-[var(--accent)]" />
              </span>
              抽取质量复盘
            </span>
          }
          description={retrospect.data ? retrospect.data.summary.projectName : '回顾专家组构成与履职表现'}
        >
          {retrospect.loading || !retrospect.data ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm font-bold text-[var(--accent)]">
              <RefreshCw size={14} className="animate-spin" />正在生成复盘...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['专家总数', retrospect.data.summary.total],
                  ['平均进度', `${retrospect.data.summary.avgProgress}%`],
                  ['拒绝人数', retrospect.data.summary.declined],
                ] as [string, string | number][]).map(([label, value]) => (
                  <div key={label} className="rounded-[12px] bg-[color-mix(in_oklch,var(--surface)_70%,transparent)] px-3 py-2.5 shadow-[inset_0_1px_0_oklch(1_0_0/0.65),1.5px_1.5px_3px_oklch(0.55_0.03_258/0.08),-1px_-1px_2.5px_oklch(1_0_0/0.8)]">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">{label}</div>
                    <div className="text-[1.3rem] font-black tabular-nums text-[var(--foreground)]">{value}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-[12px] bg-[color-mix(in_oklch,var(--surface)_55%,transparent)] p-3.5 shadow-[inset_0_1px_0_oklch(1_0_0/0.6),1px_1px_2.5px_oklch(0.55_0.03_258/0.07),-1px_-1px_2px_oklch(1_0_0/0.75)]">
                <div className="mb-1.5 text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">复盘总结{retrospect.data.aiSummary ? '（AI）' : '（规则）'}</div>
                <p className="text-sm leading-relaxed text-[var(--foreground)]">
                  {retrospect.data.aiSummary || `本项目共组建 ${retrospect.data.summary.total} 人专家组（正选 ${retrospect.data.summary.regular}、候补 ${retrospect.data.summary.alternative}），平均完成进度 ${retrospect.data.summary.avgProgress}%。`}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {retrospect.data.experts.map((e, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-[7px] bg-[color-mix(in_oklch,var(--surface)_50%,transparent)] px-2 py-0.5 text-[10px] font-medium text-[var(--foreground)] shadow-[inset_0_0.5px_0_oklch(1_0_0/0.5),0.5px_0.5px_1.5px_oklch(0.55_0.03_258/0.06)]">
                    {e.name}
                    <span className="text-[var(--muted-foreground)]/70">{e.role}·{e.major}·进度{e.progress}%{e.latestEvalLevel ? `·${e.latestEvalLevel}级` : ''}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

export default function ExpertExtractPageWrapper() {
  return <Suspense fallback={<div className="flex min-h-[300px] items-center justify-center text-sm text-[var(--muted-foreground)]">加载抽取配置...</div>}><ExpertExtractPage /></Suspense>;
}
