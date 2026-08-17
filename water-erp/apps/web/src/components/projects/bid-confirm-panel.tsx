'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AbortDialog } from './bid-confirm/abort-dialog';
import { HostPickerModal } from './bid-confirm/host-picker-modal';
import {
  AlertTriangle,
  Ban,
  Bell,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Clock,
  Crown,
  FileText,
  Gavel,
  Loader2,
  RefreshCw,
  Shield,
  Sparkles,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import {
  BID_STAGE_LABELS,
  deliverAwardLetter,
  ensureBidProject,
  getAwardLetterStatus,
  getBidProjectDetail,
  getBidWorkspace,
  getPublicityStatus,
  nudgeExperts,
  nudgeSuppliers,
  notifyBidScheduleChange,
  startOpening,
  swapExpertRole,
  updateBidProjectSchedule,
  type BidProjectDetail,
  type BidProjectRef,
  type BidWorkspace,
} from '@/lib/api/bid';
import { getRsvpList, type RsvpListItem, type RsvpListResult } from '@/lib/api/supplier';
import { generateFieldContent } from '@/lib/api/tender-sample';
import { useBidWebSocket } from '@/hooks/use-bid-websocket';
import { ArchiveBlock } from './bid-confirm/archive-block';
import { OpeningProgressBlock } from './bid-confirm/opening-progress-block';
import { EvaluationHandoverBlock } from './bid-confirm/evaluation-handover-block';
import { NudgeUnsubmittedModal } from './bid-confirm/nudge-unsubmitted-modal';
import { ScoreStandardEditor } from './score-standard/score-standard-editor';
import { StatusBadge, Modal } from '@/components/workbench';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectManagementItem | null;
  round?: number;
  /** 同步确认参加/已投递的供应商+专家组到项目基本信息 */
  onSyncProjectInfo?: (info: { invitedSuppliers: string; expertInfo: string }) => void;
  /** 流标回调（开标完成后选择流标时触发，父面板打开流标公告制作） */
  onAbort?: () => void;
};

