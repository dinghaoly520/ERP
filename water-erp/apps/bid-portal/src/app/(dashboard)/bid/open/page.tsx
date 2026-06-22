'use client';

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { api, enterOpeningRecord, resolveOpeningDispute, getOpeningSessionTime, decryptBid } from '@/lib/api';
import type { BidProjectDetail } from '@/lib/types';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import { TableSkeleton } from '@/components/skeleton';
import StartOpeningDialog from '@/components/start-opening-dialog';
import DecryptConfirmDialog from '@/components/decrypt-confirm-dialog';
import {
  Unlock, Clock, Shield, Play, CheckCircle, AlertTriangle, ChevronRight,
  Volume2, VolumeX, Maximize, Minimize, Zap, Loader,
} from 'lucide-react';
import { PageHero, SectionCard } from '@water-erp/ui';
import { useBidWebSocket } from '@/hooks/use-bid-websocket';
import { ConnectionIndicator } from '@/components/connection-indicator';
import NoProjectGuide from '@/components/no-project-guide';
import { DECRYPT_LABEL, SEMANTIC } from '@water-erp/shared';
import { toast } from 'sonner';

const decryptColors: Record<string, { color: string; bg: string }> = {
  PENDING: { color: SEMANTIC.warning, bg: '#fef6e8' },
  RUNNING: { color: SEMANTIC.info, bg: '#eef4fc' },
  SUCCESS: { color: SEMANTIC.success, bg: '#f0faf6' },
  DANGER: { color: SEMANTIC.danger, bg: '#fef2f2' },
};

const STAGES = ['投递中', '解密中', '确认中', '已完成'] as const;

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

