'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { enterOpeningRecord, resolveOpeningDispute, getOpeningSessionTime, decryptBid, getOpeningDraft, completeOpening, resealBidFiles, startOpening, acceptSupplierDanger, pauseOpening, resumeOpening, decryptOuter, decryptAdjudge, listBondLedger, upsertBondLedger, removeBondLedger, type BondLedgerRow, type DecryptAdjudgeAttribution, type DecryptOuterResult, type DecryptOuterDetail } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import StartOpeningDialog from '@/components/start-opening-dialog';
import DecryptConfirmDialog from '@/components/decrypt-confirm-dialog';
import AdjudicateDialog, { type AdjudgeMode } from '@/components/adjudicate-dialog';
import {
  Unlock, Clock, Shield, CheckCircle, AlertTriangle, ExternalLink,
  Volume2, Zap, Loader, FileText, RotateCcw, PencilLine, Lock, Gavel,
} from 'lucide-react';
import { DECRYPT_LABEL, BOND_STATUS_OPTIONS, deriveOpeningSessionStatus, evaluateBondCompliance } from '@water-erp/shared';
import { toast } from 'sonner';
import { ExchangeDrawer } from '@/components/bid/exchange-drawer';
import { portalURL } from '@water-erp/config';
import { useBidUser } from '@/hooks/use-bid-user';
// 注：开标记录签字卡在「评标签字」tab（评标结束一次性办理的运营口径），本组件不再渲染

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

/** decrypt-outer 批量聚合形状判别（批量：details 数组 + total/success/skipped/failed 计数） */
type DecryptOuterBatch = { total: number; success: number; skipped: number; failed: number; details: DecryptOuterDetail[] };
function isDecryptOuterBatch(r: DecryptOuterResult): r is DecryptOuterBatch {
  return 'details' in r && Array.isArray((r as DecryptOuterBatch).details);
}

// 保证金状态选项 BOND_STATUS_OPTIONS 从 @water-erp/shared 导入（单一来源，原前端镜像已删）

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

