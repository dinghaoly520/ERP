'use client';

import { useEffect, useState, Suspense, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { listBidProjects, previewExtraction, confirmExtraction, sendExtractionNotify, getExtractionHistory, listSpecialties, listExperts, getBidProjectDetail, generateNotification, getProjectInvitations, confirmInvitation, declineInvitation, retrospectExtraction, type BidProjectOption, type BidProjectDetail, type ExtractionPreview, type CandidatePoolItem, type ExtractionSelected, type ExpertListItem } from '@/lib/api/expert';
import { StatusBadge, Modal } from '@/components/workbench';
import { RulesPopover } from '@/components/rules-popover';
import { STAGE_LABEL } from '@water-erp/shared';
import { Sparkles, ShieldCheck, AlertTriangle, Check, X, RefreshCw, UsersRound, MessageSquare, Phone, Bell, Pencil, Plus, Clock, FileText, UserCircle, Search, Columns2, ClipboardList } from 'lucide-react';

const scoreVar = (s: number): string => (s >= 85 ? 'var(--success)' : s >= 70 ? 'var(--accent)' : s >= 55 ? 'var(--warning)' : 'var(--danger)');
interface SpecialtyQuota { specialty: string; count: number; }

type ExtractMode = 'specialty_match' | 'random' | 'merit_best' | 'manual';
type ApiExtractMode = Exclude<ExtractMode, 'manual'>;
const MODE_LABELS: Record<ExtractMode, string> = { specialty_match: '专业匹配', random: '随机抽取', merit_best: '综合择优', manual: '专家选取' };
const MODE_DESCS: Record<ExtractMode, string> = {
  specialty_match: 'AI 分析项目专业需求，按专业匹配度加权推荐',
  random: '合规池公平随机，确保专家均等中选机会',
  merit_best: '综合履职评价/偏离度/经验等多维度择优',
  manual: '直接搜索专家姓名/专业/单位，人工精确指定评审组成员',
};
// 可用于 A/B 对比的抽取模式（手动选取不参与自动抽取对比）
const COMPARE_MODES: ApiExtractMode[] = ['specialty_match', 'random', 'merit_best'];

export function ExpertExtractPage({
  hideHeader,
  defaultProjectTitle,
  autoExtractResult,
}: {
  hideHeader?: boolean;
  defaultProjectTitle?: string;
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
  const [extractMode, setExtractMode] = useState<ExtractMode>('specialty_match');
  const [quotas, setQuotas] = useState<SpecialtyQuota[]>([{ specialty: '', count: 2 }]);
  const [step, setStep] = useState(1); // 向导步骤：1=项目选择 2=抽取配置 3=审核调整 4=确认通知
  const [loading, setLoading] = useState(false); const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(''); const [preview, setPreview] = useState<ExtractionPreview | null>(null); const [done, setDone] = useState(false);
  // 对比模式
  const [compareMode, setCompareMode] = useState(false);
  const [compareMode2, setCompareMode2] = useState<ExtractMode>('merit_best');
  const [compareResult2, setCompareResult2] = useState<ExtractionPreview | null>(null);
  // 手动调整后的名单
  const [selectedExperts, setSelectedExperts] = useState<ExtractionSelected[]>([]);
  const [alternativeExperts, setAlternativeExperts] = useState<ExtractionSelected[]>([]);
  const [leadExpertId, setLeadExpertId] = useState<string | null>(null);
  // 替换弹窗
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<{ index: number; role: 'selected' | 'alternative' } | null>(null);
  const [replaceSearch, setReplaceSearch] = useState('');
  // 通知弹窗
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyChannelsByExpert, setNotifyChannelsByExpert] = useState<Map<string, string[]>>(new Map());
  const [notifyMessages, setNotifyMessages] = useState<Map<string, string>>(new Map());
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
  // 预排除专家
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
  const autoAnalyzedRef = useRef(false);
  // 会话恢复标记：本次 pid 由 sessionStorage 恢复写入时记录，[pid] effect 对该 pid 跳过一次重置
  const restoredPidRef = useRef('');
  // [pid] effect 是否已以非空 pid 真正执行过（首次挂载时状态均为初始值，无需重置）
  const pidEffectRanRef = useRef(false);
  // 搜索竞态守卫：递增 requestId，过期响应直接丢弃，避免旧结果覆盖新结果
  const manualReqIdRef = useRef(0);
  const excludeReqIdRef = useRef(0);
  const storageKey = 'expert-extract-session';

  // 步骤5：轮询专家确认状态（全部邀请达终态后停止轮询）
  useEffect(() => {
    if (step !== 5 || !pid) return;
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
    timer = setInterval(poll, 5000);
    return () => clearInterval(timer);
  }, [step, pid]);

  // 状态变更时自动保存到 sessionStorage（页面切换后恢复）
  const stateRef = useRef({ pid, extractMode, quotas, selectedExperts, alternativeExperts, leadExpertId, preview, done, confirmedExpertIds, manualExperts, openTimeDate, openTimeTime, tn, alt, error, pd });
  stateRef.current = { pid, extractMode, quotas, selectedExperts, alternativeExperts, leadExpertId, preview, done, confirmedExpertIds, manualExperts, openTimeDate, openTimeTime, tn, alt, error, pd };
  useEffect(() => {
    const save = () => {
      const s = stateRef.current;
      sessionStorage.setItem(storageKey, JSON.stringify({ ...s, notifyMessagesArr: [...notifyMessages.entries()] }));
    };
    window.addEventListener('beforeunload', save);
    return () => { save(); window.removeEventListener('beforeunload', save); };
  }, [storageKey, notifyMessages]);

  // 初始化时从 sessionStorage 恢复状态
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
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
      if (snap.confirmedExpertIds?.length) setConfirmedExpertIds(snap.confirmedExpertIds);
      if (snap.manualExperts?.length) setManualExperts(snap.manualExperts);
      if (snap.notifyMessagesArr?.length) setNotifyMessages(new Map(snap.notifyMessagesArr));
      if (snap.openTimeDate) setOpenTimeDate(snap.openTimeDate);
      if (snap.openTimeTime) setOpenTimeTime(snap.openTimeTime);
      if (snap.tn != null) setTn(snap.tn);
      if (snap.alt != null) setAlt(snap.alt);
      if (snap.error) setError(snap.error);
      if (snap.pd) setPd(snap.pd);
    } catch { sessionStorage.removeItem(storageKey); }
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
  }, [autoExtractResult]);

  useEffect(() => { listBidProjects().then(setProjects).catch(() => toast.error('加载项目列表失败')); listSpecialties().then(setSpecs).catch(() => {}); }, []);

  // 根据项目名称自动匹配招标项目，匹配成功后自动执行 AI 抽取
  useEffect(() => {
    if (!defaultProjectTitle || !projects.length || autoAnalyzedRef.current) return;
    const match = projects.find(
      p => p.name === defaultProjectTitle || p.name.includes(defaultProjectTitle) || defaultProjectTitle.includes(p.name),
    );
    if (!match) return;
    // 会话已恢复同一项目的抽取状态（名单/预览/完成态）时不再自动重抽覆盖
    if (match.id === pid && (preview || selectedExperts.length > 0 || done)) return;
    autoAnalyzedRef.current = true;
    setPid(match.id);

    // 匹配成功后自动执行：分析专业  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg> 执行抽取
    (async () => {
      try {
        // 第一步：AI 分析项目需求，获取推荐专业和人数
        const analysis = await previewExtraction({
          projectId: match.id,
          totalNeeded: 5,
          alternatives: 2,
          extractMode: 'specialty_match',
        });

        if (analysis?.requiredSpecialties?.length > 0) {
          const qs = analysis.requiredSpecialties.map(r => ({ specialty: r.specialty, count: r.count }));
          setQuotas(qs);

          const total = qs.reduce((s, q) => s + q.count, 0);
          const manualQuotas = qs.map(q => ({ specialty: q.specialty, count: q.count }));

          // 第二步：用 AI 推荐的专业配额执行正式抽取
          const result = await previewExtraction({
            projectId: match.id,
            totalNeeded: Math.max(total, 1),
            alternatives: 2,
            extractMode: 'specialty_match',
            manualQuotas,
          });

          if (result?.selected) {
            setPreview(result);
            setSelectedExperts([...result.selected]);
            setAlternativeExperts([...result.alternatives]);
            const defMsg = `您已被选为「${defaultProjectTitle}」评审专家，请于24小时内回复是否确认参加，逾期视为放弃。`;
            setNotifyMessages(new Map(result.selected.map((s: any) => [s.userId, defMsg])));
          }
        }
      } catch (e: any) {
        // 按 code 给针对性提示（后端结构化错误），避免笼统"自动抽取失败"
        if (e?.code === 'NO_ELIGIBLE_EXPERTS') {
          toast.error('专家库暂无可用候选人，请先在专家管理维护可用专家');
        } else {
          toast.error('自动抽取失败，请手动配置抽取参数');
        }
      }
    })();
  }, [defaultProjectTitle, projects]);

  useEffect(() => {
    if (!pid) { setPd(null); return; }
    getBidProjectDetail(pid).then(setPd).catch(() => setPd(null));
    const firstRealRun = !pidEffectRanRef.current;
    pidEffectRanRef.current = true;
    // 跳过重置的两种情形：
    // 1) 首次以非空 pid 执行（挂载时各状态均为初始值，无内容可清）；
    // 2) 该 pid 来自 sessionStorage 恢复——必须保留刚恢复的名单/预览/完成态，否则恢复等于无效
    if (firstRealRun || restoredPidRef.current === pid) { restoredPidRef.current = ''; return; }
    // 切换项目后清空已选专家和抽取结果，避免跨项目混淆
    setSelectedExperts([]);
    setAlternativeExperts([]);
    setManualExperts([]);
    setLeadExpertId(null);
    setPreview(null);
    setDone(false);
    setError('');
  }, [pid]);
  useEffect(() => { if (!pid || specs.length === 0) return; Promise.all(specs.map(s => listExperts({ specialty: s }).then(l => ({ s, c: Array.isArray(l) ? l.length : 0 })))).then(rs => { const m = new Map<string, number>(); rs.forEach(({ s, c }) => { if (c > 0) m.set(s, c); }); setPool(m); }).catch(() => {}); }, [pid, specs]);

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

  // 预排除：搜索专家（防抖 300ms）
  useEffect(() => {
    if (!excludeSearch.trim()) { setExcludeResults([]); return; }
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
  }, [excludeSearch]);

  const toggleExcludeExpert = (e: ExpertListItem) => {
    if (excludedExpertIds.includes(e.id)) {
      setExcludedExpertIds(prev => prev.filter(id => id !== e.id));
      setExcludedExpertMap(prev => { const m = new Map(prev); m.delete(e.id); return m; });
    } else {
      setExcludedExpertIds(prev => [...prev, e.id]);
      setExcludedExpertMap(prev => new Map(prev).set(e.id, { name: e.displayName, specialty: e.expertProfile?.specialty ?? '' }));
    }
  };

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

  const sel = useMemo(() => projects.find(p => p.id === pid), [projects, pid]);
  const addQ = () => setQuotas(p => [...p, { specialty: '', count: 1 }]);
  const rmQ = (i: number) => { if (quotas.length <= 1) return; setQuotas(p => p.filter((_, x) => x !== i)); };
  const upQ = (i: number, f: keyof SpecialtyQuota, v: string | number) => setQuotas(p => p.map((q, x) => x === i ? { ...q, [f]: v } : q));
  const qt = quotas.reduce((s, q) => s + (q.specialty ? q.count : 0), 0);
  const qp = extractMode === 'specialty_match' ? quotas.filter(q => q.specialty.trim()).map(q => ({ specialty: q.specialty, count: q.count })) : undefined;
  const et = extractMode === 'specialty_match' ? Math.max(qt, 1) : tn;

  // 候选池去重（排除已在正选/候补名单中的）
  const availablePool = useMemo(() => {
    if (!preview?.candidatePool) return [];
    const used = new Set([...selectedExperts.map(e => e.userId), ...alternativeExperts.map(e => e.userId)]);
    return preview.candidatePool.filter(c => !used.has(c.userId));
  }, [preview, selectedExperts, alternativeExperts]);

  const filteredPool = useMemo(() =>
    availablePool.filter(c =>
      !replaceSearch.trim() ||
      c.name.includes(replaceSearch.trim()) ||
      c.specialty.includes(replaceSearch.trim())
    ),
  [availablePool, replaceSearch]);

  const run = async () => {
    if (!pid) { setError('请选择采购项目'); return; }
    if (extractMode === 'specialty_match' && !quotas.some(q => q.specialty.trim())) { setError('请至少配置一个专业配额'); return; }
    setError(''); setLoading(true); setPreview(null); setDone(false); setLeadExpertId(null);
    toast.loading('AI 正在分析项目需求并抽取专家组...', { id: 'extract-loading' });
    setCompareResult2(null);
    const apiMode: ApiExtractMode = extractMode as ApiExtractMode; // safe: run() only called for non-manual modes
    const compareModeApi: ApiExtractMode = compareMode2 as ApiExtractMode;
    try {
      if (compareMode) {
        const [result1, result2] = await Promise.all([
          previewExtraction({ projectId: pid, totalNeeded: et, alternatives: alt, extractMode: apiMode, manualQuotas: qp, excludedUserIds: excludedExpertIds.length ? excludedExpertIds : undefined }),
          previewExtraction({ projectId: pid, totalNeeded: et, alternatives: alt, extractMode: compareModeApi, manualQuotas: qp, excludedUserIds: excludedExpertIds.length ? excludedExpertIds : undefined }),
        ]);
        if (!result1?.selected) throw new Error('方案 A 返回数据异常');
        if (!result2?.selected) throw new Error('方案 B 返回数据异常');
        setPreview(result1);
        setCompareResult2(result2);
        setSelectedExperts([...result1.selected]);
        setAlternativeExperts([...result1.alternatives]);
        setStep(3);
      } else {
        const result = await previewExtraction({ projectId: pid, totalNeeded: et, alternatives: alt, extractMode: apiMode, manualQuotas: qp, excludedUserIds: excludedExpertIds.length ? excludedExpertIds : undefined });
        if (!result?.selected) throw new Error('服务器返回数据异常');
        setPreview(result);
        setSelectedExperts([...result.selected]);
        setAlternativeExperts([...result.alternatives]);
      }
      setStep(3); // 自动跳转到审核步骤
      toast.dismiss('extract-loading');
    } catch (e: any) {
      toast.dismiss('extract-loading');
      setError(e?.message || '抽取失败');
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!pid || selectedExperts.length === 0) return;
    if (!leadExpertId) { setError('请指定一位专家担任评审组长'); return; }
    setConfirming(true);
    try {
      const exps = selectedExperts.map(s => ({ userId: s.userId, expertName: s.name, major: s.specialty, isLead: s.userId === leadExpertId }));
      const candidates = alternativeExperts.map(s => ({ userId: s.userId, expertName: s.name, major: s.specialty }));
      const result = await confirmExtraction({ projectId: pid, experts: exps, candidates });
      setConfirmedExpertIds(result.expertIds || exps.map(e => e.userId));

      if (pd?.openTime) {
        const d = new Date(pd.openTime);
        setOpenTimeDate(d.toISOString().slice(0, 10));
        setOpenTimeTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
      }

      setNotifyMessages(new Map());
      setNotifyActiveExpert(exps[0]?.userId || '');
      setNotifyExpertList(selectedExperts);
      setStep(4);
      setShowNotifyModal(true);
    } catch (e: any) { toast.error(e?.message || '确认失败'); }
    setConfirming(false);
  };

  // O4：仅确认专家组入库、暂不发通知——支持"先组队、延后通知"。
  // 落库后直接进完成态（step4 done），可从完成页"发送通知"按钮重新打开通知弹窗补发。
  const confirmOnly = async () => {
    if (!pid || selectedExperts.length === 0) return;
    if (!leadExpertId) { setError('请指定一位专家担任评审组长'); return; }
    setConfirming(true); setError('');
    try {
      const exps = selectedExperts.map(s => ({ userId: s.userId, expertName: s.name, major: s.specialty, isLead: s.userId === leadExpertId }));
      const candidates = alternativeExperts.map(s => ({ userId: s.userId, expertName: s.name, major: s.specialty }));
      const result = await confirmExtraction({ projectId: pid, experts: exps, candidates });
      setConfirmedExpertIds(result.expertIds || exps.map(e => e.userId));
      setNotifyExpertList(selectedExperts);
      setNotifyMessages(new Map());
      setDone(true);
      setStep(4);
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
      setStep(5);
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

  // 手动调整
  const removeExpert = (index: number, role: 'selected' | 'alternative') => {
    if (role === 'selected') setSelectedExperts(prev => prev.filter((_, i) => i !== index));
    else setAlternativeExperts(prev => prev.filter((_, i) => i !== index));
  };
  const openReplace = (index: number, role: 'selected' | 'alternative') => {
    setReplaceTarget({ index, role });
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
    if (replaceTarget.role === 'selected') {
      setSelectedExperts(prev => prev.map((e, i) => i === replaceTarget.index ? newExpert : e));
    } else {
      setAlternativeExperts(prev => prev.map((e, i) => i === replaceTarget.index ? newExpert : e));
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
    setSelectedExperts(prev => [...prev, newExpert]);
    setShowReplaceModal(false);
    setReplaceTarget(null);
  };
  const reset = () => { setStep(1); setDone(false); setPreview(null); setSelectedExperts([]); setAlternativeExperts([]); setShowNotifyModal(false); setNotifyResults(null); setConfirmedExpertIds([]); sessionStorage.removeItem(storageKey); };

  // ── 配置卡片 ──
  // ── 替换/添加弹窗 ──
  // 被替换的原专家信息
  const replacedExpert = useMemo(() => {
    if (!replaceTarget) return null;
    const list = replaceTarget.role === 'selected' ? selectedExperts : alternativeExperts;
    return list[replaceTarget.index] || null;
  }, [replaceTarget, selectedExperts, alternativeExperts]);

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
            <span className="font-bold ml-auto" style={{ color: scoreVar(replacedExpert.matchScore) }}>匹配度 {replacedExpert.matchScore}</span>
          </div>
          <p className="text-[11px] text-[var(--muted-foreground)] mt-1">{replacedExpert.reason}</p>
        </div>
      )}
      <input value={replaceSearch} onChange={e => setReplaceSearch(e.target.value)} placeholder="搜索候选专家姓名/专业..." className="neu-input text-sm w-full" autoFocus />
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {filteredPool.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)] text-center py-8">暂无可用候选专家</p>
        ) : (
          filteredPool.map(c => {
            const vsReplaced = replacedExpert ? c.matchScore - (replacedExpert.matchScore || 0) : 0;
            return (
              <div key={c.userId} className="flex items-center justify-between rounded-lg bg-[var(--surface)] px-3 py-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[var(--foreground)] truncate">{c.name}</span>
                    {c.evaluationLevel && <StatusBadge tone={c.evaluationLevel === 'A' ? 'green' : c.evaluationLevel === 'B' ? 'blue' : c.evaluationLevel === 'D' ? 'red' : 'gray'}>{c.evaluationLevel}</StatusBadge>}
                    {c.currentLoadStatus && <span className="text-[10px] text-[var(--muted-foreground)]">{c.currentLoadStatus}</span>}
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)] truncate">{c.specialty}{c.title ? ` · ${c.title}` : ''}</div>
                </div>
                <div className="flex items-center gap-2 ml-3">
                  <span className="text-xs font-bold tabular-nums" style={{ color: scoreVar(c.matchScore) }}>{c.matchScore}</span>
                  {replacedExpert && (
                    <span className={`text-[10px] font-bold tabular-nums ${vsReplaced >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                      {vsReplaced >= 0 ? '+' : ''}{vsReplaced}
                    </span>
                  )}
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
  const notifyModal = showNotifyModal && !notifyResults && (
    <Modal
      open
      onClose={() => setShowNotifyModal(false)}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <span className="neu-icon-well flex h-8 w-8 items-center justify-center rounded-[10px]"><Bell size={14} className="text-[var(--accent)]" /></span>
          通知专家组成员
        </span>
      }
      description={(() => {
        const names = notifyExpertList.filter(s => confirmedExpertIds.includes(s.userId)).map(e => e.name).join('、');
        return names || `${confirmedExpertIds.length} 名专家`;
      })()}
      footer={
        <>
          <button onClick={sendNotify} disabled={notifying} className="neu-btn-soft is-success flex-1 justify-center">
            {notifying ? '发送中...' : '发送通知并邀请确认'}
          </button>
        </>
      }
    >
      {/* 开标时间（全局设置，影响所有专家通知中的时间占位） */}
      <div>
        <span className="text-xs font-semibold text-[var(--muted-foreground)] block mb-1.5">
          开标时间 <span className="text-[var(--danger)]">*</span>
        </span>
        <div className="flex gap-3">
          <div className="flex-1">
            <span className="text-[10px] font-semibold text-[var(--muted-foreground)] block mb-0.5">日期</span>
            <input type="date" value={openTimeDate} onChange={e => setOpenTimeDate(e.target.value)} className="neu-input text-sm w-full" />
          </div>
          <div className="w-[120px]">
            <span className="text-[10px] font-semibold text-[var(--muted-foreground)] block mb-0.5">时间</span>
            <input type="time" value={openTimeTime} onChange={e => setOpenTimeTime(e.target.value)} className="neu-input text-sm w-full" />
          </div>
        </div>
        {openTimeFormatted && <p className="text-[10px] text-[var(--accent)]/70 mt-1">已设置：{openTimeFormatted}</p>}
      </div>

      {/* 待通知专家名单（按标签页切换查看个性化内容与渠道） */}
      <div>
        <span className="text-xs font-semibold text-[var(--muted-foreground)] block mb-2">
          待通知专家 · {confirmedExpertIds.length} 人（点击切换查看个性化通知与渠道设置）
        </span>
        <div className="flex flex-wrap gap-1.5">
          {notifyExpertList.filter(s => confirmedExpertIds.includes(s.userId)).map(e => (
            <button
              key={e.userId}
              onClick={() => setNotifyActiveExpert(e.userId)}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold shadow-[inset_0_1px_0_oklch(1_0_0/0.5)] transition-colors ${e.userId === notifyActiveExpert ? 'bg-[var(--accent)] text-white' : e.userId === leadExpertId ? 'bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent)]' : 'bg-[var(--surface)] text-[var(--foreground)] hover:bg-[color-mix(in_oklch,var(--accent)_6%,transparent)]'}`}
            >
              {e.userId === leadExpertId && <span className="text-[11px]">👑</span>}
              {e.name}
            </button>
          ))}
        </div>
      </div>

      {/* 当前选中专家的通知渠道 */}
      <div>
        <span className="text-xs font-semibold text-[var(--muted-foreground)] block mb-2">
          {notifyExpertList.find(e => e.userId === notifyActiveExpert)?.name || '专家'} 的通知渠道
        </span>
        <div className="flex gap-2">
          {[
            { key: 'in_app', icon: Bell, label: 'OA站内信' },
            { key: 'sms', icon: MessageSquare, label: '短信通知' },
            { key: 'phone', icon: Phone, label: '电话通知' },
          ].map(ch => (
            <button
              key={ch.key}
              onClick={() => toggleChannelForExpert(notifyActiveExpert, ch.key)}
              className={`neu-tab flex-col gap-1 py-2 flex-1 ${getChannelsForExpert(notifyActiveExpert).includes(ch.key) ? 'is-active' : ''}`}
            >
              <ch.icon size={16} />
              <span className="text-[11px]">{ch.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 消息模板（每位专家独立内容） */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-[var(--muted-foreground)]">
            通知内容 · {notifyExpertList.filter(s => confirmedExpertIds.includes(s.userId)).find(e => e.userId === notifyActiveExpert)?.name || ''}
          </span>
            <button
              onClick={async () => {
                const projectName = sel?.name || '采购项目';
                const experts = notifyExpertList.filter(s => confirmedExpertIds.includes(s.userId));
                const totalExperts = experts.length;
                toast.loading(`AI 正在生成通知…`, { id: 'notif-ai-all' });
                try {
                  const res = await generateNotification({
                    projectName, expertName: '[[专家姓名]]',
                    isLead: false,
                    totalExperts, extractMode: MODE_LABELS[extractMode], openTime: openTimeFormatted,
                  });
                  if (!res.generated || !res.content) {
                    toast.error('生成失败', { id: 'notif-ai-all' });
                    return;
                  }
                  const template = res.content;
                  const newMessages = new Map(notifyMessages);
                  for (const expert of experts) {
                    const role = expert.userId === leadExpertId ? '评审组长' : '评审专家组成员';
                    const personalized = template
                      .replace(/\[\[专家姓名\]\]/g, expert.name)
                      .replace(/评审专家组成员/g, role);
                    newMessages.set(expert.userId, personalized);
                  }
                  setNotifyMessages(newMessages);
                  toast.success(`已为 ${totalExperts} 位专家生成通知`, { id: 'notif-ai-all' });
                } catch {
                  toast.error('生成失败', { id: 'notif-ai-all' });
                }
              }}
              className="neu-btn-xs"
            >
              <Sparkles size={11} />AI 生成
            </button>
        </div>
        {!notifyMessages.get(notifyActiveExpert) && (
          <div className="rounded-xl bg-[color-mix(in_oklch,var(--warning)_6%,transparent)] px-3 py-2 text-[11px] text-[var(--warning)]">
            该专家尚未生成通知内容，请点击上方"AI 生成"按钮
          </div>
        )}
        <textarea
          value={(() => {
            const content = notifyMessages.get(notifyActiveExpert) || '';
            return openTimeFormatted ? content.replace('____年__月__日 __:__', openTimeFormatted) : content;
          })()}
          onChange={e => setNotifyMessages(prev => new Map(prev).set(notifyActiveExpert, e.target.value))}
          placeholder="点击上方 AI 生成按钮自动填充该专家的通知内容"
          className="neu-input text-sm w-full min-h-[260px] resize-y"
          rows={14}
        />
      </div>
    </Modal>
  );

  return (
    <div className="flex flex-col gap-5">
      {!hideHeader && (
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><UsersRound size={17} /></div>
            <div><div className="page-hero__title">专家智能抽取</div><div className="page-hero__sub">专业匹配 / 随机抽取 / 综合择优，AI 分析项目需求并智能组建专家组</div></div>
          </div>
          <div className="page-hero__right">
            <button onClick={() => openHistory()} className="neu-btn-soft gap-1.5">
              <Clock size={15} />抽取历史
            </button>
            <RulesPopover>
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)] mb-3">专家抽取规则</h3>
              <ol className="space-y-2 text-xs text-[var(--muted-foreground)] leading-relaxed">
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">1.</span>合规过滤：仅「可用」状态专家，工作单位与供应商无关联，未被重复分配至同一项目，自动回避利益相关方</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">2.</span>三种抽取模式：专业匹配（AI分析专业构成+加权随机）、随机抽取（合规池公平随机）、综合择优（多维履职数据排名择优）</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">3.</span>多维评估：AI 综合专家履职评价等级(A/B/C/D)、出勤/质量/廉洁三维度评分、评分偏离度、历史经验与当前负荷</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">4.</span>手动调整：抽取后可替换/移除/添加专家，灵活组建最终专家组</li>
                <li className="flex gap-2"><span className="flex-shrink-0 font-extrabold text-[var(--accent)]">5.</span>通知送达：确认后支持 OA站内信 / 短信 / 电话 多渠道通知被选专家</li>
              </ol>
            </RulesPopover>
          </div>
        </div>
      </div>
      )}

      {/* ══ 向导步骤指示器 ══ */}
      <div className="neu-table-card p-0">
        <div className="flex">
          {[
            { num: 1, label: '选择项目', desc: '选定采购项目并查看信息' },
            { num: 2, label: '配置抽取', desc: '选择抽取模式、专业配额与预排除' },
            { num: 3, label: '审核调整', desc: '查看 AI 推荐结果，手动调整专家组' },
            { num: 4, label: '确认通知', desc: '确定组长、发送通知给专家' },
            { num: 5, label: '专家确认', desc: '查看专家回复，自动递补候补' },
          ].map((s) => (
            <button
              key={s.num}
              onClick={() => { if (s.num <= step || (s.num === 3 && preview)) setStep(s.num); }}
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

      {error && <div className="rounded-xl bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">{error}</div>}

      {/* ── 步骤 1：选择项目 + 预排除 ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="neu-table-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-extrabold text-white">1</span>
              <span className="text-sm font-bold text-[var(--foreground)]">选择采购项目</span>
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--muted-foreground)] block mb-1.5">采购项目 *</label>
              {defaultProjectTitle ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-[var(--foreground)] truncate">{defaultProjectTitle}</span>
                  {sel && <span className="text-[11px] text-[var(--muted-foreground)]">（{sel.projectCode}）</span>}
                </div>
              ) : projects.length === 0 ? (
                <div className="neu-input text-sm w-full flex items-center justify-center py-3 text-[var(--muted-foreground)]">暂无采购项目，请先在开评标管理端创建</div>
              ) : (
                <select value={pid} onChange={e => setPid(e.target.value)} className="neu-input text-sm max-w-[600px]"><option value="">请选择需要组建评审组的项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}（{p.projectCode}）</option>)}</select>
              )}
            </div>
            {sel && pd && (
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-lg bg-[var(--surface)] px-2 py-1 text-[var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">采购方式：{sel.procurementMethod}</span>
                <span className="rounded-lg bg-[var(--surface)] px-2 py-1 text-[var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">阶段：{STAGE_LABEL[sel.stage] || sel.stage}</span>
                {pd.suppliers?.length > 0 && <span className="w-full rounded-lg bg-[color-mix(in_oklch,var(--warning)_8%,transparent)] px-3 py-2 text-xs text-[var(--warning)]">参与供应商（将自动回避）：{pd.suppliers.map(s => s.supplierName).join('、')}</span>}
                {pd.experts?.length > 0 && <span className="w-full rounded-lg bg-[color-mix(in_oklch,var(--success)_8%,transparent)] px-3 py-2 text-xs text-[var(--success)]">已分配专家：{pd.experts.map(e => `${e.expertName}（${e.major}）`).join('、')}</span>}
              </div>
            )}
          </div>

          <div className="neu-table-card p-5 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-[var(--muted-foreground)]">预排除专家（可选）{excludedExpertIds.length > 0 && ` · 已排除 ${excludedExpertIds.length} 人`}</span>
              {excludedExpertIds.length > 0 && (
                <button onClick={() => { setExcludedExpertIds([]); setExcludedExpertMap(new Map()); }} className="text-[10px] text-[var(--danger)] hover:text-[var(--danger)]">全部清除</button>
              )}
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" />
              <input value={excludeSearch} onChange={e => setExcludeSearch(e.target.value)} placeholder="搜索要排除的专家姓名/专业/单位..." className="neu-input !pl-9 text-sm" />
            </div>
            {excludeSearch.trim() && (
              <div className="max-h-[160px] overflow-y-auto space-y-1 rounded-xl bg-[var(--surface)] p-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                {excludeSearching ? <p className="text-xs text-[var(--muted-foreground)] text-center py-3">搜索中...</p>
                : excludeResults.length === 0 ? <p className="text-xs text-[var(--muted-foreground)] text-center py-3">未匹配到专家</p>
                : excludeResults.filter(e => !excludedExpertIds.includes(e.id)).slice(0, 10).map(e => (
                  <div key={e.id} className="flex items-center justify-between rounded-lg px-2.5 py-1.5">
                    <div className="min-w-0 flex-1"><span className="text-sm font-bold text-[var(--foreground)]">{e.displayName}</span>{e.expertProfile?.specialty && <span className="ml-2 text-xs text-[var(--muted-foreground)]">{e.expertProfile.specialty}</span>}</div>
                    <button onClick={() => toggleExcludeExpert(e)} className="neu-btn-xs is-warning shrink-0 ml-2">排除</button>
                  </div>
                ))}
              </div>
            )}
            {excludedExpertIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {excludedExpertIds.map(id => { const info = excludedExpertMap.get(id); if (!info) return null; return (
                  <span key={id} className="inline-flex items-center gap-1 rounded-lg bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-2.5 py-1 text-xs font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]">{info.name}<span className="text-[var(--muted-foreground)]">{info.specialty}</span><button onClick={() => { setExcludedExpertIds(prev => prev.filter(x => x !== id)); setExcludedExpertMap(prev => { const m = new Map(prev); m.delete(id); return m; }); }} className="ml-0.5"><X size={11} /></button></span>
                );})}
              </div>
            )}
          </div>

          <div className="flex justify-end pr-4">
            <button onClick={() => { if (!pid) { setError('请先选择采购项目'); return; } setError(''); setStep(2); }} disabled={!pid} className="neu-btn-soft is-info"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg> 下一步：配置抽取</button>
          </div>
        </div>
      )}

      {/* ── 步骤 2：抽取配置 ── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="neu-table-card p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-extrabold text-white">2</span>
              <div><span className="text-sm font-bold text-[var(--foreground)]">抽取配置</span><span className="ml-2 text-xs text-[var(--muted-foreground)]">{MODE_LABELS[extractMode]} · {et}人</span></div>
            </div>

            {/* 项目摘要 */}
            {sel && <div className="text-xs text-[var(--muted-foreground)] rounded-lg bg-[var(--surface)] px-3 py-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]"><strong className="text-[var(--foreground)]">{sel.name}</strong>（{sel.projectCode}）· {sel.procurementMethod} · {STAGE_LABEL[sel.stage] || sel.stage}</div>}

            {/* 抽取模式 */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(Object.entries(MODE_LABELS) as [ExtractMode, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => {
                    setExtractMode(key);
                    // 避免方案 A/B 抽中同一模式导致对比无意义
                    if (key === compareMode2) setCompareMode2(COMPARE_MODES.find(m => m !== key) ?? compareMode2);
                  }}
                  className={`neu-tab flex-col gap-0.5 py-2.5 ${extractMode === key ? 'is-active' : ''}`}
                >
                  <span className="text-xs font-bold">{label}</span>
                  <span className="text-[10px] text-[var(--muted-foreground)] leading-tight">{MODE_DESCS[key]}</span>
                </button>
              ))}
            </div>

            {/* 对比模式（A/B）：并行执行两种抽取方案，抽取后在审核步择优采用 */}
            {extractMode !== 'manual' && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface)] px-3 py-2.5 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--foreground)]">
                    <Columns2 size={13} className="shrink-0 text-[var(--accent)]" />对比模式（A/B）
                    {compareMode && <StatusBadge tone="blue">已开启</StatusBadge>}
                  </div>
                  <p className="mt-0.5 text-[10px] leading-tight text-[var(--muted-foreground)]">
                    {compareMode
                      ? `抽取时并行执行「${MODE_LABELS[extractMode]}（A）」与「${MODE_LABELS[compareMode2]}（B）」，完成后对比择优采用`
                      : '同时执行两种抽取方案，对比正选/候补构成与平均匹配度后择优采用'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {compareMode && (
                    <label className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--muted-foreground)]">
                      方案 B
                      <select value={compareMode2} onChange={e => setCompareMode2(e.target.value as ExtractMode)} className="neu-input !h-8 !w-auto text-xs">
                        {COMPARE_MODES.filter(m => m !== extractMode).map(m => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
                      </select>
                    </label>
                  )}
                  <button
                    onClick={() => { const next = !compareMode; setCompareMode(next); if (!next) setCompareResult2(null); }}
                    className={`neu-btn-xs ${compareMode ? 'is-active' : ''}`}
                    title={compareMode ? '关闭对比模式' : '开启后开始抽取将同时生成 A/B 两个方案'}
                  >
                    {compareMode ? '关闭对比' : '开启对比'}
                  </button>
                </div>
              </div>
            )}

            {/* 专业配额 */}
            {extractMode === 'specialty_match' && (
              <div>
                <div className="flex items-center justify-between mb-3"><span className="text-xs font-semibold text-[var(--muted-foreground)]">专业配额（正选合计 {qt} 人）</span><button onClick={addQ} className="neu-btn-xs"><Plus size={12} />添加专业</button></div>
                {quotas.map((q, i) => (
                  <div key={i} className="flex items-center gap-2 mb-2">
                    <select value={q.specialty} onChange={e => upQ(i, 'specialty', e.target.value)} className="neu-input text-sm flex-1"><option value="">选择专业</option>{specs.map(s => <option key={s} value={s}>{s}{pool.has(s) ? `（${pool.get(s)}人·库内）` : ''}</option>)}</select>
                    <div className="flex items-center gap-1"><button onClick={() => upQ(i, 'count', Math.max(1, q.count - 1))} className="neu-btn-xs">−</button><span className="w-6 text-center text-sm font-extrabold tabular-nums text-[var(--foreground)]">{q.count}</span><button onClick={() => upQ(i, 'count', q.count + 1)} className="neu-btn-xs">+</button></div>
                    <button onClick={() => rmQ(i)} disabled={quotas.length <= 1} className="neu-btn-xs is-danger">×</button>
                  </div>
                ))}
                <p className="text-[10px] text-[var(--muted-foreground)]/70 mt-1">「库内」= 专家库该专业总人数；实际可抽取数受合规过滤影响（回避供应商关联、已分配同项目、占用/停用）。</p>
              </div>
            )}

            {/* 专家选取：搜索+选中 */}
            {extractMode === 'manual' && (
              <div className="space-y-3">
                <div className="rounded-xl bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] px-3 py-2 text-[11px] leading-relaxed text-[var(--muted-foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                  专家选取为自由指定模式，建议覆盖项目主要专业领域，避免专业失衡。{manualExperts.length > 0 && (() => { const specs = Array.from(new Set(manualExperts.map(e => e.specialty).filter(Boolean))); return <> 当前已选 <strong className="text-[var(--foreground)]">{manualExperts.length}</strong> 人{specs.length ? <>，涉及专业：<strong className="text-[var(--foreground)]">{specs.join('、')}</strong></> : ''}</>; })()}
                </div>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)] z-10" />
                  <input value={manualSearch} onChange={e => setManualSearch(e.target.value)} placeholder="搜索姓名、专业或单位..." className="neu-input !pl-9 text-sm" />
                </div>
                {manualSearch.trim() && (
                  <div className="max-h-[220px] overflow-y-auto space-y-1 rounded-xl bg-[var(--surface)] p-2 shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]">
                    {manualSearching ? <p className="text-xs text-[var(--muted-foreground)] text-center py-4"><RefreshCw size={12} className="animate-spin inline mr-1" />搜索中...</p>
                    : manualResults.length === 0 ? <p className="text-xs text-[var(--muted-foreground)] text-center py-4">未匹配到专家，请更换搜索词</p>
                    : manualResults.map(e => {
                      const selected = manualExperts.some(x => x.userId === e.id);
                      return (
                        <div key={e.id} className={`flex items-center justify-between rounded-lg px-3 py-2 ${selected ? 'bg-[color-mix(in_oklch,var(--accent)_10%,transparent)]' : ''}`}>
                          <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="text-sm font-bold text-[var(--foreground)] truncate">{e.displayName}</span>{e.expertProfile?.specialty && <StatusBadge tone="blue">{e.expertProfile.specialty}</StatusBadge>}{e.isActive ? <StatusBadge tone="green">可用</StatusBadge> : <StatusBadge tone="gray">已停用</StatusBadge>}</div><div className="text-xs text-[var(--muted-foreground)] truncate mt-0.5">{e.expertProfile?.title || ''}{e.expertProfile?.employer ? ` · ${e.expertProfile.employer}` : ''}</div></div>
                          <button onClick={() => { selected ? removeManualExpert(e.id) : addManualExpert(e); }} className={`neu-btn-xs shrink-0 ml-2 ${selected ? 'is-warning' : 'is-info'}`}>{selected ? '移除' : '选取'}</button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {manualExperts.length > 0 && (
                  <div className="rounded-xl bg-[color-mix(in_oklch,var(--accent)_4%,transparent)] p-3 shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">
                    <span className="text-xs font-bold text-[var(--muted-foreground)]">已选专家组 · {manualExperts.length} 人{leadExpertId && '（已设组长）'}</span>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {manualExperts.map(e => (
                        <span key={e.userId} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold shadow-[inset_0_1px_0_oklch(1_0_0/0.5)] ${e.userId === leadExpertId ? 'bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent)]' : 'bg-[var(--surface)] text-[var(--foreground)]'}`}>
                          {e.userId === leadExpertId && <span className="text-[11px]">👑</span>}{e.name}<span className="text-[var(--muted-foreground)]">{e.specialty}</span>
                          <button onClick={() => setLeadExpertId(e.userId === leadExpertId ? null : e.userId)} className={`text-[10px] font-semibold ${e.userId === leadExpertId ? 'text-[var(--accent)]' : 'text-[var(--muted-foreground)]/50'}`}>{e.userId === leadExpertId ? '组长 ✓' : '设为组长'}</button>
                          <button onClick={() => removeManualExpert(e.userId)} className="ml-0.5 text-[var(--danger)] hover:text-[var(--danger)]"><X size={11} /></button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 人数 + 抽取按钮（手动模式不显示） */}
            {extractMode !== 'manual' && (
            <div className="flex items-end gap-3">
              <div className="flex gap-3 flex-1">
                <label className="space-y-1 text-xs font-semibold text-[var(--muted-foreground)] flex-1">候补人数<select value={alt} onChange={e => setAlt(Number(e.target.value))} className="neu-input text-sm w-full">{[0,1,2,3,5].map(n => <option key={n} value={n}>{n} 名</option>)}</select></label>
                {extractMode !== 'specialty_match' && <label className="space-y-1 text-xs font-semibold text-[var(--muted-foreground)] flex-1">正选人数<select value={tn} onChange={e => setTn(Number(e.target.value))} className="neu-input text-sm w-full">{[1,2,3,5,7,9].map(n => <option key={n} value={n}>{n} 名</option>)}</select></label>}
              </div>
              <button onClick={run} disabled={loading || !pid} className="neu-btn-soft !w-auto justify-center px-6"><Sparkles size={15} />{loading ? '抽取中...' : '开始抽取'}</button>
            </div>
            )}
          </div>
          {extractMode === 'manual' && (
            <div className="flex justify-end pt-2 pr-4">
              <button
                onClick={async () => {
                  if (!pid) { setError('请选择采购项目'); return; }
                  if (manualExperts.length === 0) { setError('请至少选择一位专家'); return; }
                  if (!leadExpertId) { setError('请指定一位专家担任评审组长'); return; }
                  setConfirming(true); setError('');
                  try {
                    const exps = manualExperts.map(s => ({ userId: s.userId, expertName: s.name, major: s.specialty, isLead: s.userId === leadExpertId }));
                    const result = await confirmExtraction({ projectId: pid, experts: exps });
                    setConfirmedExpertIds(result.expertIds || exps.map(e => e.userId));
                    if (pd?.openTime) {
                      const d = new Date(pd.openTime);
                      setOpenTimeDate(d.toISOString().slice(0, 10));
                      setOpenTimeTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
                    }
                    setNotifyMessages(new Map());
                    setNotifyActiveExpert(exps[0]?.userId || '');
                    setNotifyExpertList(manualExperts);
                    setStep(4);
                    setShowNotifyModal(true);
                  } catch (e: any) { setError(e?.message || '确认失败'); }
                  setConfirming(false);
                }}
                disabled={confirming || manualExperts.length === 0 || !leadExpertId}
                className="neu-btn-soft is-success justify-center"
              >
                <Check size={16} />{confirming ? '确认中...' : `确认选取 ${manualExperts.length} 名专家${!leadExpertId ? ' · 请指定组长' : ''}`}
              </button>
            </div>
          )}
          <div className="flex justify-between pr-4">
            <button onClick={() => setStep(1)} className="neu-btn-soft"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg> 上一步：选择项目</button>
          </div>
        </div>
      )}

      {/* ── 步骤 3：审核调整 ── */}
      {step === 3 && (
        <div className="space-y-4">
          {loading && <div className="neu-table-card py-14 text-center"><div className="inline-flex items-center gap-2 text-sm font-bold text-[var(--accent)]"><RefreshCw size={14} className="animate-spin" />AI 正在分析项目需求并抽取专家组...</div></div>}

          {preview && !loading && !done && (
              <div className="space-y-4">
                {/* AI 分析 */}
                <div className="neu-table-card p-4">
                  <div className="flex items-center gap-2 mb-3">
                    {preview.engine === 'deepseek' ? <Sparkles size={16} className="text-[var(--accent)]" /> : <ShieldCheck size={16} className="text-[var(--warning)]" />}
                    <h2 className="text-sm font-bold text-[var(--foreground)]">{preview.engine === 'deepseek' ? 'AI 评审组分析' : '规则引擎组建'}</h2>
                    <span className={`inline-flex items-center rounded-[6px] px-1.5 py-0.5 text-[10px] font-bold shadow-[inset_0_0.5px_0_oklch(1_0_0/0.5)] ${preview.engine === 'deepseek' ? 'bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent)]' : 'bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] text-[var(--warning)]'}`}>{preview.engine === 'deepseek' ? 'AI' : '规则'}</span>
                  </div>
                  <p className="text-sm text-[var(--muted-foreground)] leading-relaxed">{preview.analysis}</p>
                  {preview.requiredSpecialties.length > 0 && <div className="flex flex-wrap items-center gap-2 mt-3">{preview.requiredSpecialties.map(q => <span key={q.specialty} className="neu-tab-count">{q.specialty} × {q.count}</span>)}</div>}
                </div>

                {preview.shortages.length > 0 && <div className="rounded-xl bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] px-4 py-3 text-sm text-[var(--warning)]"><AlertTriangle size={16} className="inline mr-2" />专业候选人不足{preview.shortages.map(s => `：${s.specialty} 需${s.needed}人/仅${s.available}人`).join('')}</div>}

                {/* 对比模式结果面板 */}
                {compareMode && compareResult2 && (
                  <div className="neu-table-card p-4 space-y-3">
                    <div className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">方案对比 · {MODE_LABELS[extractMode]}（A） vs {MODE_LABELS[compareMode2]}（B）</div>
                    <div className="grid grid-cols-2 gap-3">
                      {/* 列 A */}
                      <div className="rounded-xl bg-[color-mix(in_oklch,var(--accent)_6%,transparent)] p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <StatusBadge tone="blue">方案 A</StatusBadge>
                          <span className="text-xs font-bold text-[var(--foreground)]">{MODE_LABELS[extractMode]}</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px]"><span className="text-[var(--muted-foreground)]">正选人数</span><span className="font-bold tabular-nums">{preview.selected.length}</span></div>
                          <div className="flex justify-between text-[11px]"><span className="text-[var(--muted-foreground)]">候补人数</span><span className="font-bold tabular-nums">{preview.alternatives.length}</span></div>
                          <div className="flex justify-between text-[11px]"><span className="text-[var(--muted-foreground)]">平均匹配度</span><span className="font-bold tabular-nums">{preview.selected.length > 0 ? Math.round(preview.selected.reduce((s, e) => s + e.matchScore, 0) / preview.selected.length) : 0}</span></div>
                          <div className="flex justify-between text-[11px]"><span className="text-[var(--muted-foreground)]">引擎</span><span className="font-bold">{preview.engine === 'deepseek' ? 'AI' : '规则'}</span></div>
                        </div>
                        <button onClick={() => { setCompareMode(false); setCompareResult2(null); }} className="neu-btn-xs w-full justify-center mt-3">采用方案 A</button>
                      </div>
                      {/* 列 B */}
                      <div className="rounded-xl bg-[color-mix(in_oklch,var(--warning)_6%,transparent)] p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <StatusBadge tone="orange">方案 B</StatusBadge>
                          <span className="text-xs font-bold text-[var(--foreground)]">{MODE_LABELS[compareMode2]}</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px]"><span className="text-[var(--muted-foreground)]">正选人数</span><span className="font-bold tabular-nums">{compareResult2.selected.length}</span></div>
                          <div className="flex justify-between text-[11px]"><span className="text-[var(--muted-foreground)]">候补人数</span><span className="font-bold tabular-nums">{compareResult2.alternatives.length}</span></div>
                          <div className="flex justify-between text-[11px]"><span className="text-[var(--muted-foreground)]">平均匹配度</span><span className="font-bold tabular-nums">{compareResult2.selected.length > 0 ? Math.round(compareResult2.selected.reduce((s: number, e: any) => s + e.matchScore, 0) / compareResult2.selected.length) : 0}</span></div>
                          <div className="flex justify-between text-[11px]"><span className="text-[var(--muted-foreground)]">引擎</span><span className="font-bold">{compareResult2.engine === 'deepseek' ? 'AI' : '规则'}</span></div>
                        </div>
                        <button onClick={() => { setPreview(compareResult2); setSelectedExperts([...compareResult2.selected]); setAlternativeExperts([...compareResult2.alternatives]); setExtractMode(compareMode2); setCompareMode(false); setCompareResult2(null); }} className="neu-btn-xs is-warning w-full justify-center mt-3">采用方案 B</button>
                      </div>
                    </div>
                    {/* 名单交集分析 */}
                    <div className="text-[11px] text-[var(--muted-foreground)]">
                      {(() => {
                        const idsA = new Set(preview.selected.map((e: any) => e.userId));
                        const idsB = new Set(compareResult2.selected.map((e: any) => e.userId));
                        const overlap = [...idsA].filter(id => idsB.has(id)).length;
                        return <>两方案共有 <strong className="text-[var(--foreground)]">{overlap}</strong> 名专家重叠，差异 <strong className="text-[var(--foreground)]">{idsA.size + idsB.size - overlap * 2}</strong> 名</>;
                      })()}
                    </div>
                  </div>
                )}

                {/* 正选专家组（可调整） */}
                <div className="neu-table-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">正选专家组 · {selectedExperts.length} 人</span>
                    <button onClick={() => { setReplaceTarget(null); setReplaceSearch(''); setShowReplaceModal(true); }} className="neu-btn-xs"><Plus size={12} />添加专家</button>
                  </div>
                  {selectedExperts.map((s, i) => (
                    <div key={s.userId} className={`flex items-start gap-3 mt-3 ${i > 0 ? 'border-t border-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] pt-3' : ''}`}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-extrabold text-white">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap"><span className="text-sm font-bold text-[var(--foreground)] cursor-pointer hover:text-[var(--accent)]" onClick={() => router.push('/expert/' + s.userId)}>{s.name}</span><StatusBadge tone="blue">{s.specialty}</StatusBadge><StatusBadge tone="green">正选</StatusBadge>{s.userId === leadExpertId && <StatusBadge tone="purple">组长</StatusBadge>}</div>
                        <div className="flex items-center gap-2 my-1.5"><div className="flex-1 h-2 rounded-full bg-[var(--muted)]/50 overflow-hidden max-w-[140px]"><div className="h-full rounded-full" style={{ width: `${s.matchScore}%`, backgroundColor: scoreVar(s.matchScore) }} /></div><strong className="text-xs tabular-nums" style={{ color: scoreVar(s.matchScore) }}>{s.matchScore}</strong></div>
                        <p className="text-xs text-[var(--muted-foreground)] mb-1">{s.reason}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setLeadExpertId(s.userId === leadExpertId ? null : s.userId)}
                          className={`neu-btn-xs ${s.userId === leadExpertId ? 'is-active' : ''}`}
                          title={s.userId === leadExpertId ? '取消组长' : '设为组长'}
                        >
                          {s.userId === leadExpertId ? '组长' : '设为组长'}
                        </button>
                        <button onClick={() => openReplace(i, 'selected')} className="neu-btn-xs" title="替换"><Pencil size={11} /></button>
                        <button onClick={() => removeExpert(i, 'selected')} className="neu-btn-xs is-danger" title="移除"><X size={11} /></button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* 候补专家 */}
                {alternativeExperts.length > 0 && (
                  <div className="neu-table-card p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-bold tracking-[0.06em] uppercase text-[var(--muted-foreground)]">候补专家 · {alternativeExperts.length} 人</span>
                    </div>
                    {alternativeExperts.map((s, i) => (
                      <div key={s.userId} className="flex items-center justify-between mt-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-[var(--foreground)] truncate">{s.name}</span>
                          <span className="text-[var(--muted-foreground)]">{s.specialty}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-bold tabular-nums" style={{ color: scoreVar(s.matchScore) }}>{s.matchScore}</span>
                          <button onClick={() => openReplace(i, 'alternative')} className="neu-btn-xs" title="替换"><Pencil size={10} /></button>
                          <button onClick={() => removeExpert(i, 'alternative')} className="neu-btn-xs is-danger" title="移除"><X size={10} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <button onClick={confirm} disabled={confirming || selectedExperts.length === 0 || !leadExpertId} className="neu-btn-soft is-success w-full justify-center" title={!leadExpertId ? '请先指定评审组长' : undefined}>
                  <Check size={16} />{confirming ? '确认中...' : `确认组建并通知（${selectedExperts.length} 人）`}{!leadExpertId ? ' · 请指定组长' : ''}
                </button>
                <button onClick={confirmOnly} disabled={confirming || selectedExperts.length === 0 || !leadExpertId} className="neu-btn-xs w-full justify-center mt-2" title="确认专家组入库，暂不发通知，可稍后从完成页补发">
                  仅确认专家组，稍后通知
                </button>
              </div>
            )}

            {/* 完成状态 */}
            {done && (
              <div className="neu-table-card p-10 text-center">
                <ShieldCheck size={40} className="mx-auto text-[var(--success)] mb-3" />
                <h3 className="text-lg font-bold text-[var(--foreground)] mb-1">{notifyResults ? '通知已发送，等待专家确认' : '专家组已确认'}</h3>
                <p className="text-sm text-[var(--muted-foreground)]">
                  {notifyResults ? `已向「${sel?.name}」的 ${selectedExperts.length} 名专家发出邀请通知，专家确认后即正式加入评审组` : `「${sel?.name}」的专家组（${selectedExperts.length} 人）已确认入库，尚未发送通知`}
                </p>
                {notifyResults && (
                  <div className="mt-4 text-left max-w-md mx-auto space-y-1">
                    <span className="text-xs font-semibold text-[var(--muted-foreground)]">通知投递与确认状态</span>
                    {notifyResults.map((r: any) => {
                      const expert = selectedExperts.find(e => e.userId === r.userId);
                      return (
                        <div key={r.userId} className="text-xs flex items-center gap-2 py-0.5 border-b border-[var(--muted)]/10 last:border-0">
                          <span className="font-medium text-[var(--foreground)] min-w-[60px]">{expert?.name || r.userId}</span>
                          {Object.entries(r.results).map(([ch, status]) => (
                            <span key={ch} className={status === 'sent' ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>{ch}:{status as string}</span>
                          ))}
                          <StatusBadge tone="blue" className="ml-auto">待确认</StatusBadge>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="flex justify-center gap-3 mt-6"><button onClick={() => router.push('/expert/repository')} className="neu-btn-soft">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              返回专家库</button><button onClick={reset} className="neu-btn-soft">重新抽取</button></div>
              </div>
            )}
            <div className="flex items-center justify-between pt-4 border-t border-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]">
              <div className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-extrabold text-white">3</span>
                <span className="text-sm font-bold text-[var(--foreground)]">审核调整</span>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={() => setStep(2)} className="neu-btn-soft"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg> 返回上一步：抽取配置</button>
                <button onClick={confirm} disabled={confirming || selectedExperts.length === 0 || !leadExpertId} className="neu-btn-soft is-success" title={!leadExpertId ? '请先指定评审组长' : undefined}>
                <Check size={16} />{confirming ? '确认中...' : `确认组建专家组（${selectedExperts.length} 人）`}{!leadExpertId ? ' · 请指定组长' : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 步骤 4：发送通知 ── */}
      {step === 4 && done && (
        <div className="space-y-4">
          <div className="neu-table-card p-10 text-center">
            <ShieldCheck size={40} className="mx-auto text-[var(--success)] mb-3" />
            <h3 className="text-lg font-bold text-[var(--foreground)] mb-1">{notifyResults ? '通知已发送，等待专家确认' : '专家组已确认'}</h3>
            <p className="text-sm text-[var(--muted-foreground)]">
              已向「{sel?.name}」的 {selectedExperts.length} 名专家发出邀请通知，专家确认后即正式加入评审组
            </p>
            {notifyResults && (
              <div className="mt-4 text-left max-w-md mx-auto space-y-1">
                <span className="text-xs font-semibold text-[var(--muted-foreground)]">通知投递与确认状态</span>
                {notifyResults.map((r: any) => {
                  const expert = selectedExperts.find(e => e.userId === r.userId);
                  return (
                    <div key={r.userId} className="text-xs flex items-center gap-2 py-0.5 border-b border-[var(--muted)]/10 last:border-0">
                      <span className="font-medium text-[var(--foreground)] min-w-[60px]">{expert?.name || r.userId}</span>
                      {Object.entries(r.results).map(([ch, status]) => (
                        <span key={ch} className={status === 'sent' ? 'text-[var(--success)]' : 'text-[var(--warning)]'}>{ch}:{status as string}</span>
                      ))}
                      <StatusBadge tone="blue" className="ml-auto">待确认</StatusBadge>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex justify-center gap-3 mt-6">
              {!notifyResults && (
                <button onClick={() => setShowNotifyModal(true)} className="neu-btn-soft is-success">
                  <Bell size={14} />发送通知
                </button>
              )}
              <button onClick={() => router.push('/expert/repository')} className="neu-btn-soft">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                返回专家库
              </button>
              <button onClick={reset} className="neu-btn-soft">重新抽取</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 步骤 5：专家确认 ── */}
      {step === 5 && (
        <div className="space-y-4">
          {invitationData && (
            <>
              {/* 摘要 */}
              <div className="grid grid-cols-4 gap-3">
                <div className="kpi-card flex flex-col gap-1 p-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">已确认</span>
                  <span className="text-[1.55rem] font-black tabular-nums text-[var(--success)] leading-none">{invitationData.summary.confirmed}</span>
                </div>
                <div className="kpi-card flex flex-col gap-1 p-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">待回复</span>
                  <span className="text-[1.55rem] font-black tabular-nums text-[var(--accent)] leading-none">{invitationData.summary.pending}</span>
                </div>
                <div className="kpi-card flex flex-col gap-1 p-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">已拒绝</span>
                  <span className="text-[1.55rem] font-black tabular-nums text-[var(--danger)] leading-none">{invitationData.summary.declined}</span>
                </div>
                <div className="kpi-card flex flex-col gap-1 p-3">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">可用候补</span>
                  <span className="text-[1.55rem] font-black tabular-nums text-[var(--foreground)] leading-none">{invitationData.summary.availableCandidates}</span>
                </div>
              </div>

              {/* 全部拒绝警报 */}
              {invitationData.summary.allDeclined && (
                <div className="rounded-xl bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]">
                  <AlertTriangle size={16} className="inline mr-2" />
                  所有专家（含候补）均已拒绝或已回复，请重新进行抽取或手动选取专家
                </div>
              )}

              {/* 专家列表 */}
              <div className="neu-table-card">
                <div className="overflow-x-auto">
                  <table className="neu-table w-full min-w-[600px]">
                    <thead>
                      <tr>
                        <th>专家</th>
                        <th className="text-center">专业</th>
                        <th className="text-center">角色</th>
                        <th className="text-center">回复状态</th>
                        <th className="text-center">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invitationData.experts.map(e => (
                        <tr key={e.id}>
                          <td>
                            <div className="flex items-center gap-2">
                              {e.isLead && <span className="text-[11px]">👑</span>}
                              <span className="text-sm font-bold text-[var(--foreground)]">{e.expertName}</span>
                            </div>
                          </td>
                          <td className="text-center text-sm text-[var(--muted-foreground)]">{e.major}</td>
                          <td className="text-center"><StatusBadge tone={e.expertRole === '正选' ? 'green' : 'gray'}>{e.expertRole}</StatusBadge></td>
                          <td className="text-center">
                            {e.invitationStatus === 'confirmed' && <StatusBadge tone="green">已确认</StatusBadge>}
                            {e.invitationStatus === 'pending' && <StatusBadge tone="blue">待回复</StatusBadge>}
                            {e.invitationStatus === 'declined' && <StatusBadge tone="red">已拒绝</StatusBadge>}
                          </td>
                          <td className="text-center">
                            {e.invitationStatus === 'pending' && (
                              <div className="flex justify-center gap-1">
                                <button onClick={async () => { try { await confirmInvitation(pid, e.userId); setInvitationData(await getProjectInvitations(pid)); toast.success(`${e.expertName} 已确认`); } catch (err: any) { toast.error(err?.message || '操作失败'); } }} className="neu-btn-xs is-success">确认</button>
                                <button onClick={async () => { try { const res = await declineInvitation(pid, e.userId); setInvitationData(await getProjectInvitations(pid)); if (res.promoted) { toast.success(`${e.expertName} 已拒绝，候补 ${res.promoted.expertName} 已自动递补`); } else { toast.success(`${e.expertName} 已标记拒绝`); } } catch (err: any) { toast.error(err?.message || '操作失败'); } }} className="neu-btn-xs is-danger">拒绝</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex justify-between pr-4 pt-4 border-t border-[color-mix(in_oklch,var(--muted-foreground)_10%,transparent)]">
                <div className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-extrabold text-white">5</span>
                  <span className="text-sm font-bold text-[var(--foreground)]">专家确认</span>
                  <span className="text-xs text-[var(--muted-foreground)]">每 5 秒自动刷新</span>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep(4)} className="neu-btn-soft"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg> 返回上一步：确认通知</button>
                  <button onClick={() => router.push('/expert/repository')} className="neu-btn-soft">完成</button>
                </div>
              </div>
            </>
          )}
          {!invitationData && (
            <div className="neu-table-card py-14 text-center text-sm text-[var(--muted-foreground)]"><RefreshCw size={14} className="animate-spin inline mr-2" />加载专家确认状态...</div>
          )}
        </div>
      )}

      {replaceModal}
      {notifyModal}

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
                                  {ex.isLead && <span className="mr-0.5">👑</span>}
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