/* ── Ring Countdown ── */
function RingCountdown({ remaining, big }: { remaining: number; big?: boolean }) {
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const pct = Math.min(1, remaining / (60 * 30)); // 30-min window baseline
  const radius = big ? 47 : 37;
  const cx = big ? 50 : 40;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * pct;
  const isUrgent = remaining <= 60;
  const ringColor = isUrgent ? '#e74c3c' : remaining <= 300 ? '#f5a623' : '#ffffff';
  const size = big ? 100 : 80;
  const fontSize = big ? 'text-2xl' : 'text-lg';
  const labelSize = big ? 'text-[10px]' : 'text-[9px]';
  return (
    <div className={`relative inline-flex items-center justify-center ${big ? 'scale-125' : ''}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90" style={{ overflow: 'visible' }}>
        <circle cx={cx} cy={cx} r={radius} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={6} />
        <circle cx={cx} cy={cx} r={radius} fill="none" stroke={ringColor} strokeWidth={6}
          strokeDasharray={`${dash} ${circumference}`} strokeLinecap="round"
          className="transition-all duration-1000" />
      </svg>
      <div className="relative z-10 flex flex-col items-center">
        <div className={`font-mono font-black tracking-tight ${fontSize} ${isUrgent ? 'animate-pulse' : ''}`}
          style={{ color: ringColor }}>
          {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
        </div>
        <div className={`${labelSize} text-white/50 uppercase tracking-widest`}>剩余</div>
      </div>
    </div>
  );
}

/* ── Stage Stepper ── */
function StageStepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1">
      {STAGES.map((label, i) => (
        <div key={label} className="flex items-center gap-1">
          <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold transition-all duration-500 ${
            i === step ? 'bg-white/20 text-white' : i < step ? 'text-white/50' : 'text-white/25'
          }`}>
            {i < step ? <CheckCircle size={11} /> : i === step ? <span className={`h-2 w-2 rounded-full ${i < 3 ? 'animate-pulse bg-white' : 'bg-white'}`} /> : <span className="h-2 w-2 rounded-full bg-white/20" />}
            {label}
          </div>
          {i < STAGES.length - 1 && <span className="w-4 h-px bg-white/15" />}
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
  const [openingSubmission, setOpeningSubmission] = useState(false);

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
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [bigScreen, setBigScreen] = useState(false);
  const [inlineDispute, setInlineDispute] = useState<string | null>(null);
  const [disputeHandleResult, setDisputeHandleResult] = useState('');
  const [disputeHandleConfirm, setDisputeHandleConfirm] = useState<'confirmed' | 'rejected' | null>(null);
  const [recordEntry, setRecordEntry] = useState<{ bidSupplierId: string; supplierName: string } | null>(null);
  const [recordDraft, setRecordDraft] = useState({ amount: '', period: '', qualityTarget: '', bondStatus: '' });
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
      case '供应商已确认': return { label: '供应商已确认', color: '#11a874', bg: '#f0faf6' };
      case '供应商提出异议': return { label: '供应商提出异议', color: '#e74c3c', bg: '#fef2f2' };
      case '异议已处理-确认': return { label: '异议已处理', color: '#11a874', bg: '#f0faf6' };
      case '异议已处理-退回': return { label: '异议已退回', color: '#6b7280', bg: '#f3f4f6' };
      case '待供应商确认': return { label: '待供应商确认', color: '#f5a623', bg: '#fef6e8' };
      default: return { label: status || '待确认', color: '#6b7280', bg: '#f3f4f6' };
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

  // ═══ API ═══
  const handleResolveDispute = async (recordId: string, result: string, confirm: boolean) => {
    if (!projectId) return;
    await resolveOpeningDispute(projectId, recordId, { result, confirm });
    const updated = await api.get<BidProjectDetail>(`/bid/projects/${projectId}`);
    setProject(updated);
    setInlineDispute(null);
    setDisputeHandleResult('');
    setDisputeHandleConfirm(null);
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

  const handleOpenSubmission = async () => {
    setOpeningSubmission(true);
    try {
      await api.post(`/bid/projects/${projectId}/open-submission`, {});
      const updated = await api.get<BidProjectDetail>(`/bid/projects/${projectId}`);
      setProject(updated);
    } catch (e: any) {
      toast.error(e.message || '操作失败');
    } finally {
      setOpeningSubmission(false);
    }
  };

  const openRecordEntry = (s: { id: string; supplierName: string }) => {
    setRecordEntry({ bidSupplierId: s.id, supplierName: s.supplierName });
    setRecordDraft({ amount: '', period: '', qualityTarget: '', bondStatus: '' });
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
    } catch (e: any) { toast.error(e.message || '录入失败'); }
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
  });

  // Connection indicator: report WS state for UI

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
        <AlertTriangle size={32} strokeWidth={1.5} className="text-[#e74c3c] mb-4" />
        <p className="text-sm font-semibold text-[#5a6d8a] mb-4">{error}</p>
        <button
          onClick={loadProject}
          className="rounded-xl bg-[#064ea2] px-4 py-2 text-xs font-bold text-white hover:bg-[#0b63ce] transition"
        >
          重试
        </button>
      </div>
    );
  }
  if (!project) return <div className="text-[13px] text-[oklch(0.62_0.008_264)] text-center py-20 tracking-tight">暂无项目数据</div>;
  if (!projectId) return null;

  return (
    <div className={`space-y-5 ${bigScreen ? 'text-[115%]' : ''}`}>
      {/* ═══ PageHero with controls ═══ */}
      <PageHero
        tone="blue"
        icon={<Unlock size={14} strokeWidth={1.5} />}
        title="在线开标大厅"
        description="到时自动提取投标文件 · 提示在线解密 · 生成开标记录"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setSoundEnabled(!soundEnabled)}
              title={`音效${soundEnabled ? '开' : '关'} (S)`}
              className="rounded-xl border border-[#e5ecf4] bg-white p-2 text-[#5a6d8a] hover:border-[#064ea2] hover:text-[#064ea2] transition">
              {soundEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
            <button onClick={() => setBigScreen(!bigScreen)}
              title={`${bigScreen ? '退出' : '开启'}大屏模式 (M)`}
              className="rounded-xl border border-[#e5ecf4] bg-white p-2 text-[#5a6d8a] hover:border-[#064ea2] hover:text-[#064ea2] transition">
              {bigScreen ? <Minimize size={14} /> : <Maximize size={14} />}
            </button>
            <ConnectionIndicator connection={connection} lastEventAt={lastEventAt} onReconnect={reconnectNow} />
          </div>
        }
      />

      {/* ═══ Time warning banners ═══ */}
      {timeWarning === '5min' && (
        <div className="rounded-xl border border-[#fcd34d] bg-[#fffbeb] px-4 py-2.5 text-sm font-bold text-[#92400e] flex items-center gap-2 animate-pulse">
          <AlertTriangle size={16} /> 解密窗口将在 5 分钟内关闭，请尽快完成解密操作
        </div>
      )}
      {timeWarning === '1min' && (
        <div className="rounded-xl border border-[#e74c3c] bg-[#fef2f2] px-4 py-2.5 text-sm font-bold text-[#e74c3c] flex items-center gap-2">
          <AlertTriangle size={16} className="animate-pulse" /> 解密窗口仅剩 1 分钟！
        </div>
      )}

      {/* ═══ Session header with ring countdown + stage stepper ═══ */}
      {session && (
        <div className="glass-card glass-card-blue rounded-2xl text-white p-6 space-y-4" style={{ background: 'linear-gradient(135deg, rgba(6,78,162,0.92), rgba(11,99,206,0.88))' }}>
          <div className="flex items-center gap-8 flex-wrap">
            <div className="flex-1 min-w-0">
              <h2 className={`font-black tracking-tight mb-2 ${bigScreen ? 'text-2xl' : 'text-lg'}`}>
                {project.name}
              </h2>
              <div className="flex items-center gap-6 text-sm text-white/60 flex-wrap">
                <span className="flex items-center gap-1.5"><Clock size={13} strokeWidth={1.5} /> {new Date(project.openTime).toLocaleString('zh-CN')}</span>
                <span>主持人：{session.host}</span>
                <span>监督人：{session.supervisor}</span>
              </div>
            </div>
            <div className="bg-white/10 rounded-xl px-6 py-3 text-center">
              <div className="text-xs text-white/40 uppercase tracking-widest mb-1">状态</div>
              <div className="text-lg font-black tracking-tight">{session.status}</div>
            </div>
            {remaining > 0 && <RingCountdown remaining={remaining} big={bigScreen} />}
          </div>
          <StageStepper step={stageStep} />
        </div>
      )}

      {/* ═══ Decrypt status table ═══ */}
      <SectionCard className="overflow-hidden p-0">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5ecf4] flex-wrap gap-3">
          <h2 className="text-sm font-black text-[#18243a]">
            投标人在线解密状态
          </h2>
          <div className="flex items-center gap-2">
            {project.stage === 'DOWNLOAD' && (
              <button onClick={handleOpenSubmission} disabled={openingSubmission}
                className="flex items-center gap-1.5 rounded-xl bg-[#11a874] px-4 py-2 text-xs font-bold text-white hover:bg-[#0e8c5f] transition disabled:opacity-50">
                <ChevronRight size={13} strokeWidth={2} /> {openingSubmission ? '处理中…' : '开放投递'}
              </button>
            )}
            {project.stage === 'SUBMIT' && (() => {
              const deadlinePassed = new Date() >= new Date(project.deadline);
              return (
              <button onClick={() => setStartOpen(true)}
                disabled={!deadlinePassed}
                title={deadlinePassed ? '启动开标' : '尚未截标——投标截止时间未到，无法启动开标'}
                className={`flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-white transition ${
                  deadlinePassed
                    ? 'bg-[#064ea2] hover:bg-[#054280]'
                    : 'bg-[#94a3b8] cursor-not-allowed'
                }`}>
                <Play size={13} strokeWidth={2} /> {deadlinePassed ? '启动开标' : '尚未截标'}
              </button>
            )})()}
            {!!session && project.stage === 'OPENING' && decryptProgress.total > 0 && decryptProgress.pending > 0 && (
              <button onClick={handleBulkDecrypt} disabled={bulkDecrypting}
                className="flex items-center gap-1.5 rounded-xl border border-[#f5a623] bg-[#fef6e8] px-4 py-2 text-xs font-bold text-[#92400e] hover:bg-[#fef0c0] transition disabled:opacity-50">
                <Zap size={13} /> {bulkDecrypting ? '批量解密中...' : `全部解密 (${decryptProgress.pending})`}
              </button>
            )}
          </div>
        </div>

        {/* Decrypt progress bar */}
        {decryptProgress.total > 0 && (
          <div className="px-6 py-3 border-b border-[#edf2f7] bg-[#fafbfc]">
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-semibold text-[#5a6d8a] uppercase tracking-wider whitespace-nowrap">解密进度</span>
              <div className="flex-1 h-2 rounded-full bg-[#edf2f7] overflow-hidden">
                <div className="h-full rounded-full transition-all duration-700 flex" style={{ width: `${decryptProgress.pct * 100}%` }}>
                  <div className="h-full bg-[#11a874] transition-all" style={{ width: `${decryptProgress.total ? (decryptProgress.success / decryptProgress.total) * 100 : 0}%` }} />
                  <div className="h-full bg-[#e74c3c]" style={{ width: `${decryptProgress.total ? (decryptProgress.danger / decryptProgress.total) * 100 : 0}%` }} />
                </div>
              </div>
              <span className="text-[11px] font-mono font-bold tabular-nums text-[#18243a]">
                <span className="text-[#11a874]">{decryptProgress.success}</span>
                {decryptProgress.danger > 0 && <span className="text-[#e74c3c]">/{decryptProgress.danger}</span>}
                <span className="text-[#5a6d8a]">/{decryptProgress.total}</span>
                <span className="text-[#8a99ad] ml-1">({Math.round(decryptProgress.pct * 100)}%)</span>
              </span>
            </div>
          </div>
        )}

        <table className="workbench-table">
          <thead>
            <tr className="text-[oklch(0.55_0.01_264)]">
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">投标单位</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">回执编号</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">密文状态</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">解密状态</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">确认</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">操作</th>
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
                  <td className="px-5 py-3 font-medium text-[oklch(0.18_0.012_265)] relative">
                    {s.supplierName}
                    {/* Scanning line overlay for RUNNING */}
                    {isRunning && (
                      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#064ea2]/8 to-transparent animate-[scan_1.5s_linear_infinite]" />
                    )}
                  </td>
                  <td className="px-5 py-3 font-mono text-[oklch(0.42_0.14_260)] tracking-tight">{s.receiptNo || '—'}</td>
                  <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{s.encryptStatus}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 tracking-wide ${isRunning ? 'animate-pulse' : ''}`}
                      style={{ color: c.color, backgroundColor: c.bg }}>
                      {isRunning && <Loader size={10} className="animate-spin" />}
                      {label}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {s.confirmStatus === 'CONFIRMED' ? (
                      <span className="flex items-center gap-1 text-[oklch(0.54_0.16_158)] text-[12px]"><CheckCircle size={12} strokeWidth={1.5} /> 已确认</span>
                    ) : s.confirmStatus === 'EXCEPTION' ? (
                      <span className="flex items-center gap-1 text-[oklch(0.50_0.18_22)] text-[12px]"><AlertTriangle size={12} strokeWidth={1.5} /> 异常</span>
                    ) : (
                      <span className="text-[oklch(0.62_0.008_264)] text-[12px]">待确认</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      {!!session && project.stage === 'OPENING' && s.decryptStatus !== 'SUCCESS' && (
                        <button onClick={() => handleDecrypt(s.id)} disabled={isDecrypting || bulkDecrypting}
                          className="flex items-center gap-1 text-[11px] font-semibold text-[oklch(0.42_0.14_260)] hover:text-[oklch(0.50_0.16_258)] tracking-tight transition-colors disabled:opacity-50">
                          {isDecrypting ? <Loader size={12} className="animate-spin" /> : <Unlock size={12} strokeWidth={1.5} />}
                          {isDecrypting ? '解密中...' : '解密'}
                        </button>
                      )}
                      {isSuccess && project.stage === 'OPENING' && (
                        <button onClick={() => openRecordEntry(s)}
                          className="flex items-center gap-1 text-[11px] font-semibold text-[oklch(0.42_0.14_260)] hover:text-[oklch(0.50_0.16_258)] tracking-tight transition-colors">
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
      </SectionCard>

      {/* ═══ Opening records ═══ */}
      <SectionCard className="overflow-hidden p-0">
        <div className="px-6 py-4 border-b border-[#e5ecf4] flex items-center justify-between">
          <h2 className="text-sm font-black text-[#18243a]">
            开标记录
          </h2>
          <span className="text-[11px] text-[oklch(0.62_0.008_264)]">
            {sortedRecords.length} 条 · 异议先行
          </span>
        </div>
        <table className="workbench-table">
          <thead>
            <tr className="text-[oklch(0.55_0.01_264)]">
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">供应商</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">报价</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">工期</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">质量</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">保证金</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">确认状态</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody>
            {sortedRecords.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-12 text-center text-[13px] text-[oklch(0.62_0.008_264)]">暂无开标记录</td></tr>
            ) : sortedRecords.map((r) => {
              const sm = openingStatusMeta(r.confirmStatus);
              const isDisputed = r.confirmStatus === '供应商提出异议';
              const disputeOpen = inlineDispute === r.id;
              return (
                <React.Fragment key={r.id}>
                  <tr className={`align-top transition-colors ${
                    isDisputed ? 'border-l-4 border-l-[#e74c3c] bg-[#fef9f9]' : ''
                  }`}>
                    <td className="px-5 py-3 font-medium text-[oklch(0.18_0.012_265)]">
                      {r.supplierName}
                      {r.objectionReason && <div className="text-[11px] text-[oklch(0.50_0.18_22)] mt-1 font-normal">异议：{r.objectionReason}</div>}
                      {r.handleResult && <div className="text-[11px] text-[oklch(0.55_0.01_264)] mt-1 font-normal">处理：{r.handleResult}</div>}
                    </td>
                    <td className="px-5 py-3 font-mono font-bold text-[oklch(0.18_0.012_265)] tracking-tight">{r.amount}</td>
                    <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{r.period}</td>
                    <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{r.qualityTarget}</td>
                    <td className="px-5 py-3 text-[oklch(0.55_0.01_264)]">{r.bondStatus}</td>
                    <td className="px-5 py-3">
                      <span className="text-[11px] font-semibold px-2 py-0.5 tracking-wide" style={{ color: sm.color, backgroundColor: sm.bg }}>{sm.label}</span>
                    </td>
                    <td className="px-5 py-3">
                      {isDisputed && project.stage === 'OPENING' && (
                        <button onClick={() => { setInlineDispute(disputeOpen ? null : r.id); setDisputeHandleResult(''); setDisputeHandleConfirm(null); }}
                          className={`flex items-center gap-1 text-[11px] font-semibold tracking-tight transition-colors ${
                            disputeOpen ? 'text-[oklch(0.55_0.01_264)]' : 'text-[oklch(0.42_0.14_260)] hover:text-[oklch(0.50_0.16_258)]'
                          }`}>
                          <Shield size={12} strokeWidth={1.5} /> {disputeOpen ? '收起处理' : '处理异议'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {/* Inline dispute handling panel */}
                  {disputeOpen && (
                    <tr key={`${r.id}-dispute`}>
                      <td colSpan={7} className="bg-[#fafbfc] border-b border-[#fcd34d]">
                        <div className="px-5 py-4 space-y-3">
                          <div className="flex items-start gap-2">
                            <Shield size={14} className="mt-0.5 text-[#92400e] flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-sm font-bold text-[#18243a] mb-0.5">处理 {r.supplierName} 的异议</p>
                              {r.objectionReason && (
                                <p className="text-xs text-[#5a6d8a] mb-2">异议原因：{r.objectionReason}</p>
                              )}
                              <textarea
                                value={disputeHandleResult}
                                onChange={e => setDisputeHandleResult(e.target.value)}
                                placeholder="输入处理结果说明..."
                                className="w-full rounded-xl border border-[#dce6f3] px-3 py-2 text-xs focus:outline-none focus:border-[#064ea2] h-20 resize-y"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-2 justify-end">
                            <button onClick={() => setInlineDispute(null)}
                              className="rounded-lg px-4 py-2 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] border border-[#dce6f3] transition">取消</button>
                            <button onClick={() => handleResolveDispute(r.id, disputeHandleResult, false)}
                              className="rounded-lg px-4 py-2 text-xs font-bold text-[#e74c3c] hover:bg-red-50 border border-[#e74c3c] transition disabled:opacity-50"
                              disabled={!disputeHandleResult.trim()}>退回异议</button>
                            <button onClick={() => handleResolveDispute(r.id, disputeHandleResult, true)}
                              className="rounded-lg px-4 py-2 text-xs font-bold text-white bg-[#11a874] hover:bg-[#0e8c5f] transition disabled:opacity-50"
                              disabled={!disputeHandleResult.trim()}>确认受理</button>
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
      </SectionCard>

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setRecordEntry(null)}>
          <div className="w-[480px] rounded-2xl glass-card-deeper glass-card-blue p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-black text-[#18243a]">录入唱标信息 — {recordEntry.supplierName}</h3>
            <p className="mt-1 text-xs text-[#8a96aa]">据解密后的投标内容填写，提交后生成开标记录（待供应商确认）。</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-[#5a6d8a]">
                报价（元）
                <input value={recordDraft.amount} onChange={e => setRecordDraft(d => ({ ...d, amount: e.target.value }))}
                  className="workbench-input mt-1 w-full font-mono" placeholder="如 980000" />
              </label>
              <label className="text-xs font-semibold text-[#5a6d8a]">
                工期
                <input value={recordDraft.period} onChange={e => setRecordDraft(d => ({ ...d, period: e.target.value }))}
                  className="workbench-input mt-1 w-full" placeholder="如 180天" />
              </label>
              <label className="text-xs font-semibold text-[#5a6d8a]">
                质量目标
                <input value={recordDraft.qualityTarget} onChange={e => setRecordDraft(d => ({ ...d, qualityTarget: e.target.value }))}
                  className="workbench-input mt-1 w-full" placeholder="如 合格" />
              </label>
              <label className="text-xs font-semibold text-[#5a6d8a]">
                保证金
                <input value={recordDraft.bondStatus} onChange={e => setRecordDraft(d => ({ ...d, bondStatus: e.target.value }))}
                  className="workbench-input mt-1 w-full" placeholder="如 已缴纳" />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setRecordEntry(null)}
                className="rounded-xl border border-[#dce6f3] px-4 py-2 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc]">取消</button>
              <button onClick={handleEnterRecord}
                className="rounded-xl bg-[#064ea2] px-4 py-2 text-xs font-bold text-white hover:bg-[#054280]">提交唱标</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
