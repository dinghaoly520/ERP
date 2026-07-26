'use client';

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { api, enterOpeningRecord, resolveOpeningDispute, getOpeningSessionTime, decryptBid, getOpeningDraft } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import { TableSkeleton } from '@/components/skeleton';
import StartOpeningDialog from '@/components/start-opening-dialog';
import DecryptConfirmDialog from '@/components/decrypt-confirm-dialog';
import {
  Unlock, Clock, Shield, CheckCircle, AlertTriangle, Eye, ExternalLink,
  Volume2, Zap, Loader, FileText,
} from 'lucide-react';
import { useBidWebSocket } from '@/hooks/use-bid-websocket';
import { useReportRealtime } from '@/contexts/bid-realtime-context';
import NoProjectGuide from '@/components/no-project-guide';
import { DECRYPT_LABEL } from '@water-erp/shared';
import { toast } from 'sonner';
import { ExchangeDrawer } from '@/components/bid/exchange-drawer';
import { SupervisionView, type SupervisionLog } from '@/components/bid/supervision-view';
import type { AnomalyDetectedPayload } from '@water-erp/shared';
import { portalURL } from '@water-erp/config';

/** cgzxui 裸面板（取代 @water-erp/ui SectionCard 的 p-0 用法）——无边框玻璃静态卡 */
function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <section className={`neu-card-static overflow-hidden ${className}`}>{children}</section>;
}

// 解密状态徽标：类驱动配色（无内联 hex / style）
const decryptColors: Record<string, { cls: string }> = {
  PENDING: { cls: 'text-[var(--warning)] bg-[oklch(0.78_0.12_83_/_0.16)]' },
  RUNNING: { cls: 'text-[var(--accent-strong)] bg-[oklch(0.62_0.16_251_/_0.14)]' },
  SUCCESS: { cls: 'text-[var(--success)] bg-[oklch(0.71_0.11_164_/_0.16)]' },
  DANGER: { cls: 'text-[var(--danger)] bg-[oklch(0.66_0.175_27_/_0.16)]' },
};

const STAGES = ['投递中', '解密中', '确认中', '已完成'] as const;

/** 保证金状态选项（前端镜像 — 与后端 BOND_STATUS_OPTIONS 对齐，Task 2） */
const BOND_STATUS_OPTIONS = ['已缴纳', '保函有效', '未缴纳', '异常'] as const;

/* ── Sound Engine helpers (ref-based, no module-level state) ── */
function playTone(ctx: AudioContext, freq: number, duration: number, type: OscillatorType = 'sine') {
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + duration);
  } catch { /* silent fail */ }
}
function createSfx(ctxRef: React.RefObject<AudioContext | null>) {
  return {
    decryptSuccess: () => {
      const ctx = ctxRef.current; if (!ctx) return;
      playTone(ctx, 880, 0.12);
      setTimeout(() => { const c = ctxRef.current; if (c) playTone(c, 1100, 0.15); }, 120);
    },
    decryptFail: () => { const ctx = ctxRef.current; if (ctx) playTone(ctx, 180, 0.3, 'square'); },
    tick: () => { const ctx = ctxRef.current; if (ctx) playTone(ctx, 600, 0.05); },
    warning: () => { const ctx = ctxRef.current; if (ctx) playTone(ctx, 440, 0.4, 'sawtooth'); },
  };
}