export function OpeningHall({ project, onRefresh }: { project: BidProjectDetail; onRefresh: () => void }) {
  // 受控展示组件：project 数据与实时事件由工作区页（page.tsx）持有并经 props 下传；
  // 本组件只保留开标执行交互态，写操作成功后调 onRefresh() 触发页级 refetch。
  const projectId = project.id;
  // 「前往采购管理工作台」跳转仅对能实际操作 :3005 的角色有意义——bid_host 登 :3005
  // 按 PORTAL_ROLE_PRIORITY.web 解析为 bid_host、采购功能 403，按钮对现场主持人是死链（分工告知文本保留）
  // L2（2026-08-28）：解密/解外层/归因裁决/重新封标/暂停恢复等后端收口 @Roles('admin','bid_host')——
  // leader/staff 虽可登录本端但无现场执行权，对应按钮不再渲染（此前可见即点、点了 403 且单家解密静默无反馈）
  const me = useBidUser();
  const canGoWeb = me?.role !== 'bid_host';
  const canHost = me?.role === 'admin' || me?.role === 'bid_host';
  const [startOpen, setStartOpen] = useState(false);
  // ═══ New UX state ═══
  const [decrypting, setDecrypting] = useState<Set<string>>(new Set());
  const [bulkDecrypting, setBulkDecrypting] = useState(false);
  const [decryptTarget, setDecryptTarget] = useState<{ id: string; name: string }[] | null>(null);
  const [inlineDispute, setInlineDispute] = useState<string | null>(null);
  const [disputeHandleResult, setDisputeHandleResult] = useState('');
  const [disputeHandleConfirm, setDisputeHandleConfirm] = useState<'confirmed' | 'rejected' | null>(null);
  const [disputeSubmitting, setDisputeSubmitting] = useState(false); // M9：防双击 + 失败态按钮锁
  const [handingOver, setHandingOver] = useState(false); // T9：完成开标·移交按钮防双击
  const [recordEntry, setRecordEntry] = useState<{ bidSupplierId: string; supplierName: string; reentry?: boolean } | null>(null);
  const [recordDraft, setRecordDraft] = useState<{
    amount: string; period: string; qualityTarget: string; bondStatus: string;
    /** A-104：到账台账比对结论（null=项目不要求保证金/早期守卫，不渲染提示） */
    bondCompliance: { issues: { field: string; message: string }[] } | null;
  }>({ amount: '', period: '', qualityTarget: '', bondStatus: '', bondCompliance: null });
  const [bidBondAssetId, setBidBondAssetId] = useState<string | null>(null);
  const [recordEntryLoading, setRecordEntryLoading] = useState(false);
  const [serverTimeOffset, setServerTimeOffset] = useState(0);
  const [pausing, setPausing] = useState(false);
  const [resuming, setResuming] = useState(false);
  // ═══ DANGER 兜底：重新封标（从系统内原始明文恢复）═══
  const [resealing, setResealing] = useState<Set<string>>(new Set());
  // ═══ 双信封 v2（T17）：解外层 / 归因裁决 ═══
  const [outerDecrypting, setOuterDecrypting] = useState<Set<string>>(new Set());
  const [bulkOuterDecrypting, setBulkOuterDecrypting] = useState(false);
  const [adjudgeTarget, setAdjudgeTarget] = useState<{ id: string; name: string; mode: AdjudgeMode } | null>(null);
  const [adjudgeSubmitting, setAdjudgeSubmitting] = useState(false);
  // ═══ A-102/104：保证金到账台账（主持人面板；bondRequired 项目 OPENING 阶段）═══
  const [bondLedger, setBondLedger] = useState<BondLedgerRow[]>([]);
  const [bondLedgerLoading, setBondLedgerLoading] = useState(false);
  const [bondLedgerError, setBondLedgerError] = useState<string | null>(null);
  const [bondLedgerForm, setBondLedgerForm] = useState({ supplierName: '', amount: '', arrivedAt: '', account: '', payMethod: '', note: '' });
  const [bondLedgerSubmitting, setBondLedgerSubmitting] = useState(false);
  const [bondLedgerDeleting, setBondLedgerDeleting] = useState<Set<string>>(new Set());

  const handleReseal = async (supplierId: string) => {
    setResealing(prev => new Set(prev).add(supplierId));
    try {
      const result = await resealBidFiles(project.id, supplierId);
      if (result.recovered.length > 0) {
        toast.success(result.message);
      } else if (result.failed.length > 0) {
        toast.error(result.failed.map(f => `${f.label}: ${f.error}`).join('；'));
      }
      onRefresh();
    } catch (err: any) {
      toast.error(err?.message || '重新封标失败');
    }
    setResealing(prev => { const n = new Set(prev); n.delete(supplierId); return n; });
  };

  // ═══ 双信封 v2（T17）：解外层（单家/批量，§5.2）═══
  const handleDecryptOuter = async (sid: string) => {
    setOuterDecrypting(prev => new Set(prev).add(sid));
    try {
      const res = await decryptOuter(project.id, sid);
      if (isDecryptOuterBatch(res)) {
        // 单家路径正常不返回批量形状；防御性处理（后端契约变更时仍可读）
        toast.info(`解外层完成：成功 ${res.success} · 跳过 ${res.skipped} · 失败 ${res.failed}`);
      } else if ('skipped' in res) {
        toast.info('外层已解密（幂等跳过）');
      } else if (res.success) {
        toast.success(`外层解密成功（${res.roles.length} 个密封件）`);
      } else {
        toast.error(`${res.error ?? '解外层失败'}`);
      }
      onRefresh();
    } catch (e: any) {
      toast.error(e?.message || '解外层失败');
      onRefresh();
    } finally {
      setOuterDecrypting(prev => { const n = new Set(prev); n.delete(sid); return n; });
    }
  };

  const handleBulkDecryptOuter = async () => {
    setBulkOuterDecrypting(true);
    try {
      const res = await decryptOuter(project.id);
      // 批量路径返回明细聚合（total=进入处理的供应商数，Task 12 口径）
      if (isDecryptOuterBatch(res)) {
        toast.success(`解外层完成：成功 ${res.success} · 跳过 ${res.skipped} · 失败 ${res.failed}`);
        for (const d of res.details) {
          if ('success' in d && !d.success) {
            toast.error(`${d.supplierName}：${d.error ?? d.code ?? '解外层失败'}`);
          }
        }
      } else if ('skipped' in res) {
        toast.info('外层已解密（幂等跳过）');
      } else if (res.success) {
        toast.success('外层解密成功');
      } else {
        toast.error(`${res.error ?? '解外层失败'}`);
      }
      onRefresh();
    } catch (e: any) {
      toast.error(e?.message || '解外层失败');
      onRefresh();
    } finally {
      setBulkOuterDecrypting(false);
    }
  };

  // ═══ 双信封 v2（T17）：归因裁决（§5.5）═══
  const openAdjudge = (s: { id: string; supplierName: string }, mode: AdjudgeMode) => {
    setAdjudgeTarget({ id: s.id, name: s.supplierName, mode });
  };

  const handleAdjudge = async (attribution: DecryptAdjudgeAttribution, reason: string) => {
    if (!adjudgeTarget || adjudgeSubmitting) return;
    setAdjudgeSubmitting(true);
    try {
      await decryptAdjudge(project.id, { supplierId: adjudgeTarget.id, attribution, reason });
      if (attribution === 'RESET_PENDING') {
        toast.success('已重置解密机会，供应商可在窗口内重新解密');
      } else if (attribution === 'BIDDER') {
        toast.success('已裁决：投标人责任（视为撤销）');
      } else {
        toast.success('已裁决：平台责任（视为撤回）');
      }
      setAdjudgeTarget(null);
      onRefresh();
    } catch (e: any) {
      // RESET_PENDING 且窗口已关：后端 409 DECRYPT_WINDOW_CLOSED——提示先延长窗口
      if (e?.code === 'DECRYPT_WINDOW_CLOSED') {
        toast.error('解密窗口已关闭，请先延长解密窗口再重置解密机会');
      } else if (e?.code === 'NOT_UNKNOWN') {
        // 惰性归因已在请求内先行执行（如矩阵行 3 自动落 BIDDER）——刷新呈现终局
        toast.error(e?.message || '该供应商无需裁决');
        setAdjudgeTarget(null);
        onRefresh();
      } else {
        toast.error(e?.message || '裁决失败');
      }
    } finally {
      setAdjudgeSubmitting(false);
    }
  };

  // 每秒驱动重渲染，让倒计时圆环/MM:SS 实时跳动（remaining 依赖 now 重新计算）
  const [now, setNow] = useState(() => Date.now());

  // Sync server time for authoritative countdown
  // O7（2026-08-28）：授时重拉改键控（窗口止点|暂停态）——原依赖 openingSession 对象引用，
  // 任何无关刷新（评分事件等）都会重拉；仅窗口经「延长 +15分钟」或暂停/恢复变化时才需重新对时
  const sessionTimeKey = project?.openingSession
    ? `${project.openingSession.decryptWindowEnd}|${project.openingSession.pausedAt ?? ''}`
    : '';
  useEffect(() => {
    if (!projectId || !sessionTimeKey) return;
    getOpeningSessionTime(projectId)
      .then(data => { setServerTimeOffset(data.serverTime - Date.now()); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sessionTimeKey]);

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

  // ═══ 双信封 v2（T17）：分轨操作集 ═══
  // dualOuterPending：外层待解（§5.2 批量候选；已撤回排除）
  const dualOuterPending = useMemo(() => (project?.suppliers ?? []).filter(s =>
    s.envelopeVersion === 'dual-v2' && !s.outerDecryptedAt && s.submitStatus !== '已撤回'), [project]);
  // legacyPending：旧轨批量解密候选（主持端代解密仍走 decryptSupplier；与既有 decryptProgress.pending
  // 口径一致——仅 PENDING 计数展示与入列，DANGER/RUNNING 行不入批量）
  const legacyPending = useMemo(() => (project?.suppliers ?? []).filter(s =>
    s.envelopeVersion !== 'dual-v2'
    && s.decryptStatus !== 'SUCCESS' && s.decryptStatus !== 'DANGER' && s.decryptStatus !== 'RUNNING'
    && s.submitStatus !== '已撤回'), [project]);

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
  // 暂停期间倒计时冻结在暂停时刻的剩余值（后端在「恢复开标」时才把暂停时长补偿进 decryptWindowEnd）——
  // 与横幅「窗口计时已冻结」语义一致；恢复后剩余从冻结值继续走
  const remaining = session
    ? session.pausedAt
      ? Math.max(0, Math.floor((new Date(session.decryptWindowEnd).getTime() - new Date(session.pausedAt).getTime() - serverTimeOffset) / 1000))
      : Math.max(0, Math.floor((new Date(session.decryptWindowEnd).getTime() - now - serverTimeOffset) / 1000))
    : 0;
  const timeWarning = remaining <= 0 ? 'none' : remaining <= 60 ? '1min' : remaining <= 300 ? '5min' : 'none';
  // 解密窗口是否已过期（含无会话兜底：未组建会话视为不可解密，不构成裁决候选）
  const windowExpired = !!session && remaining <= 0;
  // L6（2026-08-28）：状态胶囊改 shared 派生（status 列建档后无流转，开标中/暂停/结束恒显「待开标」误导）；
  // now 用 serverTimeOffset 校正（与上方 remaining 同口径）
  const sessionStatus = session
    ? deriveOpeningSessionStatus({
        stage: project.stage,
        pausedAt: session.pausedAt,
        handoverAt: session.handoverAt,
        decryptWindowStart: session.decryptWindowStart,
        decryptWindowEnd: session.decryptWindowEnd,
        now: now + serverTimeOffset,
      })
    : null;

  // ═══ 待裁决清单（§5.5）：UNKNOWN 家 + 窗口关闭后的未归因候选（惰性归因将标记 UNKNOWN）═══
  const adjudgeRows = useMemo(() => {
    if (!project) return [];
    return project.suppliers.filter(s => {
      if (s.submitStatus === '已撤回' || s.envelopeVersion !== 'dual-v2' || s.decryptStatus === 'SUCCESS') return false;
      if (s.dangerAttribution === 'UNKNOWN') return true;
      if (s.dangerAttribution) return false; // BIDDER/PLATFORM 已终局
      // 未归因候选：仅窗口关闭后（窗口内供应商仍可自行解密，不可裁决）
      return windowExpired;
    });
  }, [project, windowExpired]);

  /** 本项目是否含双信封 v2 供应商（混轨项目文案分派用） */
  const hasDual = useMemo(() => (project?.suppliers ?? []).some(s => s.envelopeVersion === 'dual-v2'), [project]);

  // ═══ API ══
  const handleResolveDispute = async (recordId: string, result: string, confirm: boolean) => {
    if (!projectId || disputeSubmitting) return;
    setDisputeSubmitting(true);
    try {
      await resolveOpeningDispute(projectId, recordId, { result, confirm });
      setInlineDispute(null);
      setDisputeHandleResult('');
      setDisputeHandleConfirm(null);
      onRefresh();
    } catch (err: any) {
      // M9：失败时面板不收起、按钮解锁；非异议态记录后端返回 400 code=DISPUTE_NOT_PENDING
      if (err?.code === 'DISPUTE_NOT_PENDING') toast.error('该异议已被处理');
      else toast.error(err?.message || '处理异议失败');
    } finally {
      setDisputeSubmitting(false);
    }
  };

  /** T9：完成开标 · 生成开标文件包并移交回 :3005（POST /bid/projects/:id/complete-opening） */
  const handleHandover = async () => {
    if (!projectId || handingOver) return;
    setHandingOver(true);
    try {
      await completeOpening(projectId);
      toast.success('开标资料已移交采购管理工作台');
      onRefresh();
    } catch (e: any) {
      toast.error(e?.message || '移交失败');
    } finally {
      setHandingOver(false);
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
      } catch (e: any) {
        // L3（2026-08-28）：硬拒绝（窗口关/暂停/重复解密/新轨 400/403）不产生 WS 状态事件，
        // 此前静默无反馈（确认后 spinner 一转即逝）。密码学失败后端不抛错——置 DANGER 经
        // WS 推送（页级 toast+音效），此处仅提示请求被拒，无双响。
        toast.error(`${t.name}：${e?.message || '解密请求被拒'}`);
      }
      setDecrypting(prev => { const n = new Set(prev); n.delete(t.id); return n; });
    } else {
      // Bulk decrypt: parallelize with Promise.allSettled for partial-failure resilience
      setBulkDecrypting(true);
      const settled = await Promise.allSettled(
        targets.map(t => decryptBid(projectId, t.id)),
      );
      // L3：批量同样不吞拒绝——计数+首条原因聚合提示（窗口/暂停类拒绝在批量内同源）
      const rejected = settled.filter(s => s.status === 'rejected') as PromiseRejectedResult[];
      if (rejected.length > 0) {
        const first = rejected[0].reason as any;
        toast.error(`批量解密：${rejected.length}/${targets.length} 家请求被拒——${first?.message || '请检查解密窗口/暂停状态'}`);
      }
      setBulkDecrypting(false);
      onRefresh();
    }
  };

  const handleDecrypt = (sid: string) => {
    const supplier = project?.suppliers.find(s => s.id === sid);
    if (supplier) setDecryptTarget([{ id: sid, name: supplier.supplierName }]);
  };

  const handleBulkDecrypt = () => {
    // T17：批量解密仅旧轨（dual-v2 行由「解外层」承载；服务端对混轨调用旧端点会 400 USE_SUPPLIER_DECRYPT）
    const pending = legacyPending;
    if (pending.length === 0) return;
    setDecryptTarget(pending.map(s => ({ id: s.id, name: s.supplierName })));
  };

  const openRecordEntry = async (s: { id: string; supplierName: string }, reentry = false) => {
    if (!projectId) return;
    setRecordEntry({ bidSupplierId: s.id, supplierName: s.supplierName, reentry });
    setRecordDraft({ amount: '', period: '', qualityTarget: '', bondStatus: '', bondCompliance: null });
    setBidBondAssetId(null);
    setRecordEntryLoading(true);
    try {
      const draft = await getOpeningDraft(projectId, s.id);
      if (draft.canView) {
        setRecordDraft({
          amount: draft.amount ?? '',
          period: draft.period ?? '',
          qualityTarget: draft.qualityTarget ?? '',
          bondStatus: draft.bondStatus ?? (draft.bondNotApplicable ? '不适用' : ''),
          bondCompliance: draft.bondCompliance ?? null,
        });
        setBidBondAssetId(draft.bidBondAssetId ?? null);
      }
    } catch { /* 预填失败不阻断手填 */ }
    finally { setRecordEntryLoading(false); }
  };

  const handleEnterRecord = async (confirmSealedPrice = false, confirmSealedPeriod = false) => {
    if (!projectId || !recordEntry) return;
    const { amount, period, qualityTarget, bondStatus } = recordDraft;
    if (!amount.trim() || !period.trim() || !qualityTarget.trim() || !bondStatus.trim()) {
      toast.error('请完整填写唱标信息'); return;
    }
    try {
      await enterOpeningRecord(projectId, { bidSupplierId: recordEntry.bidSupplierId, amount, period, qualityTarget, bondStatus, confirmSealedPrice: confirmSealedPrice || undefined, confirmSealedPeriod: confirmSealedPeriod || undefined });
      toast.success('唱标信息已录入，待供应商确认');
      setRecordEntry(null);
      onRefresh();
    } catch (e: any) {
      // M9：唱标重录对锁定态记录后端返回 409 code=RECORD_LOCKED
      if (e?.code === 'RECORD_LOCKED') { toast.error('该开标记录已锁定，无法重录'); return; }
      // P1-4：录入价与投标文件密封报价不一致——主持人显式确认后带 flag 重试（保留工期 flag 状态）
      if (e?.code === 'PRICE_MISMATCH' && !confirmSealedPrice) {
        if (window.confirm(`${e?.message ?? '录入报价与密封报价不一致'}\n\n是否确认按录入值唱标？（差异将记入监督日志）`)) {
          void handleEnterRecord(true, confirmSealedPeriod);
        }
        return;
      }
      // 工期一致性校验（P1-4 同构）：录入工期与投递工期不一致——确认后带 flag 重试（保留报价 flag 状态）
      if (e?.code === 'PERIOD_MISMATCH' && !confirmSealedPeriod) {
        if (window.confirm(`${e?.message ?? '录入工期与投递工期不一致'}\n\n是否确认按录入值唱标？（差异将记入监督日志）`)) {
          void handleEnterRecord(confirmSealedPrice, true);
        }
        return;
      }
      toast.error(e?.message || '录入失败');
    }
  };

  // ═══ A-102/104：保证金到账台账 ═══
  const bondLedgerVisible = canHost && !!project.bondRequired && project.stage === 'OPENING';

  const loadBondLedger = async () => {
    if (!projectId) return;
    setBondLedgerLoading(true);
    setBondLedgerError(null);
    try {
      setBondLedger(await listBondLedger(projectId));
    } catch (e: any) {
      setBondLedgerError(e?.message || '加载失败');
    } finally {
      setBondLedgerLoading(false);
    }
  };

  useEffect(() => {
    if (!bondLedgerVisible) return;
    void loadBondLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, bondLedgerVisible]);

  const handleUpsertBondLedger = async () => {
    if (!projectId || bondLedgerSubmitting) return;
    const { supplierName, amount, arrivedAt, account, payMethod, note } = bondLedgerForm;
    // 前端守卫：金额必填且 ≥ 0（后端 DTO 缺 @IsPositive 属已知遗留缺口，以此兜底）
    if (!supplierName || !arrivedAt || !account.trim() || !payMethod || amount === '' || Number.isNaN(Number(amount)) || Number(amount) < 0) {
      toast.error('请完整填写到账信息（金额须为不小于 0 的数字）');
      return;
    }
    setBondLedgerSubmitting(true);
    try {
      await upsertBondLedger(projectId, {
        supplierName, amount: Number(amount), arrivedAt: new Date(arrivedAt).toISOString(),
        account: account.trim(), payMethod, note: note.trim() || undefined,
      });
      toast.success(`已登记 ${supplierName} 保证金到账`);
      // 同账户/支付形式连续登记多家时少敲一遍；缴纳人/金额/到账时间逐家清空
      setBondLedgerForm(f => ({ ...f, supplierName: '', amount: '', arrivedAt: '', note: '' }));
      await loadBondLedger();
      onRefresh();
    } catch (e: any) {
      toast.error(e?.message || '登记失败');
    } finally {
      setBondLedgerSubmitting(false);
    }
  };

  const handleRemoveBondLedger = async (row: BondLedgerRow) => {
    if (!projectId || bondLedgerDeleting.has(row.id)) return;
    if (!window.confirm(`确认删除「${row.supplierName}」的到账记录？\n（仅限错登纠正，删除将记入监督日志高风险留痕）`)) return;
    setBondLedgerDeleting(prev => new Set(prev).add(row.id));
    try {
      await removeBondLedger(projectId, row.id);
      toast.success('已删除到账记录');
      await loadBondLedger();
      onRefresh();
    } catch (e: any) {
      toast.error(e?.message || '删除失败');
    } finally {
      setBondLedgerDeleting(prev => { const n = new Set(prev); n.delete(row.id); return n; });
    }
  };

  // ═══ Countdown + time warnings ═══
  // 解密窗口倒计时音效（tick/warning）已随 sfx 上提至工作区页；本处仅保留每秒 setNow 驱动圆环 / MM:SS 视觉跳动。
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [session]);

  return (
    <div className="space-y-5">
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
      {/* P1-1：窗口已过期且仍有未到终局态的供应商——给出两条出路指引 */}
      {session && remaining <= 0 && project.stage === 'OPENING'
        && project.suppliers.some(s => s.submitStatus !== '已撤回' && s.decryptStatus !== 'SUCCESS' && s.decryptStatus !== 'DANGER') && (
        <div className="space-y-1 rounded-xl bg-[oklch(0.66_0.175_27_/_0.12)] px-4 py-3 text-sm font-bold text-[var(--danger)]">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} /> 解密窗口已过期，仍有供应商未到终局态。
          </div>
          <div className="pl-6 text-xs font-medium text-[var(--foreground)]">
            {hasDual
              ? '可重新「组建开标会话」延长窗口继续解密；或对待裁决供应商执行「归因裁决」定性（投标人责任 / 平台责任，记入监督日志）。'
              : '可重新「组建开标会话」延长窗口继续解密；或对未解密供应商执行「接受未解密」定性为解密异常（记入监督日志）。'}
          </div>
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
          {canGoWeb && (
            <a href={portalURL('web', '/projects')} target="_blank" rel="noopener"
              className="neu-btn-primary !h-[38px] flex-shrink-0 text-xs">
              前往采购管理工作台 <ExternalLink size={13} />
            </a>
          )}
        </div>
      )}
      {(project.stage === 'EVALUATING' || project.stage === 'ARCHIVED' || project.stage === 'ABORTED') && (
        <div className="flex items-center gap-4 rounded-2xl bg-[oklch(0.71_0.11_164_/_0.12)] p-5">
          <CheckCircle size={20} strokeWidth={1.5} className="flex-shrink-0 text-[var(--success)]" />
          <div className="flex-1">
            <h2 className="mb-0.5 text-sm font-bold text-[oklch(0.4_0.1_155)]">开标已结束</h2>
            <p className="text-xs text-[color:var(--muted-foreground)]">
              {project.stage === 'ABORTED'
                ? '本项目已流标，后续处理（流标公告）请在采购管理工作台（:3005）操作；本页仅供查看开标过程记录。'
                : `本项目已进入${project.stage === 'EVALUATING' ? '评标阶段' : '归档状态'}，评标管理与评标签字请在本工作区对应 tab 操作；完整归档与公示请在采购管理工作台（:3005）操作。`}
            </p>
          </div>
          {canGoWeb && (
            <a href={portalURL('web', '/projects')} target="_blank" rel="noopener"
              className="neu-btn-primary is-success !h-[38px] flex-shrink-0 text-xs">
              前往采购管理工作台 <ExternalLink size={13} />
            </a>
          )}
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

      {/* ═══ 开标完成 · 交回 :3005（三态：待移交 / 已移交 / ——未完成时不显示）═══ */}
      {project.stage === 'OPENING' && !!session?.handoverAt && (
        <div className="flex items-center gap-4 rounded-2xl bg-[oklch(0.71_0.11_164_/_0.12)] p-5">
          <CheckCircle size={20} strokeWidth={1.5} className="flex-shrink-0 text-[var(--success)]" />
          <div className="flex-1">
            <h2 className="mb-0.5 text-sm font-bold text-[oklch(0.4_0.1_155)]">开标资料已移交</h2>
            <p className="text-xs text-[color:var(--muted-foreground)]">移交时间 {new Date(session.handoverAt).toLocaleString('zh-CN')}。开标文件包已回传采购管理工作台，后续启动评标 / 归档请前往 :3005 开标确认面板。</p>
          </div>
          {canGoWeb && (
            <a href={portalURL('web', `/projects`)} target="_blank" rel="noopener"
              className="neu-btn-primary is-success !h-[38px] flex-shrink-0 text-xs">
              前往采购管理工作台 <ExternalLink size={13} />
            </a>
          )}
        </div>
      )}
      {openingDone && project.stage === 'OPENING' && !session?.handoverAt && (
        <div className="flex items-center gap-4 rounded-2xl bg-[oklch(0.71_0.11_164_/_0.12)] p-5">
          <CheckCircle size={20} strokeWidth={1.5} className="flex-shrink-0 text-[var(--success)]" />
          <div className="flex-1">
            <h2 className="mb-0.5 text-sm font-bold text-[oklch(0.4_0.1_155)]">开标完成</h2>
            <p className="text-xs text-[color:var(--muted-foreground)]">全部解密、唱标与供应商确认已完成，无待处理异议。点击下方按钮生成开标文件包并移交采购管理工作台。</p>
          </div>
          <button type="button" onClick={handleHandover} disabled={handingOver}
            className="neu-btn-primary is-success !h-[38px] flex-shrink-0 text-xs disabled:opacity-50">
            {handingOver ? '移交中…' : '完成开标 · 移交'}
          </button>
        </div>
      )}

      {/* ═══ Session header：浅色玻璃面板 + 圆环倒计时 + 阶段步进 ═══ */}
      {session && (
        <div className="neu-card-static space-y-4 p-6">
          <div className="flex flex-wrap items-center gap-8">
            <div className="min-w-0 flex-1">
              <h2 className="mb-2 text-lg font-black tracking-tight text-[color:var(--foreground)]">
                {project.name}
              </h2>
              <div className="flex flex-wrap items-center gap-6 text-sm text-[color:var(--muted-foreground)]">
                <span className="flex items-center gap-1.5"><Clock size={13} strokeWidth={1.5} /> {new Date(project.openTime).toLocaleString('zh-CN')}</span>
                <span>主持人：{session.host}</span>
                <span>监督人：{session.supervisor ?? '未指定'}</span>
                {project.roundMode && (
                  <span className="rounded-full bg-[var(--accent-strong)]/10 px-2.5 py-0.5 text-xs font-bold text-[var(--accent-strong)]">
                    第 {project.currentRoundNo ?? 1} 轮 · {project.roundMode === 'negotiation' ? '谈判' : '竞价'}
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-xl bg-[oklch(0.985_0.005_258)] px-6 py-3 text-center shadow-[inset_2px_2px_5px_oklch(0.55_0.03_258_/_0.12),inset_-2px_-2px_5px_oklch(1_0_0_/_0.7)]">
              <div className="mb-1 text-xs uppercase tracking-widest text-[color:var(--muted-foreground)]">状态</div>
              <div className="text-lg font-black tracking-tight text-[color:var(--foreground)]">{sessionStatus ?? session.status}</div>
            </div>
            {remaining > 0 && <RingCountdown remaining={remaining} />}
            {session && remaining > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="neu-btn-soft text-xs"
                  onClick={async () => {
                    // 在当前窗口截止时间上顺延 15 分钟（勿写成 now+15min——那会把剩余时间重置为 15 分钟）
                    const newEnd = new Date(new Date(session.decryptWindowEnd).getTime() + 15 * 60 * 1000).toISOString();
                    try {
                      await startOpening(projectId, {
                        host: session.host,
                        decryptWindowStart: session.decryptWindowStart,
                        decryptWindowEnd: newEnd,
                        supervisor: session.supervisor ?? undefined,
                      });
                      toast.success('解密窗口已延长 15 分钟');
                      onRefresh();
                    } catch (e: any) { toast.error(e?.message || '延长失败'); }
                  }}
                ><Clock size={13} className="mr-1 inline" />延长 +15分钟</button>
                {canHost && (!session.pausedAt ? (
                  <button
                    type="button" disabled={pausing}
                    className="neu-btn-soft text-xs text-[var(--warning)]"
                    onClick={async () => {
                      setPausing(true);
                      const reason = window.prompt('暂停原因（可选）'); try { await pauseOpening(projectId, reason || undefined); toast.success('开标已暂停'); onRefresh(); }
                      catch (e: any) { toast.error(e?.message || '暂停失败'); }
                      finally { setPausing(false); }
                    }}
                  ><AlertTriangle size={13} className="mr-1 inline" />暂停开标</button>
                ) : (
                  <button
                    type="button" disabled={resuming}
                    className="neu-btn-soft text-xs text-[var(--success)]"
                    onClick={async () => {
                      setResuming(true);
                      try { await resumeOpening(projectId); toast.success('开标已恢复，窗口已补偿'); onRefresh(); }
                      catch (e: any) { toast.error(e?.message || '恢复失败'); }
                      finally { setResuming(false); }
                    }}
                  ><CheckCircle size={13} className="mr-1 inline" />恢复开标</button>
                ))}
              </div>
            )}
            {session?.pausedAt && (
              <div className="mt-2 flex items-center gap-2 rounded-xl bg-[oklch(0.78_0.12_83_/_0.16)] px-3 py-1.5 text-xs font-bold text-[oklch(0.46_0.11_65)]">
                <AlertTriangle size={14} className="animate-pulse" />
                开标已暂停 — 解密操作被禁止，窗口计时已冻结
              </div>
            )}
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
            {/* T17：双信封 v2——管理方解外层（§5.2；批量逐家串行，返回明细聚合） */}
            {!!session && canHost && project.stage === 'OPENING' && dualOuterPending.length > 0 && (
              <button type="button" onClick={handleBulkDecryptOuter} disabled={bulkOuterDecrypting || !!session.pausedAt}
                className="neu-btn-soft is-warning disabled:opacity-50">
                <Unlock size={13} /> {bulkOuterDecrypting ? '批量解外层中...' : session.pausedAt ? '开标已暂停' : `全部解外层 (${dualOuterPending.length})`}
              </button>
            )}
            {/* 旧轨批量解密（dual-v2 行由「解外层」承载） */}
            {!!session && canHost && project.stage === 'OPENING' && legacyPending.length > 0 && (
              <button type="button" onClick={handleBulkDecrypt} disabled={bulkDecrypting || !!session.pausedAt}
                className="neu-btn-soft is-warning disabled:opacity-50">
                <Zap size={13} /> {bulkDecrypting ? '批量解密中...' : session.pausedAt ? '开标已暂停' : `全部解密 (${legacyPending.length})`}
              </button>
            )}
            {/* Wave 5-6：阶段已离 OPENING 后才开抽屉时，initialStageClosed 让输入框初始即禁用（免首次发送撞 403） */}
            {projectId && <ExchangeDrawer projectId={projectId} initialStageClosed={project.stage !== 'OPENING'} />}
          </div>
        </div>

        {/* ═══ 待裁决面板（§5.5）：UNKNOWN 非终局态继续阻塞开标——主持人在此逐家落归因 ═══ */}
        {adjudgeRows.length > 0 && (
          <div className="border-b border-[oklch(0.78_0.12_83_/_0.3)] bg-[oklch(0.78_0.12_83_/_0.08)] px-6 py-3">
            <div className="mb-2 flex items-center gap-1.5">
              <Gavel size={13} strokeWidth={1.5} className="text-[oklch(0.46_0.11_65)]" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-[oklch(0.46_0.11_65)]">
                解密失败归因 · 待裁决（{adjudgeRows.length}）
              </span>
              <span className="text-[11px] text-[color:var(--muted-foreground)]">
                归因未决将阻塞「完成开标·移交」，请依据外层解密/取包事实逐家裁决
              </span>
            </div>
            <div className="space-y-1.5">
              {adjudgeRows.map(s => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-[oklch(0.99_0.004_258_/_0.8)] px-3 py-2">
                  <span className="min-w-[140px] flex-1 text-[12px] font-bold text-[color:var(--foreground)]">{s.supplierName}</span>
                  <span className={`text-[11px] font-semibold ${s.outerDecryptedAt ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
                    外层解密：{s.outerDecryptedAt ? '已解' : '未解'}
                  </span>
                  <span className={`text-[11px] font-semibold ${s.packageFetchedAt ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
                    解密包领取：{s.packageFetchedAt ? '已取' : '未取'}
                  </span>
                  <span className="rounded-full bg-[oklch(0.78_0.12_83_/_0.16)] px-2 py-0.5 text-[11px] font-semibold text-[oklch(0.46_0.11_65)]">
                    {DECRYPT_LABEL[s.decryptStatus] || DECRYPT_LABEL.PENDING}
                  </span>
                  {canHost && (
                  <button
                    type="button"
                    disabled={adjudgeSubmitting}
                    onClick={() => openAdjudge(s, 'unknown')}
                    className="neu-btn-soft is-warning !h-[28px] text-[11px] disabled:opacity-50"
                  >
                    <Gavel size={11} /> 裁决
                  </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

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
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">解密时间</th>
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
                const resealFailed = isDanger && !!s.decryptError?.includes('重新封标失败');
                const isDecrypting = decrypting.has(s.id);
                // ═══ 双信封 v2（T17）：新轨分派（envelopeVersion 由项目详情派生下发）═══
                const isDual = s.envelopeVersion === 'dual-v2';
                const outerDone = !!s.outerDecryptedAt;
                const attribution = s.dangerAttribution ?? null;
                const isOuterDecrypting = outerDecrypting.has(s.id);
                const canAct = !!session && project.stage === 'OPENING' && !session.pausedAt;
                // 归因徽标（§5.5）：BIDDER=撤销·投标人责任 / PLATFORM=撤回·平台责任 / UNKNOWN=待裁决
                const attributionMeta = attribution === 'BIDDER'
                  ? { label: '撤销 · 投标人责任', cls: 'text-[var(--danger)] bg-[oklch(0.66_0.175_27_/_0.14)]' }
                  : attribution === 'PLATFORM'
                    ? { label: '撤回 · 平台责任', cls: 'text-[var(--warning)] bg-[oklch(0.78_0.12_83_/_0.16)]' }
                    : attribution === 'UNKNOWN'
                      ? { label: '待裁决', cls: 'text-[oklch(0.46_0.11_65)] bg-[oklch(0.78_0.12_83_/_0.2)] animate-pulse' }
                      : null;
                // 唱标状态由该供应商的开标记录决定：无记录→唱标；待供应商确认→可重录（后端 upsert）；
                // 已确认/异议态记录后端 409（RECORD_LOCKED/RECORD_ALREADY_CONFIRMED）→ 只读「已唱标」
                const record = project.openingRecords.find(r => r.bidSupplierId === s.id);
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
                    <td className="px-5 py-3 text-[color:var(--muted-foreground)]">
                      <div>{s.encryptStatus}</div>
                      {/* T17：双信封 v2 外层状态（管理方解外层进度的事实锚） */}
                      {isDual && (
                        <div className="mt-1">
                          {outerDone ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.71_0.11_164_/_0.16)] px-2 py-0.5 text-[10px] font-semibold text-[var(--success)]">
                              <Shield size={10} strokeWidth={1.7} /> 外层已解
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.78_0.12_83_/_0.16)] px-2 py-0.5 text-[10px] font-semibold text-[oklch(0.46_0.11_65)]">
                              <Lock size={10} strokeWidth={1.7} /> 外层未解
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide ${isRunning ? 'animate-pulse' : ''} ${c.cls}`}>
                        {isRunning && <Loader size={10} className="animate-spin" />}
                        {label}
                      </span>
                      {isDual && attributionMeta && (
                        <span className={`ml-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${attributionMeta.cls}`}>
                          {attributionMeta.label}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 font-mono text-[11px] tracking-tight text-[color:var(--muted-foreground)]">
                      {s.decryptedAt
                        ? new Date(s.decryptedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
                        : '—'}
                    </td>
                    <td className="px-5 py-3">
                      {s.confirmStatus === 'CONFIRMED' ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="flex items-center gap-1 text-[12px] text-[var(--success)]"><CheckCircle size={12} strokeWidth={1.5} /> 已确认</span>
                          {/* A-114：确认签名徽标（数据源=剥壳摘要；完整签名仅在本人视图与开标文件包） */}
                          {record?.confirmSignature ? (
                            <span className="inline-flex items-center rounded-full bg-[oklch(0.71_0.11_164_/_0.16)] px-2 py-0.5 text-[10px] font-semibold text-[var(--success)]">已电子签名</span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-[oklch(0.6_0.04_258_/_0.12)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--muted-foreground)]">未签名</span>
                          )}
                        </span>
                      ) : s.confirmStatus === 'EXCEPTION' ? (
                        <span className="flex items-center gap-1 text-[12px] text-[var(--danger)]"><AlertTriangle size={12} strokeWidth={1.5} /> 异常</span>
                      ) : (
                        <span className="text-[12px] text-[color:var(--muted-foreground)]">待确认</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        {/* 旧轨：主持端代解密（dual-v2 行改用「解外层」） */}
                        {!!session && canHost && project.stage === 'OPENING' && !isSuccess && !isDanger && !isDual && (
                          <button type="button" onClick={() => handleDecrypt(s.id)} disabled={isDecrypting || bulkDecrypting || !!session.pausedAt}
                            className="flex items-center gap-1 text-[11px] font-semibold tracking-tight text-[var(--accent-strong)] transition-colors hover:text-[var(--accent)] disabled:opacity-50">
                            {isDecrypting ? <Loader size={12} className="animate-spin" /> : <Unlock size={12} strokeWidth={1.5} />}
                            {isDecrypting ? '解密中...' : session.pausedAt ? '已暂停' : '解密'}
                          </button>
                        )}
                        {/* T17：双信封 v2——管理方解外层（§5.2；幂等，重复调用返回 skipped） */}
                        {isDual && !outerDone && canAct && canHost && (
                          <button type="button" onClick={() => handleDecryptOuter(s.id)} disabled={isOuterDecrypting || bulkOuterDecrypting}
                            className="flex items-center gap-1 text-[11px] font-semibold tracking-tight text-[var(--accent-strong)] transition-colors hover:text-[var(--accent)] disabled:opacity-50">
                            {isOuterDecrypting ? <Loader size={12} className="animate-spin" /> : <Unlock size={12} strokeWidth={1.5} />}
                            {isOuterDecrypting ? '解外层中...' : '解外层'}
                          </button>
                        )}
                        {/* T17：外层已解、等待供应商自行解密上传（主持端无代解密通道） */}
                        {isDual && outerDone && !isSuccess && !isDanger && (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-[color:var(--muted-foreground)]">
                            <Loader size={12} strokeWidth={1.5} /> 待供应商解密
                          </span>
                        )}
                        {isSuccess && project.stage === 'OPENING' && (
                          !record ? (
                            <button type="button" onClick={() => openRecordEntry(s)} disabled={recordEntryLoading}
                              className="flex items-center gap-1 text-[11px] font-semibold tracking-tight text-[var(--accent-strong)] transition-colors hover:text-[var(--accent)] disabled:opacity-50">
                              <Volume2 size={12} strokeWidth={1.5} /> 唱标
                            </button>
                          ) : record.confirmStatus === '待供应商确认' ? (
                            <button type="button" onClick={() => openRecordEntry(s, true)} disabled={recordEntryLoading}
                              className="flex items-center gap-1 text-[11px] font-semibold tracking-tight text-[color:var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] disabled:opacity-50">
                              <PencilLine size={12} strokeWidth={1.5} /> 重录唱标
                            </button>
                          ) : (
                            <span className="flex items-center gap-1 text-[11px] font-semibold text-[color:var(--muted-foreground)]">
                              <CheckCircle size={12} strokeWidth={1.5} /> 已唱标
                            </span>
                          )
                        )}
                        {/* P1-1：窗口过期后的未解密定性通道（后端已放宽 PENDING/RUNNING）；dual-v2 行改用归因裁决 */}
                        {!!session && remaining <= 0 && project.stage === 'OPENING' && !isSuccess && !isDanger && !isDual && (
                          <button type="button"
                            onClick={async () => {
                              const reason = prompt('解密窗口已过期未解密。请填写定性原因（如：供应商未在窗口内完成解密）：');
                              if (!reason) return;
                              try {
                                await acceptSupplierDanger(project.id, s.id, reason);
                                toast.success('已定性为解密异常（EXCEPTION）');
                                onRefresh();
                              } catch (e: any) { toast.error(e?.message || '操作失败'); }
                            }}
                            className="flex items-center gap-1 text-[11px] font-semibold tracking-tight text-[var(--danger)] transition-colors hover:text-[var(--accent-strong)]">
                            <AlertTriangle size={12} strokeWidth={1.5} /> 接受未解密
                          </button>
                        )}
                        {/* T17：归因裁决入口（UNKNOWN 家 / 窗口关闭后的未归因候选；裁决即落终局） */}
                        {canHost && isDual && !isSuccess && (attribution === 'UNKNOWN' || (!attribution && windowExpired)) && (
                          <button type="button" disabled={adjudgeSubmitting}
                            onClick={() => openAdjudge(s, 'unknown')}
                            className="flex items-center gap-1 text-[11px] font-semibold tracking-tight text-[oklch(0.46_0.11_65)] transition-colors hover:text-[var(--accent-strong)] disabled:opacity-50">
                            <Gavel size={12} strokeWidth={1.5} /> 裁决
                          </button>
                        )}
                        {/* T15 纠错通道：BIDDER→PLATFORM 改判（撤销判定更正为撤回） */}
                        {canHost && isDual && isDanger && attribution === 'BIDDER' && (
                          <button type="button" disabled={adjudgeSubmitting}
                            onClick={() => openAdjudge(s, 'rejudge')}
                            className="flex items-center gap-1 text-[11px] font-semibold tracking-tight text-[var(--warning)] transition-colors hover:text-[var(--accent-strong)] disabled:opacity-50">
                            <Gavel size={12} strokeWidth={1.5} /> 改判平台责任
                          </button>
                        )}
                        {/* T13 硬前置：平台责任家重置解密机会（窗口须开，关闭时隐藏——需先延长窗口） */}
                        {canHost && isDual && isDanger && attribution === 'PLATFORM' && canAct && !windowExpired && (
                          <button type="button" disabled={adjudgeSubmitting}
                            onClick={() => openAdjudge(s, 'reset')}
                            className="flex items-center gap-1 text-[11px] font-semibold tracking-tight text-[var(--success)] transition-colors hover:text-[var(--accent-strong)] disabled:opacity-50">
                            <RotateCcw size={12} strokeWidth={1.5} /> 重置解密机会
                          </button>
                        )}
                        {isDanger && project.stage === 'OPENING' && !resealFailed && !isDual && (
                          <>
                            {/* reseal 端点收口 admin/bid_host——重试仅主持人可见；「接受」(accept-danger) 全角色可办 */}
                            {canHost && (
                            <button type="button"
                              disabled={resealing.has(s.id)}
                              onClick={() => handleReseal(s.id)}
                              className="flex items-center gap-1 text-[11px] font-semibold tracking-tight text-[var(--danger)] transition-colors hover:text-[var(--accent-strong)] disabled:opacity-50">
                              {resealing.has(s.id) ? <Loader size={12} className="animate-spin" /> : <RotateCcw size={12} strokeWidth={1.5} />}
                              重试
                            </button>
                            )}
                            <button type="button"
                              onClick={async () => {
                                const reason = prompt('请填写确认接受解密失败的原因：');
                                if (!reason) return;
                                try {
                                  await acceptSupplierDanger(project.id, s.id, reason);
                                  toast.success('已确认接受解密失败');
                                  onRefresh();
                                } catch (e: any) { toast.error(e?.message || '操作失败'); }
                              }}
                              className="flex items-center gap-1 text-[11px] font-semibold tracking-tight text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]">
                              <AlertTriangle size={12} strokeWidth={1.5} /> 接受
                            </button>
                          </>
                        )}
                        {resealFailed && (
                          <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--danger)]">
                            <AlertTriangle size={12} strokeWidth={1.5} /> 文件已损坏
                          </span>
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

      {/* ═══ A-102/104：保证金到账台账（主持人；bondRequired 项目 OPENING 阶段）═══ */}
      {bondLedgerVisible && (
      <Card>
        <div className="flex items-center justify-between border-b border-[oklch(0.6_0.04_258_/_0.14)] px-6 py-4">
          <h2 className="text-sm font-bold text-[color:var(--foreground)]">保证金到账台账</h2>
          <span className="text-[11px] text-[color:var(--muted-foreground)]">
            {project.bondAmount != null ? `要求缴纳 ${Number(project.bondAmount).toLocaleString('zh-CN')} 元 · ` : '未设金额要求 · '}
            截标 {project.deadline ? new Date(project.deadline).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—'} 前到账
          </span>
        </div>
        {/* 登记表单（一家一条，重复登记按缴纳人覆盖更正） */}
        <div className="border-b border-[oklch(0.6_0.04_258_/_0.12)] bg-[oklch(0.985_0.006_258_/_0.6)] px-6 py-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <label className="text-xs font-semibold text-[color:var(--muted-foreground)]">
              缴纳人
              <select value={bondLedgerForm.supplierName}
                onChange={e => setBondLedgerForm(f => ({ ...f, supplierName: e.target.value }))}
                className="neu-select mt-1 w-full">
                <option value="">— 选择已提交供应商 —</option>
                {project.suppliers.filter(s => s.submitStatus === '已提交').map(s =>
                  <option key={s.id} value={s.supplierName}>{s.supplierName}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-[color:var(--muted-foreground)]">
              金额（元）
              <input type="number" min={0} step="0.01" value={bondLedgerForm.amount}
                onChange={e => setBondLedgerForm(f => ({ ...f, amount: e.target.value }))}
                className="neu-input mt-1 w-full font-mono" placeholder="如 500000" />
            </label>
            <label className="text-xs font-semibold text-[color:var(--muted-foreground)]">
              到账时间
              <input type="datetime-local" value={bondLedgerForm.arrivedAt}
                onChange={e => setBondLedgerForm(f => ({ ...f, arrivedAt: e.target.value }))}
                className="neu-input mt-1 w-full" />
            </label>
            <label className="text-xs font-semibold text-[color:var(--muted-foreground)]">
              收款账户
              <input value={bondLedgerForm.account}
                onChange={e => setBondLedgerForm(f => ({ ...f, account: e.target.value }))}
                className="neu-input mt-1 w-full" placeholder="户名/尾号" />
            </label>
            <label className="text-xs font-semibold text-[color:var(--muted-foreground)]">
              支付形式
              <select value={bondLedgerForm.payMethod}
                onChange={e => setBondLedgerForm(f => ({ ...f, payMethod: e.target.value }))}
                className="neu-select mt-1 w-full">
                <option value="">— 选择 —</option>
                {['转账', '保函', '支票', '其他'].map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-[color:var(--muted-foreground)]">
              备注
              <input value={bondLedgerForm.note}
                onChange={e => setBondLedgerForm(f => ({ ...f, note: e.target.value }))}
                className="neu-input mt-1 w-full" placeholder="选填" />
            </label>
          </div>
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={() => void handleUpsertBondLedger()} disabled={bondLedgerSubmitting}
              className="neu-btn-primary !h-[34px] text-xs disabled:opacity-50">
              {bondLedgerSubmitting ? '登记中…' : '登记到账'}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="neu-table is-dense w-full">
            <thead>
              <tr className="text-[color:var(--muted-foreground)]">
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">缴纳人</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">金额（元）</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">到账时间</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">收款账户</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">支付形式</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">备注</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">台账比对</th>
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody>
              {bondLedgerLoading ? (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-[13px] text-[color:var(--muted-foreground)]">台账加载中…</td></tr>
              ) : bondLedgerError ? (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-[13px] text-[var(--danger)]">台账加载失败：{bondLedgerError}</td></tr>
              ) : bondLedger.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-12 text-center text-[13px] text-[color:var(--muted-foreground)]">暂无到账登记——请在上方按银行到账回单登记</td></tr>
              ) : bondLedger.map(row => {
                // A-104 比对徽标（客户端同口径计算；hasVoucher 维不在台账上下文，跳过）
                const bondIssues = evaluateBondCompliance({
                  hasLedger: true,
                  amount: Number(row.amount),
                  arrivedAt: row.arrivedAt,
                  payMethod: row.payMethod,
                  requiredAmount: project.bondAmount != null ? Number(project.bondAmount) : null,
                  deadline: project.deadline,
                  bondStatus: project.openingRecords.find(r => r.supplierName === row.supplierName)?.bondStatus ?? null,
                });
                return (
                  <tr key={row.id}>
                    <td className="px-5 py-3 font-medium text-[color:var(--foreground)]">{row.supplierName}</td>
                    <td className="px-5 py-3 font-mono font-bold tracking-tight text-[color:var(--foreground)]">{Number(row.amount).toLocaleString('zh-CN')}</td>
                    <td className="px-5 py-3 font-mono text-[11px] tracking-tight text-[color:var(--muted-foreground)]">
                      {new Date(row.arrivedAt).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
                    </td>
                    <td className="px-5 py-3 text-[color:var(--muted-foreground)]">{row.account}</td>
                    <td className="px-5 py-3 text-[color:var(--muted-foreground)]">{row.payMethod}</td>
                    <td className="px-5 py-3 text-[color:var(--muted-foreground)]">{row.note || '—'}</td>
                    <td className="px-5 py-3">
                      {bondIssues.length === 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.71_0.11_164_/_0.16)] px-2 py-0.5 text-[10px] font-semibold text-[var(--success)]">
                          <Shield size={10} strokeWidth={1.7} /> 台账相符
                        </span>
                      ) : (
                        <span title={bondIssues.map(i => i.message).join('；')}
                          className="inline-flex cursor-help items-center gap-1 rounded-full bg-[oklch(0.66_0.175_27_/_0.16)] px-2 py-0.5 text-[10px] font-semibold text-[var(--danger)]">
                          <AlertTriangle size={10} strokeWidth={1.7} /> 不符
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <button type="button" onClick={() => void handleRemoveBondLedger(row)} disabled={bondLedgerDeleting.has(row.id)}
                        className="neu-btn-soft is-danger !h-[26px] !px-2.5 !text-[11px] disabled:opacity-50">
                        {bondLedgerDeleting.has(row.id) ? '删除中…' : '删除'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      )}

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
                <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider">质量承诺</th>
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

      <StartOpeningDialog
        open={startOpen}
        projectId={projectId}
        onClose={() => setStartOpen(false)}
        onStarted={() => {
          setStartOpen(false);
          onRefresh();
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

      {/* ═══ T17：解密失败归因裁决弹窗（unknown/rejudge/reset 三模式共用）═══ */}
      <AdjudicateDialog
        open={adjudgeTarget !== null}
        supplierName={adjudgeTarget?.name ?? ''}
        mode={adjudgeTarget?.mode ?? 'unknown'}
        windowOpen={!windowExpired}
        submitting={adjudgeSubmitting}
        onConfirm={handleAdjudge}
        onClose={() => setAdjudgeTarget(null)}
      />

      {/* ═══ 唱标信息录入（修复开标闭环：解密后主持人补录报价/工期/质量/保证金）═══ */}
      {recordEntry && (
        /* O10（2026-08-28）：遮罩点击不再关弹窗——已填报价/工期草稿易误触丢失，关闭走「取消」按钮 */
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--background)]/60 backdrop-blur-sm">
          <div className="bid-dialog w-[480px] p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-black text-[color:var(--foreground)]">{recordEntry.reentry ? '重录唱标信息' : '录入唱标信息'} — {recordEntry.supplierName}</h3>
            <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">据解密后的投标内容填写，提交后{recordEntry.reentry ? '覆盖原开标记录（供应商尚未确认）' : '生成开标记录（待供应商确认）'}。</p>
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
                质量承诺
                <input value={recordDraft.qualityTarget} onChange={e => setRecordDraft(d => ({ ...d, qualityTarget: e.target.value }))}
                  className="neu-input mt-1 w-full" placeholder="如 满足招标文件要求（按投标承诺）" />
              </label>
              <label className="text-xs font-semibold text-[color:var(--muted-foreground)]">
                保证金
                <select value={recordDraft.bondStatus}
                  onChange={e => setRecordDraft(d => ({ ...d, bondStatus: e.target.value }))}
                  className="neu-select mt-1 w-full">
                  <option value="">— 请核对凭证后选择 —</option>
                  {BOND_STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                {/* A-104：到账台账自动比对提示（null=项目不要求保证金/早期守卫，不渲染）——span 块级化，label 内容模型不含块级元素 */}
                {recordDraft.bondCompliance && (
                  recordDraft.bondCompliance.issues.length > 0 ? (
                    <span className="mt-1 block rounded-[8px] bg-[oklch(0.66_0.175_27_/_0.08)] px-3 py-2 text-[11px] leading-relaxed text-[var(--danger)]">
                      保证金台账比对不符：{recordDraft.bondCompliance.issues.map(i => i.message).join('；')}
                    </span>
                  ) : (
                    <span className="mt-1 block rounded-[8px] bg-[oklch(0.71_0.11_164_/_0.08)] px-3 py-2 text-[11px] text-[var(--success)]">保证金台账比对相符</span>
                  )
                )}
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
              <button type="button" onClick={() => void handleEnterRecord()}
                className="neu-btn-primary !h-[38px] text-xs">提交唱标</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