/* ── 日期工具 ── */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function BidConfirmPanel({ isOpen, onClose, project, round, onAbort, onSyncProjectInfo }: Props) {
  const [bidProject, setBidProject] = useState<BidProjectRef | null>(null);
  const [workspace, setWorkspace] = useState<BidWorkspace | null>(null);
  /** Phase 2：项目全量详情（开标进度/归档区块共用数据源；评标管理/异议裁决/澄清答疑已迁 :3007，分工 v3） */
  const [detail, setDetail] = useState<BidProjectDetail | null>(null);
  /** 供应商回执情况：supplierId → ACCEPTED / DECLINED / PENDING */
  const [rsvpMap, setRsvpMap] = useState<Map<string, string>>(new Map());
  /** 邀请回执名单（谈判采购以此为供应商名单来源，含姓名+回执状态） */
  const [rsvpItems, setRsvpItems] = useState<RsvpListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const [hostPickerOpen, setHostPickerOpen] = useState(false);

  // 延时开标
  const [delayOpen, setDelayOpen] = useState(false);
  const [delayTime, setDelayTime] = useState('');

  // 催促未投递供应商弹窗
  const [nudgeOpen, setNudgeOpen] = useState(false);

  // 延时开标后的"是否通知供应商与专家"确认
  const [notifyConfirmOpen, setNotifyConfirmOpen] = useState(false);
  const [pendingOpenTime, setPendingOpenTime] = useState('');
  // B2: 流标串联对话框
  const [abortDialogOpen, setAbortDialogOpen] = useState(false);
  // 流标按钮（底部决策栏）：仅开标前 24h 内可点击
  const [failBidDialogOpen, setFailBidDialogOpen] = useState(false);
  const [failBidReason, setFailBidReason] = useState('');
  const [failBidAiLoading, setFailBidAiLoading] = useState(false);
  const [failBidConfirming, setFailBidConfirming] = useState(false);

  // 判断是否在开标前 24h 内
  const isWithin24hOfOpening = (() => {
    if (!bidProject?.openTime) return false;
    const openTime = new Date(bidProject.openTime).getTime();
    const now = Date.now();
    const diffHours = (openTime - now) / (1000 * 60 * 60);
    return diffHours <= 24 && diffHours >= -48; // 开标前24h ~ 开标后48h
  })();
  // D1: 专家在线状态
  const [expertOnlineCount, setExpertOnlineCount] = useState(0);

  // ★ 打开流标对话框时，AI 自动分析投递/专家状态并预填流标原因
  const handleOpenFailBidDialog = useCallback(async () => {
    setFailBidDialogOpen(true);
    setFailBidReason('');
    setFailBidAiLoading(true);
    try {
      // 收集供应商投递情况
      const suppliers = workspace?.suppliers ?? [];
      const submitted = suppliers.filter(s => s.submitted);
      const notSubmitted = suppliers.filter(s => !s.submitted && !s.withdrawn);
      const withdrawn = suppliers.filter(s => s.withdrawn);
      // 收集专家回复情况（后端 BidExpert.invitationStatus：confirmed/declined/pending）
      const experts = detail?.experts ?? [];
      const expertAccepted = experts.filter(e => e.invitationStatus === 'confirmed');
      const expertDeclined = experts.filter(e => e.invitationStatus === 'declined');

      const context: Record<string, string> = {
        '项目名称': project?.title ?? '',
        '采购方式': project?.procurementMethod ?? '',
        '受邀供应商数': String(suppliers.length),
        '已投递': String(submitted.length),
        '未投递': String(notSubmitted.length),
        '已撤回': String(withdrawn.length),
        '已投递供应商': submitted.map(s => s.supplierName).join('、') || '无',
        '专家总数': String(experts.length),
        '专家已确认': String(expertAccepted.length),
        '专家已拒绝': String(expertDeclined.length),
      };

      const result = await generateFieldContent({
        fieldKey: 'failBidReason' as any,
        fieldLabel: '流标原因',
        currentValue: '',
        aiPrompt: '根据项目供应商投递情况和专家回复情况，生成流标原因说明。分析投递数量是否达到法定要求（通常需3家以上有效投标），专家是否到位等。输出一段正式的公文风格说明（50-150字），不要使用#、*等符号。',
        context,
      });
      if (result?.content) {
        setFailBidReason(result.content.replace(/�/g, '').trim());
      }
    } catch { /* AI 不可用不阻塞 */ }
    setFailBidAiLoading(false);
  }, [workspace, detail, project]);
  // 正选专家替换弹窗
  const [replaceModalOpen, setReplaceModalOpen] = useState(false);
  const [replaceModalExpert, setReplaceModalExpert] = useState<{ id: string; name: string } | null>(null);
  const onSyncRef = useRef(onSyncProjectInfo);
  onSyncRef.current = onSyncProjectInfo;

  const showToast = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => setToast({ text, tone }), []);

  // 轻量刷新 workspace（交换角色后只刷新专家数据，不 setLoading 导致页面跳顶）
  const refreshWorkspace = useCallback(async () => {
    if (!bidProject?.id) return;
    try {
      const ws = await getBidWorkspace(bidProject.id);
      setWorkspace(ws);
    } catch {}
  }, [bidProject?.id]);

  const load = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      const bp = await ensureBidProject(project.id, round);
      setBidProject(bp);
      const [ws, dt] = await Promise.all([
        getBidWorkspace(bp.id),
        getBidProjectDetail(bp.id).catch(() => null),
      ]);
      setWorkspace(ws);
      setDetail(dt);
      // 加载供应商回执情况（谈判采购：即受邀供应商名单 + 回复情况）。
      // 邀请页可能把回执行写在 PM-item id 或 BidProject id 下（取决于其当时解析到的项目），
      // 故两个 id 空间都查、按 rsvpNo 去重合并，确保名单不丢。
      let rsvpLocal = new Map<string, string>();
      try {
        const fetches: Promise<RsvpListResult>[] = [getRsvpList({ projectId: project.id })];
        if (bp.id && bp.id !== project.id) fetches.push(getRsvpList({ projectId: bp.id }).catch(() => ({ total: 0, counts: { ACCEPTED: 0, DECLINED: 0, PENDING: 0 }, items: [] } as RsvpListResult)));
        const results = await Promise.all(fetches);
        const seen = new Set<string>();
        const merged: RsvpListItem[] = [];
        for (const r of results) for (const it of r.items) if (!seen.has(it.rsvpNo)) { seen.add(it.rsvpNo); merged.push(it); }
        rsvpLocal = new Map<string, string>();
        for (const it of merged) rsvpLocal.set(it.supplierId, it.status);
        setRsvpMap(rsvpLocal);
        setRsvpItems(merged);
      } catch { /* RSVP 加载失败不阻断 */ }
      // 同步确认参加/已投递的供应商+专家组到项目基本信息
      if (onSyncRef.current && ws && project) {
        try {
          // 供应商：回执确认参加 + 已投递 → 每行一个，换行分隔（匹配 BiddingUnitsField 格式）
          const confirmedSuppliers = ws.suppliers
            .filter(s => {
              const hasRsvp = rsvpLocal.size > 0;
              const rsvpOk = hasRsvp ? rsvpLocal.get(s.supplierId ?? '') === 'ACCEPTED' : true;
              return rsvpOk && s.submitted;
            })
            .map(s => s.supplierName);
          // 专家：正选已确认 + 候补（排除已拒绝）→ 每行 姓名|部门|专业|职称（匹配 ExpertInfoField pipe 格式）
          const confirmedExperts = ws.experts
            .filter(e => e.expertRole !== '候补' && e.invitationStatus === 'confirmed')
            .map(e => `${e.expertName}|${e.user?.expertProfile?.employer || ''}|${e.major || ''}|${e.user?.expertProfile?.title || ''}|正选`);
          const alternateExperts = ws.experts
            .filter(e => e.expertRole === '候补' && e.invitationStatus !== 'declined')
            .map(e => `${e.expertName}|${e.user?.expertProfile?.employer || ''}|${e.major || ''}|${e.user?.expertProfile?.title || ''}|候补`);
          onSyncRef.current({
            invitedSuppliers: confirmedSuppliers.join('\n'),
            expertInfo: [...confirmedExperts, ...alternateExperts].join('\n'),
          });
        } catch { /* sync 失败不阻断 */ }
      }
      setDelayTime(toLocalInput(bp.openTime));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [project, round]);

  /* ── Phase 2：详情增量刷新（socket 事件驱动，防抖合并高频事件）── */
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 当前指派的开标主持人（来自 detail）；null = 未指派 */
  const assignedHost = detail?.assignedHostUser ?? null;
  /** :3007 是否已组建开标会话（= 改派锁定 R3）*/
  const openingSessionExists = !!detail?.openingSession;

  const refreshDetail = useCallback(() => {
    if (!bidProject?.id) return;
    getBidProjectDetail(bidProject.id).then(setDetail).catch(() => {});
  }, [bidProject?.id]);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => refreshDetail(), 600);
  }, [refreshDetail]);
  /* ── Phase 2：实时事件 → 阶段流转整体重载，过程事件增量刷新详情 ── */
  const { connection: wsConnection } = useBidWebSocket(isOpen ? bidProject?.id : undefined, {
    onStageChange: () => { if (isOpen) void load(); },
    onEvaluationStarted: () => { if (isOpen) void load(); },
    onDecryptStatus: scheduleRefresh,
    onOpeningConfirmed: scheduleRefresh,
    onOpeningDisputed: scheduleRefresh,
    onOpeningDisputeResolved: scheduleRefresh,
    onOpeningCompleted: () => { if (isOpen) void load(); },
    // F6：唱标录入只 emit supervision:log（无开标记录类事件），订阅它使「唱标录入」计数实时回流
    onSupervisionLog: scheduleRefresh,
    onExpertPresence: useCallback((d: any) => {
      scheduleRefresh();
      if (d?.onlineCount !== undefined) setExpertOnlineCount(d.onlineCount);
    }, [scheduleRefresh]),
    onExpertPresenceAggregate: useCallback((d: any) => {
      if (d?.onlineCount !== undefined) setExpertOnlineCount(d.onlineCount);
    }, []),
    // F13：断线重连后全量补偿刷新（断线窗口内错过的事件无法补推）
    onReconnected: () => { if (bidProject?.id) void load(); },
  });

  // G1: 30s 轮询兜底——仅 WS 断开/重连中才轮询（生产降载：WS 正常时零轮询；
  // 断线窗口由轮询续命，重连成功后 onReconnected 全量补偿并停轮询）
  useEffect(() => {
    if (!isOpen || !bidProject?.id) return;
    if (wsConnection === 'connected') return;
    const timer = setInterval(() => { refreshDetail(); }, 30_000);
    return () => clearInterval(timer);
  }, [isOpen, bidProject?.id, wsConnection, refreshDetail]);

  /* eslint-disable react-hooks/set-state-in-effect -- 弹窗打开加载 / 关闭重置，符合模态惯例 */
  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  useEffect(() => {
    if (!isOpen) {
      // F14：清理挂起的防抖刷新，避免关闭后对旧项目发一次无效请求
      if (refreshTimer.current) { clearTimeout(refreshTimer.current); refreshTimer.current = null; }
      setBidProject(null);
      setWorkspace(null);
      setDetail(null);
      setRsvpItems([]);
      setRsvpMap(new Map());
      setNudgeOpen(false);
      setError(null);
      setToast(null);
      setDelayOpen(false);
      setNotifyConfirmOpen(false);
      setPendingOpenTime('');
    }
  }, [isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const bpId = bidProject?.id;
  const stage = bidProject?.stage;
  // 开标已开始（OPENING/EVALUATING/ARCHIVED）→ 供应商和专家均锁定，不可修改
  const isOpened = stage === 'OPENING' || stage === 'EVALUATING' || stage === 'ARCHIVED';

  /* ── 操作 ── */
  async function withBusy(fn: () => Promise<void>, errMsg = '操作失败') {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      showToast(e instanceof Error ? e.message : errMsg, 'err');
    } finally {
      setBusy(false);
    }
  }

  async function handleNudgeSuppliers() {
    if (!bpId) return;
    await withBusy(async () => {
      const r = await nudgeSuppliers(bpId, true);
      showToast(`已催促 ${r.notified ?? 0} 位未投递供应商`);
    }, '催促失败');
  }

  async function handleNudgeExperts() {
    if (!bpId) return;
    await withBusy(async () => {
      const r = await nudgeExperts(bpId, 'signin');
      showToast(`已催促 ${r.notified ?? 0} 位专家确认`);
    }, '催促失败');
  }

  async function handleStartOpening() {
    if (!bpId) return;
    await withBusy(async () => {
      await startOpening(bpId);
      showToast('已确定开标，请主持人在「开标进度」区块进入开标大厅组建会话');
      await load();
    }, '开标失败');
  }

  async function handleDelaySave() {
    if (!bpId || !delayTime) return;
    const iso = new Date(delayTime).toISOString();
    await withBusy(async () => {
      const updated = await updateBidProjectSchedule(bpId, { openTime: iso });
      setBidProject(updated);
      setDelayOpen(false);
      // 弹出"是否通知供应商与专家"确认
      setPendingOpenTime(updated.openTime);
      setNotifyConfirmOpen(true);
    }, '更新开标时间失败');
  }

  async function handleConfirmNotify(notify: boolean) {
    const openTime = pendingOpenTime;
    setNotifyConfirmOpen(false);
    setPendingOpenTime('');
    if (!notify || !bpId) return;
    await withBusy(async () => {
      const r = await notifyBidScheduleChange(bpId, openTime);
      showToast(`已通知 ${r.reached ?? 0} 位供应商/专家`);
    }, '通知失败');
  }

  /* ── 渲染 ── */
  const stats = workspace?.stats;
  // 投递截止 = 开标前 12 小时（业务规则）
  const submitDeadline = bidProject
    ? new Date(new Date(bidProject.openTime).getTime() - 12 * 60 * 60 * 1000)
    : null;

  // 谈判采购没有"公告→供应商自行投递"链路，供应商以"受邀名单 + 回执"为准；
  // 其余方式（询比/邀请招标/竞价）以公告中供应商自行投递为准。
  const isNegotiation = project?.procurementMethod === '谈判采购';
  const showRsvpColumn = project?.procurementMethod === '谈判采购' || project?.procurementMethod === '直接采购';

  // 统一行模型：谈判采购以受邀名单为骨架（合并投递数据），其余以投递供应商为骨架。
  type SupplierRow = {
    key: string;
    supplierName: string;
    classification: string;
    tags: string[];
    rsvpStatus?: string;
    submitted: boolean;
    withdrawn: boolean;
    submittedAt: string | null;
    bidPrice: string | null;
  };
  const wsSuppliers = workspace?.suppliers ?? [];
  const submissionBySupplier = new Map<string, (typeof wsSuppliers)[number]>();
  for (const s of wsSuppliers) {
    if (s.supplierId) submissionBySupplier.set(s.supplierId, s);
  }
  const supplierRows: SupplierRow[] = isNegotiation
    ? rsvpItems.map((it) => {
        const sub = it.supplierId ? submissionBySupplier.get(it.supplierId) : undefined;
        return {
          key: `rsvp-${it.rsvpNo}`,
          supplierName: it.supplierName,
          classification: sub?.classification || '—',
          tags: it.tags ?? sub?.tags ?? [],
          rsvpStatus: it.status,
          submitted: !!sub?.submitted,
          withdrawn: !!sub?.withdrawn,
          submittedAt: sub?.submission?.submittedAt ?? null,
          bidPrice: sub?.submission?.bidPrice ?? null,
        };
      })
    : wsSuppliers.map((s) => ({
        key: s.id,
        supplierName: s.supplierName,
        classification: s.classification || '—',
        tags: s.tags ?? [],
        rsvpStatus: s.supplierId ? rsvpMap.get(s.supplierId) : undefined,
        submitted: s.submitted,
        withdrawn: s.withdrawn,
        submittedAt: s.submission?.submittedAt ?? null,
        bidPrice: s.submission?.bidPrice ?? null,
      }));

  return (
    <div className="fixed inset-0 z-[500] flex flex-col">
      <div
        className="absolute inset-0"
        style={{ background: 'oklch(0.975 0.012 258 / 0.72)', backdropFilter: 'blur(5px)' }}
        onClick={onClose}
      />
      <div
        className="relative z-10 mx-5 my-5 flex flex-1 flex-col overflow-hidden rounded-[28px]"
        style={{
          background: 'linear-gradient(170deg, oklch(1 0 0 / 0.94), oklch(0.988 0.005 258 / 0.62))',
          boxShadow:
            'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
        }}
      >
        {/* ── 标题栏 ── */}
        <div
          className="flex shrink-0 items-center justify-between gap-3 px-6 py-4"
          style={{
            background: 'linear-gradient(105deg, oklch(1 0 0 / 0.92) 0%, oklch(0.975 0.006 258 / 0.58) 60%)',
            borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)',
          }}
        >
          {/* 开标前 24h 提醒横幅 */}
          {!isOpened && isWithin24hOfOpening && (
            <div className="flex items-center gap-2.5 rounded-xl px-4 py-2.5 mb-3"
              style={{ background: 'color-mix(in oklch, var(--warning) 10%, transparent)', border: '1px solid color-mix(in oklch, var(--warning) 25%, transparent)' }}>
              <AlertTriangle size={16} className="shrink-0 text-[var(--warning)]" />
              <div className="text-[11px] leading-relaxed text-[color:var(--foreground)]">
                <strong>距开标不足 24 小时</strong>——请确认所有步骤（采购文件、公告、供应商邀请、专家抽取）已完成且内容正确。开标确认后，所有前置信息将锁定不可修改。
              </div>
            </div>
          )}
          {/* 开标后锁定提示 */}
          {isOpened && (
            <div className="flex items-center gap-2.5 rounded-xl px-4 py-2.5 mb-3"
              style={{ background: 'color-mix(in oklch, var(--accent) 8%, transparent)', border: '1px solid color-mix(in oklch, var(--accent) 20%, transparent)' }}>
              <Shield size={16} className="shrink-0 text-[var(--accent)]" />
              <div className="text-[11px] leading-relaxed text-[color:var(--foreground)]">
                <strong>已开标</strong>——供应商名单、专家组、采购文件、评分标准等前置信息均已锁定。开标确认页面仅供查看。
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px]"
              style={{ background: 'var(--stage-evaluation-soft)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.65), 2px 2px 4px oklch(0.55 0.03 258 / 0.1)' }}
            >
              <Gavel size={17} style={{ color: 'var(--stage-evaluation)' }} />
            </div>
            <div className="min-w-0">
              <div className="text-[0.92rem] font-semibold tracking-[-0.02em] text-[var(--foreground)] truncate">
                开标确认
              </div>
              <div className="mt-0.5 text-[11px] text-[var(--muted-foreground)] truncate">
                {project?.title}
                {bidProject ? ` · ${bidProject.procurementMethod} · ${BID_STAGE_LABELS[bidProject.stage]}` : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => void load()} disabled={loading || busy} className="neu-btn-soft !p-2" title="刷新">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={onClose} className="neu-btn-soft !p-2" title="关闭">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── 主体 ── */}
        <div
          className="flex-1 min-h-0 overflow-y-auto px-6 py-5"
          style={{ background: 'oklch(0.975 0.012 258 / 0.32)' }}
        >
          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <RefreshCw size={28} className="text-[var(--accent)] animate-spin" />
                <div className="text-sm text-[var(--muted-foreground)]">加载开标就绪情况…</div>
              </div>
            </div>
          ) : error ? (
            <div className="flex min-h-[320px] items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-center">
                <AlertTriangle size={28} className="text-[var(--danger)]" />
                <div className="text-sm text-[var(--foreground)]">{error}</div>
                <button type="button" onClick={() => void load()} className="neu-btn-soft">重试</button>
              </div>
            </div>
          ) : workspace && bidProject && stats ? (
            <div className="space-y-5">
              {/* ▸ 区块2：供应商投标状态 */}
              <SectionCard
                icon={<Users size={14} />}
                title="供应商投标状态"
                accent="var(--stage-supplier)"
                accentSoft="var(--stage-supplier-soft)"
                action={
                  <div className="flex items-center gap-2">
                    {!isNegotiation && !isOpened && (
                      <span
                        className="hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] text-[var(--muted-foreground)] sm:inline-flex"
                        style={{ background: 'color-mix(in oklch, var(--accent) 8%, transparent)' }}
                        title="标书投递时间范围：公告发布 → 开标前 12 小时"
                      >
                        <Clock size={11} />
                        <span className="tabular-nums">{bidProject.publishTime ? formatDateTime(bidProject.publishTime) : '待发布'}</span>
                        <span className="opacity-50">→</span>
                        <span className="tabular-nums">{submitDeadline ? formatDateTime(submitDeadline.toISOString()) : '—'}</span>
                      </span>
                    )}
                    {!isOpened && (
                      <button
                        type="button"
                        onClick={() => setNudgeOpen(true)}
                        disabled={!bpId}
                        className="neu-btn-soft !h-[32px] !text-xs"
                      >
                        <BellRing size={13} /> 催促未投递
                      </button>
                    )}
                    {isOpened && (
                      <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-2.5 py-1 text-[10px] font-bold text-[var(--accent)]">已开标·锁定</span>
                    )}
                  </div>
                }
              >
                {supplierRows.length === 0 ? (
                  <EmptyHint
                    text={
                      isNegotiation
                        ? '暂无受邀供应商。请先在「供应商邀请」步骤完成邀请，受邀名单与回执将在此同步。'
                        : '暂无投标供应商。邀请招标/竞价等项目，供应商在投标门户响应后会出现。'
                    }
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="neu-table w-full min-w-[880px]">
                      <thead>
                        <tr>
                          <th style={{ width: 140 }}>供应商</th>
                          <th style={{ width: 160 }}>业务标签</th>
                          {showRsvpColumn && <th style={{ width: 80 }}>回执情况</th>}
                          <th style={{ width: 70 }}>投递状态</th>
                          <th style={{ width: 130 }}>投递时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {supplierRows.map((r) => {
                          const tone = r.submitted ? 'success' : r.withdrawn ? 'warning' : 'muted';
                          const label = r.submitted ? '已投递' : r.withdrawn ? '已撤回' : '未投递';
                          const rsvpLabel = r.rsvpStatus === 'ACCEPTED' ? '参加' : r.rsvpStatus === 'DECLINED' ? '无法参加' : '未回执';
                          const rsvpTone = r.rsvpStatus === 'ACCEPTED' ? 'success' : r.rsvpStatus === 'DECLINED' ? 'danger' : 'muted';
                          return (
                            <tr key={r.key} className="row-clickable">
                              <td className="font-medium text-[var(--foreground)]">{r.supplierName}</td>
                              <td className="text-[var(--muted-foreground)]">{r.tags.length > 0 ? r.tags.join('、') : '—'}</td>
                              {showRsvpColumn && <td><StatusPill tone={rsvpTone}>{rsvpLabel}</StatusPill></td>}
                              <td><StatusPill tone={tone}>{label}</StatusPill></td>
                              <td className="tabular-nums text-[var(--muted-foreground)]">{r.submittedAt ? formatDateTime(r.submittedAt) : '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>

              {/* ▸ 区块3：专家确认情况 */}
              <SectionCard
                icon={<Shield size={14} />}
                title="专家确认情况"
                accent="var(--stage-expert)"
                accentSoft="var(--stage-expert-soft)"
                action={
                  !isOpened ? (
                    <button
                      type="button"
                      onClick={() => void handleNudgeExperts()}
                      disabled={busy || stats.expertCount === 0}
                      className="neu-btn-soft !h-[32px] !text-xs"
                    >
                      <Bell size={13} /> 催促确认
                    </button>
                  ) : (
                    <span className="rounded-full bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] px-2.5 py-1 text-[10px] font-bold text-[var(--accent)]">已开标·锁定</span>
                  )
                }
              >
                {workspace.experts.length === 0 ? (
                  <EmptyHint text="尚未组建专家组。请先在「专家抽取」步骤完成抽取并通知。" />
                ) : (
                  (() => {
                    // 正选（排除已拒绝）+ 候补（排除已拒绝的，其余展示）
                    // 候补在 DB 中 invitationStatus 默认为 pending（不要求 RSVP 确认），有记录即已选定
                    const activeExperts = workspace.experts.filter(
                      e => e.invitationStatus !== 'declined',
                    );
                    const hasAlts = workspace.experts.some(x => x.expertRole === '候补');
                    if (activeExperts.length === 0) {
                      return <EmptyHint text="所有专家均已拒绝或超时，暂无确认的专家组成员。" />;
                    }
                    const roleLabel = (r: string) => r === '候补' ? '候补' : '正选';
                    const resolveTitle = (e: typeof workspace.experts[0]) =>
                      e.user?.expertProfile?.title || e.title || null;
                    const resolveEmployer = (e: typeof workspace.experts[0]) =>
                      e.user?.expertProfile?.employer || null;
                    return (
                      <div className="overflow-x-auto">
                        <table className="neu-table w-full min-w-[600px]">
                          <thead>
                            <tr>
                              <th style={{ width: 44 }}>#</th>
                              <th>专家</th>
                              <th>专业</th>
                              <th>部门</th>
                              <th>职称</th>
                              <th>角色</th>
                              <th>确认状态</th>
                              <th style={{ width: 60 }}>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeExperts.map((e, i) => {
                              const isAlt = e.expertRole === '候补';
                              return (
                                <tr key={e.id} className="row-clickable">
                                  <td className="text-center text-[var(--muted-foreground)] tabular-nums">{i + 1}</td>
                                  <td className="font-medium text-[var(--foreground)]">
                                    {e.expertName}
                                    {e.isLead && (
                                      <span
                                        className="ml-2 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                                        style={{ background: 'color-mix(in oklch, var(--warning) 16%, transparent)', color: 'color-mix(in oklch, var(--warning) 70%, black)' }}
                                        title="评审组长（专家抽取步骤第 5 步选定）"
                                      >
                                        <Crown size={11} /> 组长
                                      </span>
                                    )}
                                  </td>
                                  <td className="text-[var(--muted-foreground)]">{e.major || '—'}</td>
                                  <td className="text-[var(--muted-foreground)]">{resolveEmployer(e) || '—'}</td>
                                  <td className="text-[var(--muted-foreground)]">{resolveTitle(e) || '—'}</td>
                                  <td><StatusBadge tone={isAlt ? 'orange' : 'blue'}>{roleLabel(e.expertRole)}</StatusBadge></td>
                                  <td>{isAlt ? <span className="text-[11px] text-[var(--muted-foreground)]">—</span> : e.invitationStatus === 'confirmed' ? <StatusBadge tone="green">确认参加</StatusBadge> : <StatusBadge tone="blue">待回复</StatusBadge>}</td>
                                  <td className="text-center">
                                    {!isAlt && hasAlts && !isOpened && (
                                      <button onClick={() => { setReplaceModalExpert({ id: e.id, name: e.expertName }); setReplaceModalOpen(true); }} className="neu-btn-xs">替换</button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()
                )}
              </SectionCard>

              {/* 正选专家替换弹窗 */}
              {replaceModalOpen && replaceModalExpert && workspace && (
                <Modal
                  open
                  onClose={() => { setReplaceModalOpen(false); setReplaceModalExpert(null); }}
                  size="sm"
                  title={`替换专家：${replaceModalExpert.name}`}
                  description="选择一名候补专家替换当前正选专家"
                >
                  <div className="space-y-2 max-h-[260px] overflow-y-auto">
                    {workspace.experts
                      .filter(e => e.expertRole === '候补')
                      .map(alt => (
                        <button
                          key={alt.id}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              await swapExpertRole(bidProject?.id || '', replaceModalExpert.id, alt.id);
                              showToast(`已将 ${replaceModalExpert.name} 与 ${alt.expertName} 角色互换`);
                              setReplaceModalOpen(false);
                              setReplaceModalExpert(null);
                              void refreshWorkspace();
                            } catch (err: any) { showToast(err?.message || '替换失败', 'err'); }
                            setBusy(false);
                          }}
                          disabled={busy}
                          className="neu-btn-soft w-full text-left flex items-center gap-3 p-3"
                        >
                          <span className="text-sm font-bold text-[var(--foreground)]">{alt.expertName}</span>
                          <span className="text-xs text-[var(--muted-foreground)]">{alt.major || '—'}</span>
                          <StatusBadge tone="orange">候补</StatusBadge>
                        </button>
                      ))}
                  </div>
                </Modal>
              )}

              {/* ▸ 区块4：评分标准编制（2026-07-24 换用从 :3007 移植的完整编辑器：AI 提取 / 发布锁定 / 模板库 / 客观主观）*/}
              <SectionCard
                icon={<FileText size={14} />}
                title="评分标准编制"
                accent="var(--stage-evaluation)"
                accentSoft="var(--stage-evaluation-soft)"
              >
                {project && (
                  <ScoreStandardEditor
                    project={project}
                    round={round}
                    bidProject={bidProject}
                    onChanged={() => void load()}
                    variant="embedded"
                  />
                )}
              </SectionCard>

              {/* ▸ 区块5-8（Phase 2 指挥中心）：开标进度 / 归档
                  —— :3007 开标执行数据经同一 API 回流；评标管理/异议裁决/澄清答疑已迁 :3007（分工 v3，2026-08-13） */}
              {/* D1/G2: 专家在线 + 监督时间线 */}
              {bpId && (
                <SectionCard
                  icon={<Shield size={14} />}
                  title="监督时间线"
                  accent="var(--stage-evaluation)"
                  accentSoft="var(--stage-evaluation-soft)"
                  action={
                    expertOnlineCount > 0 ? (
                      <span className="flex items-center gap-1 text-xs font-semibold text-[var(--success)]">
                        <span className="inline-block h-2 w-2 rounded-full bg-[var(--success)]" />
                        专家在线 {expertOnlineCount} 人
                      </span>
                    ) : undefined
                  }
                >
                  {/* G2: 监督日志表（全量滚动 + 风险高亮） */}
                  {detail?.supervisionLogs && detail.supervisionLogs.length > 0 && (() => {
                    const logs = detail.supervisionLogs.slice().reverse();
                    const highRiskCount = logs.filter((l: any) => l.riskFlag === '高风险').length;
                    return (
                      <div>
                        <div className="mb-1 flex items-center gap-2 text-[10px] text-[var(--muted-foreground)]">
                          <span>{logs.length} 条记录</span>
                          {highRiskCount > 0 && <span className="font-semibold text-[var(--danger)]">{highRiskCount} 条高风险</span>}
                        </div>
                        <div className="max-h-48 overflow-y-auto rounded-lg border border-[oklch(0.6_0.04_258/0.1)]">
                          <table className="w-full text-[10px]">
                            <thead className="sticky top-0 bg-[oklch(0.975_0.012_258)] text-left text-[var(--muted-foreground)]">
                              <tr>
                                <th className="px-2 py-1 w-14 font-semibold">时间</th>
                                <th className="px-1 py-1 w-14 font-semibold">角色</th>
                                <th className="px-1 py-1 font-semibold">动作</th>
                                <th className="px-1 py-1 w-10 font-semibold">风险</th>
                              </tr>
                            </thead>
                            <tbody>
                              {logs.map((log: any, i: number) => (
                                <tr key={i} className={log.riskFlag === '高风险' ? 'bg-[color-mix(in_oklch,var(--danger)_6%,transparent)]' : ''}>
                                  <td className="px-2 py-0.5 tabular-nums text-[var(--muted-foreground)]">
                                    {new Date(log.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                  </td>
                                  <td className="px-1 py-0.5 font-semibold">{log.role}</td>
                                  <td className="px-1 py-0.5 text-[var(--muted-foreground)]">{log.action}<br/><span className="text-[var(--foreground)]">{log.result}</span></td>
                                  <td className="px-1 py-0.5 text-center">
                                    {log.riskFlag === '高风险' ? <span className="font-bold text-[var(--danger)]">⚠高</span> : log.riskFlag === '中风险' ? <span className="text-[var(--warning)]">中</span> : <span className="text-[var(--muted-foreground)]">—</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}
                  {!detail?.supervisionLogs?.length && (
                    <p className="text-xs text-[var(--muted-foreground)]">暂无监督记录</p>
                  )}
                </SectionCard>
              )}
              {bpId && detail && (
                <>
                  <OpeningProgressBlock
                    detail={detail}
                    onAbort={() => setAbortDialogOpen(true)}
                  />
                  <EvaluationHandoverBlock bidProjectId={bpId} detail={detail} />
                  {/* 评标管理/异议裁决/澄清答疑已迁至 :3007 开评标管理端（现场）——分工 v3（2026-08-13） */}
                  <p className="text-xs text-[var(--muted-foreground)]">
                    评标管理、专家异议裁决、澄清答疑已在 :3007 开评标管理端现场办理。本面板保留评标前准备与评标后收尾。
                  </p>
                  <ArchiveBlock bidProjectId={bpId} detail={detail} onChanged={refreshDetail} />
                  {/* A1: 公示期状态指示（归档后显示） */}
                  {detail?.stage === 'ARCHIVED' && <PublicityBanner bidProjectId={bpId} detail={detail} />}
                  {/* B2: 流标串联——abort + 公告 + 归档一步完成 */}
                  <AbortDialog
                    bidProjectId={bpId}
                    projectName={project?.title ?? ''}
                    projectCode={project?.projectCode ?? ''}
                    isOpen={abortDialogOpen}
                    onClose={() => setAbortDialogOpen(false)}
                    onChanged={() => { setAbortDialogOpen(false); refreshDetail(); }}
                  />
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* ▸ 区块9：开标决策（底部栏）── 仅在数据就绪且未归档时显示 */}
        {workspace && bidProject && !loading && stage && stage !== 'ARCHIVED' && (
          <div
            className="shrink-0 px-6 py-3.5"
            style={{
              background: 'linear-gradient(105deg, oklch(1 0 0 / 0.94) 0%, oklch(0.975 0.006 258 / 0.7) 100%)',
              borderTop: '1px solid oklch(0.6 0.04 258 / 0.14)',
            }}
          >
            {delayOpen ? (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-sm text-[var(--foreground)]">
                  <CalendarClock size={15} className="text-[var(--accent)]" />
                  <span>新的开标时间</span>
                </div>
                <input
                  type="datetime-local"
                  className="workbench-input !h-[36px]"
                  value={delayTime}
                  min={new Date().toISOString().slice(0, 16)}
                  onChange={(e) => setDelayTime(e.target.value)}
                />
                <div className="ml-auto flex items-center gap-2">
                  <button type="button" onClick={() => setDelayOpen(false)} className="neu-btn-soft !h-[36px]">取消</button>
                  <button type="button" onClick={() => void handleDelaySave()} disabled={busy || !delayTime} className="neu-btn-primary !h-[36px]">确认延时</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
                  <Clock size={14} />
                  <span>计划开标时间：<span className="font-semibold tabular-nums text-[var(--foreground)]">{formatDateTime(bidProject.openTime)}</span></span>
                  <span className="text-[var(--muted-foreground)]">·</span>
                  <span>{BID_STAGE_LABELS[stage]}</span>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {(stage === 'DOWNLOAD' || stage === 'SUBMIT') && (
                    <>
                      <button
                        type="button"
                        onClick={() => setHostPickerOpen(true)}
                        disabled={busy || openingSessionExists}
                        className="neu-btn-soft !h-[36px]"
                        title={
                          openingSessionExists
                            ? '已锁定（开标会话已组建）'
                            : assignedHost
                              ? `主持人：${assignedHost.displayName}`
                              : '未指派'
                        }
                      >
                        <UserCheck size={14} /> 开标主持人
                        <span className={assignedHost ? '' : 'text-[var(--warning)]'}>
                          ▾ {assignedHost ? assignedHost.displayName : '未指派'}
                        </span>
                      </button>
                      <button type="button" onClick={() => setDelayOpen(true)} disabled={busy} className="neu-btn-soft !h-[36px]">
                        <CalendarClock size={14} /> 延时开标
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleStartOpening()}
                        disabled={busy || !assignedHost}
                        className="neu-btn-primary !h-[36px]"
                        title={!assignedHost ? '请先指派开标主持人' : undefined}
                      >
                        <CheckCircle2 size={14} /> 按时开标
                      </button>
                    </>
                  )}
                  {stage === 'OPENING' && (
                    <div className="flex items-center gap-2 rounded-full bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-3 py-1.5 text-xs font-semibold text-[var(--success)]">
                      <CheckCircle2 size={14} /> 已确定开标 · 开标执行中
                    </div>
                  )}
                  {stage === 'EVALUATING' && (
                    <div className="flex items-center gap-2 rounded-full bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-3 py-1.5 text-xs font-semibold text-[var(--success)]">
                      <CheckCircle2 size={14} /> 评标进行中
                    </div>
                  )}
                  {/* 流标按钮：仅开标前 24h 内可点击。评标中（EVALUATING）流标归 :3007
                      异议裁决（分工 v3：有效供应商不足→现场裁决流标），:3005 不再提供入口 */}
                  {onAbort && (stage === 'DOWNLOAD' || stage === 'SUBMIT' || stage === 'OPENING') && (
                    <button
                      type="button"
                      onClick={() => void handleOpenFailBidDialog()}
                      disabled={!isWithin24hOfOpening || busy}
                      className="neu-btn-soft is-danger !h-[36px]"
                      title={!isWithin24hOfOpening ? '仅开标时间前 24 小时内可操作流标' : '确认流标并发布流标公告'}
                    >
                      <Ban size={14} /> 流标
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 开标主持人选择 Modal ── */}
        {hostPickerOpen && bidProject && (
          <HostPickerModal
            projectId={bidProject.id}
            currentHostId={assignedHost?.id ?? null}
            onClose={() => setHostPickerOpen(false)}
            onChanged={() => {
              setHostPickerOpen(false);
              refreshDetail();
            }}
          />
        )}

        {/* ── toast ── */}
        {toast && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
            <div
              className="pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold"
              style={{
                background: toast.tone === 'ok' ? 'color-mix(in oklch, var(--success) 14%, var(--background))' : 'color-mix(in oklch, var(--danger) 14%, var(--background))',
                color: toast.tone === 'ok' ? 'var(--success)' : 'var(--danger)',
                boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 6px oklch(0.55 0.03 258 / 0.12)',
              }}
            >
              {toast.tone === 'ok' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              {toast.text}
            </div>
          </div>
        )}

        {/* ── 延时开标后的通知确认对话框 ── */}
        {notifyConfirmOpen && (
          <div className="absolute inset-0 z-30 flex items-center justify-center px-6" style={{ background: 'oklch(0.975 0.012 258 / 0.5)', backdropFilter: 'blur(2px)' }}>
            <div className="w-full max-w-[420px] rounded-[20px] px-6 py-5" style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.72))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)' }}>
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-[10px]" style={{ background: 'var(--stage-evaluation-soft)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}>
                  <BellRing size={15} style={{ color: 'var(--stage-evaluation)' }} />
                </div>
                <span className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">通知供应商与专家</span>
              </div>
              <p className="mb-4 text-xs leading-5 text-[var(--muted-foreground)]">
                开标时间已更新为
                <span className="mx-1 font-semibold tabular-nums text-[var(--foreground)]">{formatDateTime(pendingOpenTime)}</span>
                。是否立即通知所有投标供应商与评标专家？
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => void handleConfirmNotify(false)} className="neu-btn-soft !h-[36px] !text-xs">不通知</button>
                <button type="button" onClick={() => void handleConfirmNotify(true)} disabled={busy} className="neu-btn-primary !h-[36px] !text-xs">
                  <BellRing size={13} /> 立即通知
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 催促未投递供应商弹窗（逐家 AI 文案 + 3 渠道 + 一次性额度，人工/定时共用） */}
      <NudgeUnsubmittedModal
        isOpen={nudgeOpen}
        onClose={() => setNudgeOpen(false)}
        project={project}
        bidProjectId={bpId ?? ''}
        onChanged={() => void load()}
      />

      {/* ★ 流标确认对话框（底部"流标"按钮触发） */}
      {failBidDialogOpen && (
        <div className="fixed inset-0 z-[500] flex items-center justify-center" onClick={() => !failBidConfirming && setFailBidDialogOpen(false)}>
          <div className="absolute inset-0" style={{ background: 'oklch(0.975 0.012 258 / 0.6)', backdropFilter: 'blur(3px)' }} />
          <div
            className="relative z-10 mx-5 w-full max-w-[480px] rounded-[22px] p-6"
            style={{
              background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.72))',
              boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.9), 3px 4px 18px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]"
                  style={{ background: 'color-mix(in oklch, var(--danger) 14%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}>
                  <Ban size={17} className="text-[var(--danger)]" />
                </div>
                <div>
                  <div className="text-sm font-semibold tracking-[-0.02em] text-[color:var(--foreground)]">确认流标</div>
                  <div className="text-[11px] text-[color:var(--muted-foreground)]">{project?.title}</div>
                </div>
              </div>
              <button type="button" onClick={() => !failBidConfirming && setFailBidDialogOpen(false)} className="neu-btn-xs"><X size={16} /></button>
            </div>

            {/* 投递/专家状态摘要 */}
            {workspace && (
              <div className="mb-3 rounded-[12px] px-3.5 py-2.5 text-[11px]" style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
                <div className="flex items-center gap-4 text-[color:var(--muted-foreground)]">
                  <span>受邀 <strong className="text-[color:var(--foreground)]">{workspace.suppliers.length}</strong> 家</span>
                  <span>已投递 <strong className="text-[color:var(--success)]">{workspace.suppliers.filter(s => s.submitted).length}</strong></span>
                  <span>未投递 <strong className="text-[color:var(--warning)]">{workspace.suppliers.filter(s => !s.submitted && !s.withdrawn).length}</strong></span>
                  <span>已撤回 <strong className="text-[color:var(--danger)]">{workspace.suppliers.filter(s => s.withdrawn).length}</strong></span>
                </div>
              </div>
            )}

            {/* 流标原因 */}
            <div className="mb-3">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">流标原因</span>
                {failBidAiLoading && (
                  <span className="flex items-center gap-1 text-[10px] text-[color:var(--accent)]">
                    <Loader2 size={10} className="animate-spin" /> AI 分析中…
                  </span>
                )}
                {!failBidAiLoading && failBidReason && (
                  <span className="flex items-center gap-1 text-[10px] text-[color:var(--accent)]">
                    <Sparkles size={10} /> AI 已生成
                  </span>
                )}
              </div>
              <textarea
                value={failBidReason}
                onChange={e => setFailBidReason(e.target.value)}
                placeholder="请填写流标原因…"
                rows={4}
                className="w-full resize-none rounded-xl px-3.5 py-2.5 text-sm text-[color:var(--foreground)] outline-none transition"
                style={{ background: 'oklch(1 0 0 / 0.48)', boxShadow: 'inset 1px 2px 4px oklch(0.55 0.03 258 / 0.1), inset -1px -1px 2px oklch(1 0 0 / 0.4)', border: 'none' }}
              />
            </div>

            <div className="mb-4 rounded-[10px] px-3 py-2 text-[11px] leading-relaxed text-[color:var(--muted-foreground)]"
              style={{ background: 'color-mix(in oklch, var(--danger) 6%, transparent)' }}>
              确认后将打开流标公告制作与发布流程。项目将被标记为流标状态。
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setFailBidDialogOpen(false)} disabled={failBidConfirming} className="neu-btn-soft">取消</button>
              <button
                type="button"
                onClick={() => {
                  setFailBidConfirming(true);
                  setFailBidDialogOpen(false);
                  onAbort?.();
                }}
                disabled={failBidAiLoading || !failBidReason.trim()}
                className="neu-btn-soft is-danger"
              >
                <Ban size={14} /> 确认流标
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 内部小组件 ── */

function SectionCard({
  icon, title, accent, accentSoft, action, children,
}: {
  icon: React.ReactNode;
  title: string;
  accent: string;
  accentSoft: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="neu-table-card px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]"
            style={{ background: accentSoft, boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}
          >
            <span style={{ color: accent }}>{icon}</span>
          </div>
          <h3 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatusPill({ tone, children }: { tone: 'success' | 'warning' | 'danger' | 'muted'; children: React.ReactNode }) {
  const color =
    tone === 'success' ? 'var(--success)' :
    tone === 'warning' ? 'var(--warning)' :
    tone === 'danger' ? 'var(--danger)' : 'var(--muted-foreground)';
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: `color-mix(in oklch, ${color} 12%, transparent)`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-[14px] px-4 py-6 text-xs text-[var(--muted-foreground)]" style={{ background: 'oklch(0.975 0.012 258 / 0.4)' }}>
      <AlertTriangle size={13} className="shrink-0 opacity-60" />
      <span>{text}</span>
    </div>
  );
}

/** A1+A3: 公示期状态指示 + 中标通知书推送——归档后显示公示倒计时 / 期满可发通知书 */
function PublicityBanner({ bidProjectId, detail }: { bidProjectId: string; detail: BidProjectDetail | null }) {
  const [status, setStatus] = useState<{ hasPublicity: boolean; publicityEnd: string | null; canIssueAward: boolean } | null>(null);
  const [letters, setLetters] = useState<Array<{ id: string; supplierName: string; deliveredAt: string | null; signedAt: string | null; signedBy: string | null }>>([]);
  const [delivering, setDelivering] = useState(false);

  const refresh = useCallback(() => {
    getPublicityStatus(bidProjectId).then(setStatus).catch(() => {});
    getAwardLetterStatus(bidProjectId).then(setLetters).catch(() => {});
  }, [bidProjectId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDeliver = async () => {
    const winner = (detail?.evaluationResults ?? []).find(r => r.rank === 1 && r.recommended);
    if (!winner) return;
    setDelivering(true);
    try {
      await deliverAwardLetter(bidProjectId, { winnerName: winner.supplierName, winnerSupplierId: winner.supplierId });
      refresh();
    } catch { /* toast handled by caller */ }
    finally { setDelivering(false); }
  };

  if (!status) return null;

  // M12: 中标价格展示
  const winner = (detail?.evaluationResults ?? []).find(r => r.rank === 1 && r.recommended);

  return (
    <div className="space-y-2">
      {!status.hasPublicity ? (
        <div className="exp-alert exp-alert--info flex items-center gap-2 !p-3">
          <Clock size={14} strokeWidth={1.5} className="shrink-0" />
          <span className="text-xs">尚未发布中标公示</span>
          {winner?.bidPrice && (
            <span className="ml-2 text-xs font-mono tabular-nums text-[var(--muted-foreground)]">
              中标金额：¥{Number(winner.bidPrice).toLocaleString('zh-CN')}
            </span>
          )}
        </div>
      ) : status.canIssueAward ? (
        <div className="exp-alert exp-alert--success flex items-center gap-2 !p-3">
          <CheckCircle2 size={14} strokeWidth={1.5} className="shrink-0" />
          <span className="text-xs font-semibold">公示期已满，可发出中标通知书</span>
          {detail?.evaluationResults?.some(r => r.rank === 1 && r.recommended) && letters.length === 0 && (
            <button type="button" onClick={handleDeliver} disabled={delivering} className="neu-btn-primary !h-[26px] !px-2.5 !text-[11px] ml-auto">
              {delivering ? '推送中…' : '推送中标通知书'}
            </button>
          )}
        </div>
      ) : (
        <div className="exp-alert exp-alert--warning flex items-center gap-2 !p-3">
          <Clock size={14} strokeWidth={1.5} className="shrink-0" />
          <span className="text-xs font-semibold">公示期未满，剩余约 {status.publicityEnd ? Math.ceil((new Date(status.publicityEnd).getTime() - Date.now()) / 86400000) : 0} 天，暂不可发出中标通知书</span>
        </div>
      )}

      {/* A3: 签收状态展示 */}
      {letters.length > 0 && (
        <div className="rounded-[12px] border border-[color-mix(in_oklch,var(--foreground)_10%,transparent)] px-3 py-2">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">中标通知书签收</div>
          {letters.map(l => (
            <div key={l.id} className="flex items-center gap-2 py-0.5 text-xs">
              <span className="font-medium text-[var(--foreground)]">{l.supplierName}</span>
              {l.signedAt ? (
                <span className="text-[var(--success)] font-semibold">✓ 已签收</span>
              ) : l.deliveredAt ? (
                <span className="text-[var(--muted-foreground)]">已推送，待签收</span>
              ) : (
                <span className="text-[var(--muted-foreground)]">未推送</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