/* ── Ring Countdown（浅色 cgzxui：data-urgent 驱动配色）── */
function RingCountdown({ remaining, big }: { remaining: number; big?: boolean }) {
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const pct = Math.min(1, remaining / (60 * 30)); // 30-min window baseline
  const radius = big ? 47 : 37;
  const cx = big ? 50 : 40;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * pct;
  const urgent = remaining <= 60 ? 'danger' : remaining <= 300 ? 'warn' : 'ok';
  const size = big ? 100 : 80;
  const fontSize = big ? 'text-2xl' : 'text-lg';
  const labelSize = big ? 'text-[10px]' : 'text-[9px]';
  return (
    <div className={`relative inline-flex items-center justify-center ${big ? 'h-[100px] w-[100px] scale-125' : 'h-[80px] w-[80px]'}`}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90 overflow-visible">
        <circle cx={cx} cy={cx} r={radius} fill="none" strokeWidth={6} className="bid-ring-track" />
        <circle cx={cx} cy={cx} r={radius} fill="none" strokeWidth={6}
          strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round"
          data-urgent={urgent} className="bid-ring-fg transition-all duration-1000" />
      </svg>
      <div className="relative z-10 flex flex-col items-center">
        <div data-urgent={urgent} className={`bid-ring-num font-mono font-black tracking-tight ${fontSize} ${urgent === 'danger' ? 'animate-pulse' : ''}`}>
          {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
        </div>
        <div className={`${labelSize} uppercase tracking-widest text-[color:var(--muted-foreground)]`}>剩余</div>
      </div>
    </div>
  );
}

/* ── Stage Stepper（浅色新拟态分段）── */
function StageStepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1">
      {STAGES.map((label, i) => (
        <div key={label} className="flex items-center gap-1">
          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold transition-all duration-500 ${
            i === step ? 'bg-[oklch(0.92_0.012_258)] text-[color:var(--foreground)] shadow-[inset_2px_2px_5px_oklch(0.55_0.03_258_/_0.18),inset_-2px_-2px_5px_oklch(1_0_0_/_0.6)]' :
            i < step ? 'text-[color:var(--accent-strong)]' : 'text-[color:var(--muted-foreground)] opacity-50'
          }`}>
            {i < step ? <CheckCircle size={11} /> : i === step ? <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent-strong)]" /> : <span className="h-2 w-2 rounded-full bg-[oklch(0.8_0.02_258)]" />}
            {label}
          </div>
          {i < STAGES.length - 1 && <span className="h-px w-4 bg-[oklch(0.8_0.02_258)]" />}
        </div>
      ))}
    </div>
  );
}

export default function BidOpenPage() {
  const { projectId } = useBidProjectContext();
  const [project, setProject] = useState<BidProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [startOpen, setStartOpen] = useState(false);
  /** 视图切换：开标大厅 / 监督视图（Phase 3：监督端折叠进大厅） */
  const [view, setView] = useState<'hall' | 'supervise'>('hall');
  /** F8：监督/异常事件由页面级 socket 统一订阅，下传给监督视图（避免双连接） */
  const [liveLogs, setLiveLogs] = useState<SupervisionLog[]>([]);
  const [anomalyEvents, setAnomalyEvents] = useState<AnomalyDetectedPayload[]>([]);

  // ═── Audio context with proper lifecycle (no module-level leak) ──
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sfx = createSfx(audioCtxRef);
  useEffect(() => {
    audioCtxRef.current = new AudioContext();
    return () => { audioCtxRef.current?.close(); audioCtxRef.current = null; };
  }, []);
  // 浏览器在用户首次交互前可能将 AudioContext 置于 suspended —— 首次点击/按键时 resume
  useEffect(() => {
    const resume = () => { audioCtxRef.current?.resume?.(); };
    window.addEventListener('click', resume, { once: true });
    window.addEventListener('keydown', resume, { once: true });
    return () => {
      window.removeEventListener('click', resume);
      window.removeEventListener('keydown', resume);
    };
  }, []);

  // ═══ New UX state ═══
  const [decrypting, setDecrypting] = useState<Set<string>>(new Set());
  const [bulkDecrypting, setBulkDecrypting] = useState(false);
  const [decryptTarget, setDecryptTarget] = useState<{ id: string; name: string }[] | null>(null);
  const [soundEnabled] = useState(true);
  const [bigScreen] = useState(false);
  const [inlineDispute, setInlineDispute] = useState<string | null>(null);
  const [disputeHandleResult, setDisputeHandleResult] = useState('');
  const [disputeHandleConfirm, setDisputeHandleConfirm] = useState<'confirmed' | 'rejected' | null>(null);
  const [disputeSubmitting, setDisputeSubmitting] = useState(false); // M9：防双击 + 失败态按钮锁
  const [recordEntry, setRecordEntry] = useState<{ bidSupplierId: string; supplierName: string } | null>(null);
  const [recordDraft, setRecordDraft] = useState({ amount: '', period: '', qualityTarget: '', bondStatus: '' });
  const [bidBondAssetId, setBidBondAssetId] = useState<string | null>(null);
  const [recordEntryLoading, setRecordEntryLoading] = useState(false);
  const [serverTimeOffset, setServerTimeOffset] = useState(0);
  // 每秒驱动重渲染，让倒计时圆环/MM:SS 实时跳动（remaining 依赖 now 重新计算）
  const [now, setNow] = useState(() => Date.now());
  const seenDecrypt = useRef<Set<string>>(new Set());
  const prevDecryptStatuses = useRef<Map<string, string>>(new Map());

  // Sync server time for authoritative countdown
  useEffect(() => {
    if (!projectId || !project?.openingSession) return;
    getOpeningSessionTime(projectId)
      .then(data => { setServerTimeOffset(data.serverTime - Date.now()); })
      .catch(() => {});
  }, [projectId, project?.openingSession]);

  const openingStatusMeta = (status?: string | null) => {
    switch (status) {
      case '供应商已确认': return { label: '供应商已确认', cls: 'text-[var(--success)] bg-[oklch(0.71_0.11_164_/_0.16)]' };
      case '供应商提出异议': return { label: '供应商提出异议', cls: 'text-[var(--danger)] bg-[oklch(0.66_0.175_27_/_0.16)]' };
      case '异议已处理-确认': return { label: '异议已处理', cls: 'text-[var(--success)] bg-[oklch(0.71_0.11_164_/_0.16)]' };
      case '异议已处理-退回': return { label: '异议已退回', cls: 'text-[color:var(--muted-foreground)] bg-[oklch(0.6_0.04_258_/_0.12)]' };
      case '待供应商确认': return { label: '待供应商确认', cls: 'text-[var(--warning)] bg-[oklch(0.78_0.12_83_/_0.16)]' };
      default: return { label: status || '待确认', cls: 'text-[color:var(--muted-foreground)] bg-[oklch(0.6_0.04_258_/_0.12)]' };
    }
  };

  // ═══ Derived data ═══
  const decryptProgress = useMemo(() => {
    if (!project) return { total: 0, success: 0, running: 0, pending: 0, danger: 0, pct: 0 };
    const suppliers = project.suppliers;
    const statuses = suppliers.map(s => s.decryptStatus);
    const total = suppliers.length;
    const success = statuses.filter(s => s === 'SUCCESS').length;
    const danger = statuses.filter(s => s === 'DANGER').length;
    const running = statuses.filter(s => s === 'RUNNING').length;
    const pending = statuses.filter(s => s !== 'SUCCESS' && s !== 'DANGER' && s !== 'RUNNING').length;
    return { total, success, danger, running, pending, pct: total > 0 ? (success + danger) / total : 0 };
  }, [project]);

  const sortedRecords = useMemo(() => {
    if (!project) return [];
    // objection rows first, then by confirm status
    return [...project.openingRecords].sort((a, b) => {
      const aObj = a.confirmStatus === '供应商提出异议' ? 0 : 1;
      const bObj = b.confirmStatus === '供应商提出异议' ? 0 : 1;
      if (aObj !== bObj) return aObj - bObj;
      return 0;
    });
  }, [project]);

  /** 开标完成判定（口径对齐后端可评供应商过滤集 bid.service.ts）：
   *  - 已撤回供应商排除出全集；
   *  - 解密"已处理" = SUCCESS 或 DANGER（DANGER 为解密异常但已处理，不参与评标）；
   *  - 唱标覆盖全部解密成功供应商；
   *  - 确认闭环仅对 SUCCESS 供应商要求 CONFIRMED（已确认）或 EXCEPTION（异议已退回处理）；
   *  - 无 DISPUTED 悬置异议。 */
  const openingDone = useMemo(() => {
    if (!project) return false;
    const active = project.suppliers.filter(s => s.submitStatus !== '已撤回');
    if (active.length === 0) return false;
    const successSuppliers = active.filter(s => s.decryptStatus === 'SUCCESS');
    const allDecryptResolved = active.every(s => s.decryptStatus === 'SUCCESS' || s.decryptStatus === 'DANGER');
    const allRecorded = project.openingRecords.length >= successSuppliers.length;
    const allConfirmResolved = successSuppliers.every(s => s.confirmStatus === 'CONFIRMED' || s.confirmStatus === 'EXCEPTION');
    const noPendingDispute = active.every(s => s.confirmStatus !== 'DISPUTED');
    return allDecryptResolved && allRecorded && allConfirmResolved && noPendingDispute;
  }, [project]);

  const stageStep = useMemo(() => {
    if (!project) return 0;
    if (project.stage === 'ARCHIVED') return 3;
    if (project.stage === 'EVALUATING') return 3;
    if (project.stage === 'OPENING' && project.openingSession) return 2;
    if (project.stage === 'OPENING') return 1;
    return 0;
  }, [project]);

  const session = project?.openingSession;
  const remaining = session ? Math.max(0, Math.floor((new Date(session.decryptWindowEnd).getTime() - now - serverTimeOffset) / 1000)) : 0;
  const timeWarning = remaining <= 0 ? 'none' : remaining <= 60 ? '1min' : remaining <= 300 ? '5min' : 'none';

  // ═══ API ══
  const handleResolveDispute = async (recordId: string, result: string, confirm: boolean) => {
    if (!projectId || disputeSubmitting) return;
    setDisputeSubmitting(true);
    try {
      await resolveOpeningDispute(projectId, recordId, { result, confirm });
      const updated = await api.get<BidProjectDetail>(`/bid/projects/${projectId}`);
      setProject(updated);
      setInlineDispute(null);
      setDisputeHandleResult('');
      setDisputeHandleConfirm(null);
    } catch (err: any) {
      // M9：失败时面板不收起、按钮解锁；非异议态记录后端返回 400 code=DISPUTE_NOT_PENDING
      if (err?.code === 'DISPUTE_NOT_PENDING') toast.error('该异议已被处理');
      else toast.error(err?.message || '处理异议失败');
    } finally {
      setDisputeSubmitting(false);
    }
  };

  const executeDecrypt = async (targets: { id: string; name: string }[]) => {
    if (!projectId) return;
    const isBulk = targets.length > 1;
    if (!isBulk) {
      // Single decrypt: show spinner inline
      const t = targets[0];
      setDecrypting(prev => new Set(prev).add(t.id));
      try {
        await decryptBid(projectId, t.id);
      } catch { /* error handled by WebSocket update */ }
      setDecrypting(prev => { const n = new Set(prev); n.delete(t.id); return n; });
    } else {
      // Bulk decrypt: parallelize with Promise.allSettled for partial-failure resilience
      setBulkDecrypting(true);
      const results = await Promise.allSettled(
        targets.map(t => decryptBid(projectId, t.id).catch(() => {})),
      );
      setBulkDecrypting(false);
      api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject);
    }
  };

  const handleDecrypt = (sid: string) => {
    const supplier = project?.suppliers.find(s => s.id === sid);
    if (supplier) setDecryptTarget([{ id: sid, name: supplier.supplierName }]);
  };

  const handleBulkDecrypt = () => {
    const pending = (project?.suppliers ?? []).filter(s => s.decryptStatus !== 'SUCCESS');
    if (pending.length === 0) return;
    setDecryptTarget(pending.map(s => ({ id: s.id, name: s.supplierName })));
  };

  const openRecordEntry = async (s: { id: string; supplierName: string }) => {
    if (!projectId) return;
    setRecordEntry({ bidSupplierId: s.id, supplierName: s.supplierName });
    setRecordDraft({ amount: '', period: '', qualityTarget: '', bondStatus: '' });
    setBidBondAssetId(null);
    setRecordEntryLoading(true);
    try {
      const draft = await getOpeningDraft(projectId, s.id);
      if (draft.canView) {
        setRecordDraft({
          amount: draft.amount ?? '',
          period: draft.period ?? '',
          qualityTarget: draft.qualityTarget ?? '',
          bondStatus: draft.bondStatus ?? '',
        });
        setBidBondAssetId(draft.bidBondAssetId ?? null);
      }
    } catch { /* 预填失败不阻断手填 */ }
    finally { setRecordEntryLoading(false); }
  };

  const handleEnterRecord = async () => {
    if (!projectId || !recordEntry) return;
    const { amount, period, qualityTarget, bondStatus } = recordDraft;
    if (!amount.trim() || !period.trim() || !qualityTarget.trim() || !bondStatus.trim()) {
      toast.error('请完整填写唱标信息'); return;
    }
    try {
      await enterOpeningRecord(projectId, { bidSupplierId: recordEntry.bidSupplierId, amount, period, qualityTarget, bondStatus });
      toast.success('唱标信息已录入，待供应商确认');
      setRecordEntry(null);
      const updated = await api.get<BidProjectDetail>(`/bid/projects/${projectId}`);
      setProject(updated);
    } catch (e: any) {
      // M9：唱标重录对锁定态记录后端返回 409 code=RECORD_LOCKED
      if (e?.code === 'RECORD_LOCKED') toast.error('该开标记录已锁定，无法重录');
      else toast.error(e?.message || '录入失败');
    }
  };

  // ═══ Data loading ═══
  const loadProject = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    setLoading(true);
    try {
      const p = await api.get<BidProjectDetail>(`/bid/projects/${projectId}`);
      setProject(p);
    } catch (e: any) {
      setError(e?.message || '加载项目数据失败');
      toast.error(e?.message || '加载项目数据失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    setView('hall');
    setLiveLogs([]);
    setAnomalyEvents([]);
    loadProject();
  }, [projectId, loadProject]);

  // ═══ WebSocket ═══
  const { connection, lastEventAt, reconnectNow } = useBidWebSocket(projectId ?? undefined, {
    onDecryptStatus: (data) => {
      setProject(prev => {
        if (!prev) return prev;
        // Sound + toast for status changes
        if (soundEnabled) {
          if (data.decryptStatus === 'SUCCESS') sfx.decryptSuccess();
          else if (data.decryptStatus === 'DANGER') sfx.decryptFail();
        }
        const supplier = prev.suppliers.find(s => s.id === data.supplierId);
        if (supplier && supplier.decryptStatus !== data.decryptStatus) {
          const key = `${data.supplierId}-${data.decryptStatus}`;
          if (!seenDecrypt.current.has(key)) {
            seenDecrypt.current.add(key);
            if (data.decryptStatus === 'SUCCESS') {
              toast.success(`🔓 ${supplier.supplierName} 解密成功`, { duration: 3000 });
            } else if (data.decryptStatus === 'DANGER') {
              toast.error(`⚠️ ${supplier.supplierName} 解密失败`, { duration: 5000 });
            }
          }
        }
        return {
          ...prev,
          suppliers: prev.suppliers.map(s =>
            s.id === data.supplierId ? { ...s, decryptStatus: data.decryptStatus } : s,
          ),
        };
      });
    },
    onStageChange: () => {
      if (projectId) {
        api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject);
      }
    },
    onOpeningConfirmed: (d) => {
      toast.success(`${d.supplierName} 已确认开标记录`);
      // R1：refetch 项目数据（同 onStageChange），让解密表"确认"列与开标记录确认状态同步刷新
      if (projectId) {
        api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject).catch(() => {});
      }
    },
    onOpeningDisputed: (d) => {
      toast.warning(`${d.supplierName} 提出开标异议：${d.reason}`);
      if (projectId) {
        api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject).catch(() => {});
      }
    },
    // F8：监督日志与异常事件统一在页面级订阅，下传给监督视图
    onSupervisionLog: (data) => {
      setLiveLogs(prev => [data as unknown as SupervisionLog, ...prev].slice(0, 100));
    },
    onAnomalyDetected: (data) => {
      if (data.severity === 'danger') toast.error(data.detail ?? '检测到异常');
      else toast.warning(data.detail ?? '检测到异常');
      setAnomalyEvents(prev => [data, ...prev].slice(0, 50));
    },
  });

  useReportRealtime(connection, lastEventAt, reconnectNow);

  // ═══ Countdown + time warnings ═══
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      const r = Math.max(0, Math.floor((new Date(session.decryptWindowEnd).getTime() - Date.now() - serverTimeOffset) / 1000));
      if (r > 0 && r <= 60 && soundEnabled) sfx.tick();
      if (r === 300 && soundEnabled) sfx.warning();
    }, 1000);
    return () => clearInterval(timer);
  }, [session, soundEnabled, serverTimeOffset]);

  if (!projectId) return <NoProjectGuide />;
  if (loading) return <TableSkeleton rows={8} cols={6} />;
  if (error && !project) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertTriangle size={32} strokeWidth={1.5} className="mb-4 text-[var(--danger)]" />
        <p className="mb-4 text-sm font-semibold text-[color:var(--muted-foreground)]">{error}</p>
        <button type="button" onClick={loadProject} className="neu-btn-primary !h-[38px] text-xs">重试</button>
      </div>
    );
  }
  if (!project) return <div className="py-20 text-center text-[13px] tracking-tight text-[color:var(--muted-foreground)]">暂无项目数据</div>;
  if (!projectId) return null;

  return (
    <div className={`space-y-5 ${bigScreen ? 'text-[115%]' : ''}`}>
      {/* ═══ 视图切换：开标大厅 / 监督视图（新拟态分段控件）═══ */}
      <div className="inline-flex w-fit items-center gap-1 rounded-[12px] bg-[oklch(0.95_0.008_258)] p-1 shadow-[inset_2px_2px_5px_oklch(0.55_0.03_258_/_0.12),inset_-2px_-2px_5px_oklch(1_0_0_/_0.7)]">
        <button type="button" onClick={() => setView('hall')}
          className={`flex items-center gap-1.5 rounded-[9px] px-4 py-1.5 text-[12px] font-bold transition-all ${view === 'hall' ? 'bg-[oklch(1_0_0)] text-[color:var(--accent-strong)] shadow-[2px_2px_5px_oklch(0.55_0.03_258_/_0.14),-1px_-1px_3px_oklch(1_0_0_/_0.9)]' : 'text-[color:var(--muted-foreground)]'}`}>
          <Unlock size={13} /> 开标大厅
        </button>
        <button type="button" onClick={() => setView('supervise')}
          className={`flex items-center gap-1.5 rounded-[9px] px-4 py-1.5 text-[12px] font-bold transition-all ${view === 'supervise' ? 'bg-[oklch(1_0_0)] text-[color:var(--accent-strong)] shadow-[2px_2px_5px_oklch(0.55_0.03_258_/_0.14),-1px_-1px_3px_oklch(1_0_0_/_0.9)]' : 'text-[color:var(--muted-foreground)]'}`}>
          <Shield size={13} /> 监督视图
        </button>
      </div>

      {view === 'supervise' ? (
        <SupervisionView projectId={projectId} project={project} liveLogs={liveLogs} anomalyEvents={anomalyEvents} />
      ) : (<>
      {/* ═══ Time warning banners — 无边框色调提示 ═══ */}
      {timeWarning === '5min' && (
        <div className="flex animate-pulse items-center gap-2 rounded-xl bg-[oklch(0.78_0.12_83_/_0.16)] px-4 py-2.5 text-sm font-bold text-[oklch(0.46_0.11_65)]">
          <AlertTriangle size={16} /> 解密窗口将在 5 分钟内关闭，请尽快完成解密操作
        </div>
      )}
      {timeWarning === '1min' && (
        <div className="flex items-center gap-2 rounded-xl bg-[oklch(0.66_0.175_27_/_0.14)] px-4 py-2.5 text-sm font-bold text-[var(--danger)]">
          <AlertTriangle size={16} className="animate-pulse" /> 解密窗口仅剩 1 分钟！
        </div>
      )}

      {/* ═══ 前阶段引导（F7）：流转权在 :3005，大厅只做开标执行 ═══ */}
      {(project.stage === 'DOWNLOAD' || project.stage === 'SUBMIT') && (
        <div className="flex items-center gap-4 rounded-2xl bg-[oklch(0.62_0.16_251_/_0.1)] p-5">
          <Clock size={20} strokeWidth={1.5} className="flex-shrink-0 text-[var(--accent-strong)]" />
          <div className="flex-1">
            <h2 className="mb-0.5 text-sm font-bold text-[oklch(0.4_0.13_251)]">该项目尚未确定开标</h2>
            <p className="text-xs text-[color:var(--muted-foreground)]">确定开标（阶段流转）由采购管理工作台（:3005）统一管理，请等待工作台完成「按时开标」确认后进入开标执行。</p>
          </div>
          <a href={portalURL('web', '/projects')} target="_blank" rel="noopener"
            className="neu-btn-primary !h-[38px] flex-shrink-0 text-xs">
            前往采购管理工作台 <ExternalLink size={13} />
          </a>
        </div>
      )}
      {(project.stage === 'EVALUATING' || project.stage === 'ARCHIVED') && (
        <div className="flex items-center gap-4 rounded-2xl bg-[oklch(0.71_0.11_164_/_0.12)] p-5">
          <CheckCircle size={20} strokeWidth={1.5} className="flex-shrink-0 text-[var(--success)]" />
          <div className="flex-1">
            <h2 className="mb-0.5 text-sm font-bold text-[oklch(0.4_0.1_155)]">开标已结束</h2>
            <p className="text-xs text-[color:var(--muted-foreground)]">本项目已进入{project.stage === 'EVALUATING' ? '评标阶段' : '归档状态'}，后续评标管理与归档请在采购管理工作台（:3005）操作；本页仅供查看开标过程记录。</p>
          </div>
          <a href={portalURL('web', '/projects')} target="_blank" rel="noopener"
            className="neu-btn-primary is-success !h-[38px] flex-shrink-0 text-xs">
            前往采购管理工作台 <ExternalLink size={13} />
          </a>
        </div>
      )}

      {/* ═══ 待组建会话横幅（:3005 已确定开标，主持人在此组建会话）═══ */}
      {!session && project.stage === 'OPENING' && (
        <div className="flex items-center gap-4 rounded-2xl bg-[oklch(0.78_0.12_83_/_0.14)] p-5">
          <AlertTriangle size={20} strokeWidth={1.5} className="flex-shrink-0 text-[var(--warning)]" />
          <div className="flex-1">
            <h2 className="mb-0.5 text-sm font-bold text-[oklch(0.46_0.11_65)]">已确定开标，等待组建开标会话</h2>
            <p className="text-xs text-[oklch(0.5_0.1_70)]">请主持人与监督人填写主持人、监督人与解密窗口，随后即可开始解密 / 唱标 / 异议处理。阶段推进由 :3005 采购管理工作台管理，开标会话仅在此组建。</p>
          </div>
          <button type="button" onClick={() => setStartOpen(true)}
            className="neu-btn-primary !h-[38px] flex-shrink-0 text-xs">
            <Shield size={13} /> 组建开标会话
          </button>
        </div>
      )}

      {/* ═══ 开标完成：交棒回 :3005（评标 / 开标归档）═══ */}
      {openingDone && project.stage === 'OPENING' && (
        <div className="flex items-center gap-4 rounded-2xl bg-[oklch(0.71_0.11_164_/_0.12)] p-5">
          <CheckCircle size={20} strokeWidth={1.5} className="flex-shrink-0 text-[var(--success)]" />
          <div className="flex-1">
            <h2 className="mb-0.5 text-sm font-bold text-[oklch(0.4_0.1_155)]">开标完成</h2>
            <p className="text-xs text-[color:var(--muted-foreground)]">全部解密、唱标与供应商确认已完成，无待处理异议。请返回采购管理工作台启动评标，或执行开标归档（流标 / 废标场景）。</p>
          </div>
          <a href={portalURL('web', '/projects')} target="_blank" rel="noopener"
            className="neu-btn-primary is-success !h-[38px] flex-shrink-0 text-xs">
            前往采购管理工作台 <ExternalLink size={13} />
          </a>
        </div>
      )}

      {/* ═══ Session header：浅色玻璃面板 + 圆环倒计时 + 阶段步进 ═══ */}
      {session && (
        <div className="neu-card-static space-y-4 p-6">
          <div className="flex flex-wrap items-center gap-8">
            <div className="min-w-0 flex-1">
              <h2 className={`mb-2 font-black tracking-tight text-[color:var(--foreground)] ${bigScreen ? 'text-2xl' : 'text-lg'}`}>
                {project.name}
              </h2>
              <div className="flex flex-wrap items-center gap-6 text-sm text-[color:var(--muted-foreground)]">
                <span className="flex items-center gap-1.5"><Clock size={13} strokeWidth={1.5} /> {new Date(project.openTime).toLocaleString('zh-CN')}</span>
                <span>主持人：{session.host}</span>
                <span>监督人：{session.supervisor}</span>
              </div>
            </div>
            <div className="rounded-xl bg-[oklch(0.985_0.005_258)] px-6 py-3 text-center shadow-[inset_2px_2px_5px_oklch(0.55_0.03_258_/_0.12),inset_-2px_-2px_5px_oklch(1_0_0_/_0.7)]">
              <div className="mb-1 text-xs uppercase tracking-widest text-[color:var(--muted-foreground)]">状态</div>
              <div className="text-lg font-black tracking-tight text-[color:var(--foreground)]">{session.status}</div>
            </div>
            {remaining > 0 && <RingCountdown remaining={remaining} big={bigScreen} />}
          </div>
          <StageStepper step={stageStep} />
        </div>
      )}

      {/* ═══ Decrypt status table ═══ */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[oklch(0.6_0.04_258_/_0.14)] px-6 py-4">
          <h2 className="text-sm font-bold text-[color:var(--foreground)]">
            投标人在线解密状态
          </h2>
          <div className="flex items-center gap-2">
            {/* 阶段流转（开放投递/确定开标）已归 :3005 采购管理工作台，本页仅执行开标 */}
            {!!session && project.stage === 'OPENING' && decryptProgress.total > 0 && decryptProgress.pending > 0 && (
              <button type="button" onClick={handleBulkDecrypt} disabled={bulkDecrypting}
                className="neu-btn-soft is-warning disabled:opacity-50">
                <Zap size={13} /> {bulkDecrypting ? '批量解密中...' : `全部解密 (${decryptProgress.pending})`}
              </button>
            )}
            {/* Wave 5-6：阶段已离 OPENING 后才开抽屉时，initialStageClosed 让输入框初始即禁用（免首次发送撞 403） */}
            {projectId && <ExchangeDrawer projectId={projectId} initialStageClosed={project.stage !== 'OPENING'} />}
          </div>
        </div>

        {/* Decrypt progress bar */}
        {decryptProgress.total > 0 && (
          <div className="border-b border-[oklch(0.6_0.04_258_/_0.12)] bg-[oklch(0.985_0.006_258_/_0.6)] px-6 py-3">
            <div className="flex items-center gap-3">
              <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">解密进度</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[oklch(0.92_0.012_258)]">
                <div className="flex h-full transition-all duration-700" style={{ width: `${decryptProgress.pct * 100}%` }}>
                  <div className="h-full bg-[var(--success)] transition-all" style={{ width: `${decryptProgress.total ? (decryptProgress.success / decryptProgress.total) * 100 : 0}%` }} />
                  <div className="h-full bg-[var(--danger)]" style={{ width: `${decryptProgress.total ? (decryptProgress.danger / decryptProgress.total) * 100 : 0}%` }} />
                </div>
              </div>
              <span className="text-[11px] font-mono font-bold tabular-nums text-[color:var(--foreground)]">
                <span className="text-[var(--success)]">{decryptProgress.success}</span>
                {decryptProgress.danger > 0 && <span className="text-[var(--danger)]">/{decryptProgress.danger}</span>}
                <span className="text-[color:var(--muted-foreground)]">/{decryptProgress.total}</span>
                <span className="ml-1 text-[color:var(--muted-foreground)]">({Math.round(decryptProgress.pct * 100)}%)</span>
              </span>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="neu-table is-dense w-full">
            <thead>
              <tr className="text-[color:var(--muted-foreground)]">
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">投标单位</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">回执编号</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">密文状态</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">解密状态</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">确认</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody>
              {project.suppliers.map(s => {
                const c = decryptColors[s.decryptStatus] || decryptColors.PENDING;
                const label = DECRYPT_LABEL[s.decryptStatus] || DECRYPT_LABEL.PENDING;
                const isRunning = s.decryptStatus === 'RUNNING';
                const isSuccess = s.decryptStatus === 'SUCCESS';
                const isDanger = s.decryptStatus === 'DANGER';
                const isDecrypting = decrypting.has(s.id);
                return (
                  <tr key={s.id} className={`transition-all ${
                    isSuccess ? 'animate-[flash_500ms_ease-out]' : isDanger ? 'animate-[shake_300ms_ease-out]' : ''
                  }`}>
                    <td className="relative px-5 py-3 font-medium text-[color:var(--foreground)]">
                      {s.supplierName}
                      {/* Scanning line overlay for RUNNING */}
                      {isRunning && (
                        <div className="absolute inset-0 animate-[scan_1.5s_linear_infinite] bg-gradient-to-b from-transparent via-[oklch(0.5_0.16_258_/_0.08)] to-transparent" />
                      )}
                    </td>
                    <td className="px-5 py-3 font-mono tracking-tight text-[color:var(--accent-strong)]">{s.receiptNo || '—'}</td>
                    <td className="px-5 py-3 text-[color:var(--muted-foreground)]">{s.encryptStatus}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide ${isRunning ? 'animate-pulse' : ''} ${c.cls}`}>
                        {isRunning && <Loader size={10} className="animate-spin" />}
                        {label}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {s.confirmStatus === 'CONFIRMED' ? (
                        <span className="flex items-center gap-1 text-[12px] text-[var(--success)]"><CheckCircle size={12} strokeWidth={1.5} /> 已确认</span>
                      ) : s.confirmStatus === 'EXCEPTION' ? (
                        <span className="flex items-center gap-1 text-[12px] text-[var(--danger)]"><AlertTriangle size={12} strokeWidth={1.5} /> 异常</span>
                      ) : (
                        <span className="text-[12px] text-[color:var(--muted-foreground)]">待确认</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {!!session && project.stage === 'OPENING' && s.decryptStatus !== 'SUCCESS' && (
                          <button type="button" onClick={() => handleDecrypt(s.id)} disabled={isDecrypting || bulkDecrypting}
                            className="flex items-center gap-1 text-[11px] font-semibold tracking-tight text-[var(--accent-strong)] transition-colors hover:text-[var(--accent)] disabled:opacity-50">
                            {isDecrypting ? <Loader size={12} className="animate-spin" /> : <Unlock size={12} strokeWidth={1.5} />}
                            {isDecrypting ? '解密中...' : '解密'}
                          </button>
                        )}
                        {isSuccess && project.stage === 'OPENING' && (
                          <button type="button" onClick={() => openRecordEntry(s)} disabled={recordEntryLoading}
                            className="flex items-center gap-1 text-[11px] font-semibold tracking-tight text-[var(--accent-strong)] transition-colors hover:text-[var(--accent)]">
                            <Volume2 size={12} strokeWidth={1.5} /> 唱标
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ═══ Opening records ═══ */}
      <Card>
        <div className="flex items-center justify-between border-b border-[oklch(0.6_0.04_258_/_0.14)] px-6 py-4">
          <h2 className="text-sm font-bold text-[color:var(--foreground)]">
            开标记录
          </h2>
          <span className="text-[11px] text-[color:var(--muted-foreground)]">
            {sortedRecords.length} 条 · 异议先行
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="neu-table is-dense w-full">
            <thead>
              <tr className="text-[color:var(--muted-foreground)]">
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">供应商</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">报价</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">工期</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">质量</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">保证金</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">确认状态</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody>
              {sortedRecords.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-[13px] text-[color:var(--muted-foreground)]">暂无开标记录</td></tr>
              ) : sortedRecords.map((r) => {
                const sm = openingStatusMeta(r.confirmStatus);
                const isDisputed = r.confirmStatus === '供应商提出异议';
                const disputeOpen = inlineDispute === r.id;
                return (
                  <React.Fragment key={r.id}>
                    <tr className={`align-top transition-colors ${
                      isDisputed ? 'border-l-4 border-l-[var(--danger)] bg-[oklch(0.66_0.175_27_/_0.08)]' : ''
                    }`}>
                      <td className="px-5 py-3 font-medium text-[color:var(--foreground)]">
                        {r.supplierName}
                        {r.objectionReason && <div className="mt-1 text-[11px] font-normal text-[var(--danger)]">异议：{r.objectionReason}</div>}
                        {r.handleResult && <div className="mt-1 text-[11px] font-normal text-[color:var(--muted-foreground)]">处理：{r.handleResult}</div>}
                      </td>
                      <td className="px-5 py-3 font-mono font-bold tracking-tight text-[color:var(--foreground)]">{r.amount}</td>
                      <td className="px-5 py-3 text-[color:var(--muted-foreground)]">{r.period}</td>
                      <td className="px-5 py-3 text-[color:var(--muted-foreground)]">{r.qualityTarget}</td>
                      <td className={`px-5 py-3 text-[13px] font-bold ${r.bondStatus === '已缴纳' || r.bondStatus === '保函有效' ? 'text-[var(--success)]' : r.bondStatus === '未缴纳' || r.bondStatus === '异常' ? 'text-[var(--danger)]' : 'text-[color:var(--muted-foreground)]'}`}>
                        {r.bondStatus || '—'}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide ${sm.cls}`}>{sm.label}</span>
                      </td>
                      <td className="px-5 py-3">
                        {isDisputed && project.stage === 'OPENING' && (
                          <button type="button" onClick={() => { setInlineDispute(disputeOpen ? null : r.id); setDisputeHandleResult(''); setDisputeHandleConfirm(null); }}
                            className={`flex items-center gap-1 text-[11px] font-semibold tracking-tight transition-colors ${
                              disputeOpen ? 'text-[color:var(--muted-foreground)]' : 'text-[var(--accent-strong)] hover:text-[var(--accent)]'
                            }`}>
                            <Shield size={12} strokeWidth={1.5} /> {disputeOpen ? '收起处理' : '处理异议'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {/* Inline dispute handling panel */}
                    {disputeOpen && (
                      <tr key={`${r.id}-dispute`}>
                        <td colSpan={7} className="border-b border-[oklch(0.78_0.12_83_/_0.3)] bg-[oklch(0.985_0.006_258_/_0.7)]">
                          <div className="space-y-3 px-5 py-4">
                            <div className="flex items-start gap-2">
                              <Shield size={14} className="mt-0.5 flex-shrink-0 text-[oklch(0.46_0.11_65)]" />
                              <div className="flex-1">
                                <p className="mb-0.5 text-sm font-bold text-[color:var(--foreground)]">处理 {r.supplierName} 的异议</p>
                                {r.objectionReason && (
                                  <p className="mb-2 text-xs text-[color:var(--muted-foreground)]">异议原因：{r.objectionReason}</p>
                                )}
                                <textarea
                                  value={disputeHandleResult}
                                  onChange={e => setDisputeHandleResult(e.target.value)}
                                  placeholder="输入处理结果说明..."
                                  className="h-20 w-full resize-y rounded-xl bg-[oklch(0.99_0.004_258)] px-3 py-2 text-xs text-[color:var(--foreground)] shadow-[inset_2px_2px_4px_oklch(0.55_0.03_258_/_0.08),inset_-2px_-2px_4px_oklch(1_0_0_/_0.6)] focus:outline-none"
                                />
                              </div>
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <button type="button" onClick={() => setInlineDispute(null)}
                                className="neu-btn-soft h-[34px] text-xs">取消</button>
                              <button type="button" onClick={() => handleResolveDispute(r.id, disputeHandleResult, false)}
                                className="neu-btn-soft is-danger h-[34px] text-xs disabled:opacity-50"
                                disabled={!disputeHandleResult.trim() || disputeSubmitting}>{disputeSubmitting ? '处理中…' : '退回异议'}</button>
                              <button type="button" onClick={() => handleResolveDispute(r.id, disputeHandleResult, true)}
                                className="neu-btn-primary is-success !h-[34px] text-xs disabled:opacity-50"
                                disabled={!disputeHandleResult.trim() || disputeSubmitting}>{disputeSubmitting ? '处理中…' : '确认受理'}</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      </>)}

      <StartOpeningDialog
        open={startOpen}
        projectId={projectId}
        onClose={() => setStartOpen(false)}
        onStarted={() => {
          setStartOpen(false);
          api.get<BidProjectDetail>(`/bid/projects/${projectId}`).then(setProject);
        }}
      />

      <DecryptConfirmDialog
        open={decryptTarget !== null}
        suppliers={decryptTarget ?? []}
        loading={bulkDecrypting || (decryptTarget?.length === 1 && decrypting.has(decryptTarget[0].id))}
        onConfirm={() => {
          if (decryptTarget) {
            executeDecrypt(decryptTarget);
            setDecryptTarget(null);
          }
        }}
        onClose={() => setDecryptTarget(null)}
      />

      {/* ═══ 唱标信息录入（修复开标闭环：解密后主持人补录报价/工期/质量/保证金）═══ */}
      {recordEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--background)]/60 backdrop-blur-sm" onClick={() => setRecordEntry(null)}>
          <div className="bid-dialog w-[480px] p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-black text-[color:var(--foreground)]">录入唱标信息 — {recordEntry.supplierName}</h3>
            <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">据解密后的投标内容填写，提交后生成开标记录（待供应商确认）。</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-[color:var(--muted-foreground)]">
                报价（元）
                <input value={recordDraft.amount} onChange={e => setRecordDraft(d => ({ ...d, amount: e.target.value }))}
                  className="neu-input mt-1 w-full font-mono" placeholder="如 980000" />
              </label>
              <label className="text-xs font-semibold text-[color:var(--muted-foreground)]">
                工期
                <input value={recordDraft.period} onChange={e => setRecordDraft(d => ({ ...d, period: e.target.value }))}
                  className="neu-input mt-1 w-full" placeholder="如 180天" />
              </label>
              <label className="text-xs font-semibold text-[color:var(--muted-foreground)]">
                质量目标
                <input value={recordDraft.qualityTarget} onChange={e => setRecordDraft(d => ({ ...d, qualityTarget: e.target.value }))}
                  className="neu-input mt-1 w-full" placeholder="如 合格" />
              </label>
              <label className="text-xs font-semibold text-[color:var(--muted-foreground)]">
                保证金
                <select value={recordDraft.bondStatus}
                  onChange={e => setRecordDraft(d => ({ ...d, bondStatus: e.target.value }))}
                  className="neu-select mt-1 w-full">
                  <option value="">— 请核对凭证后选择 —</option>
                  {BOND_STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                {bidBondAssetId && (
                  <a href={`/api/upload/files/${bidBondAssetId}`} target="_blank" rel="noopener"
                     className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-[var(--accent-strong)] hover:underline">
                    <FileText size={12} strokeWidth={1.5} /> 查看保证金凭证
                  </a>
                )}
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setRecordEntry(null)}
                className="neu-btn-soft h-[38px] text-xs">取消</button>
              <button type="button" onClick={handleEnterRecord}
                className="neu-btn-primary !h-[38px] text-xs">提交唱标</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
