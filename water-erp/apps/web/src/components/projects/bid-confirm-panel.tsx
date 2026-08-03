'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AbortDialog } from './bid-confirm/abort-dialog';
import { RoundBlock } from './bid-confirm/round-block';
import {
  AlertTriangle,
  Bell,
  BellRing,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  Gavel,
  RefreshCw,
  Shield,
  Users,
  X,
} from 'lucide-react';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import {
  BID_STAGE_LABELS,
  ensureBidProject,
  getBidProjectDetail,
  getBidWorkspace,
  getPublicityStatus,
  nudgeExperts,
  nudgeSuppliers,
  notifyBidScheduleChange,
  startEvaluation,
  startOpening,
  updateBidProjectSchedule,
  type BidProjectDetail,
  type BidProjectRef,
  type BidWorkspace,
} from '@/lib/api/bid';
import { useBidWebSocket } from '@/hooks/use-bid-websocket';
import { ArchiveBlock } from './bid-confirm/archive-block';
import { ClarificationsBlock } from './bid-confirm/clarifications-block';
import { EvaluationBlock } from './bid-confirm/evaluation-block';
import { OpeningProgressBlock } from './bid-confirm/opening-progress-block';
import { ScoreStandardEditor } from './score-standard/score-standard-editor';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectManagementItem | null;
  round?: number;
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

export function BidConfirmPanel({ isOpen, onClose, project, round, onAbort }: Props) {
  const [bidProject, setBidProject] = useState<BidProjectRef | null>(null);
  const [workspace, setWorkspace] = useState<BidWorkspace | null>(null);
  /** Phase 2：项目全量详情（开标进度/评标管理/澄清答疑/归档四区块共用数据源） */
  const [detail, setDetail] = useState<BidProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  // 延时开标
  const [delayOpen, setDelayOpen] = useState(false);
  const [delayTime, setDelayTime] = useState('');

  // 延时开标后的"是否通知供应商与专家"确认
  const [notifyConfirmOpen, setNotifyConfirmOpen] = useState(false);
  const [pendingOpenTime, setPendingOpenTime] = useState('');
  // B2: 流标串联对话框
  const [abortDialogOpen, setAbortDialogOpen] = useState(false);
  // D1: 专家在线状态
  const [expertOnlineCount, setExpertOnlineCount] = useState(0);

  const showToast = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => setToast({ text, tone }), []);

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
      setDelayTime(toLocalInput(bp.openTime));
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [project]);

  /* ── Phase 2：详情增量刷新（socket 事件驱动，防抖合并高频事件）── */
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshDetail = useCallback(() => {
    if (!bidProject?.id) return;
    getBidProjectDetail(bidProject.id).then(setDetail).catch(() => {});
  }, [bidProject?.id]);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => refreshDetail(), 600);
  }, [refreshDetail]);
  // F12：澄清事件低频，单独计数驱动澄清区块定向重拉（不经 detail 全量刷新）
  const [clarTick, setClarTick] = useState(0);

  /* ── Phase 2：实时事件 → 阶段流转整体重载，过程事件增量刷新详情 ── */
  useBidWebSocket(isOpen ? bidProject?.id : undefined, {
    onStageChange: () => { if (isOpen) void load(); },
    onEvaluationStarted: () => { if (isOpen) void load(); },
    onDecryptStatus: scheduleRefresh,
    onOpeningConfirmed: scheduleRefresh,
    onOpeningDisputed: scheduleRefresh,
    onOpeningDisputeResolved: scheduleRefresh,
    onOpeningCompleted: () => { if (isOpen) void load(); },
    // F6：唱标录入只 emit supervision:log（无开标记录类事件），订阅它使「唱标录入」计数实时回流
    onSupervisionLog: scheduleRefresh,
    onClarificationCreated: () => { scheduleRefresh(); setClarTick(t => t + 1); },
    onClarificationReplied: () => { scheduleRefresh(); setClarTick(t => t + 1); },
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

  // G1: 30s 轮询兜底(防止 WS 静默丢事件导致数据不同步)
  useEffect(() => {
    if (!isOpen || !bidProject?.id) return;
    const timer = setInterval(() => { refreshDetail(); }, 30_000);
    return () => clearInterval(timer);
  }, [isOpen, bidProject?.id, refreshDetail]);

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

  async function handleConfirmOpening() {
    if (!bpId) return;
    await withBusy(async () => {
      await startEvaluation(bpId);
      showToast('已确认开标结果，进入评标');
      await load();
    }, '确认开标结果失败');
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
            <div className="mx-auto max-w-[1080px] space-y-5">
              {/* ▸ 区块2：供应商投标状态 */}
              <SectionCard
                icon={<Users size={14} />}
                title="供应商投标状态"
                accent="var(--stage-supplier)"
                accentSoft="var(--stage-supplier-soft)"
                action={
                  <div className="flex items-center gap-2">
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
                    <button
                      type="button"
                      onClick={() => void handleNudgeSuppliers()}
                      disabled={busy || stats.supplierTotal === 0}
                      className="neu-btn-soft !h-[32px] !text-xs"
                    >
                      <BellRing size={13} /> 催促未投递
                    </button>
                  </div>
                }
              >
                {workspace.suppliers.length === 0 ? (
                  <EmptyHint text="暂无投标供应商。邀请招标/竞价等项目，供应商在投标门户响应后会出现。" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="neu-table w-full min-w-[640px]">
                      <thead>
                        <tr>
                          <th>供应商</th>
                          <th>资质分类</th>
                          <th>投递状态</th>
                          <th>投递时间</th>
                          <th>报价</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workspace.suppliers.map((s) => {
                          const tone = s.submitted ? 'success' : s.withdrawn ? 'warning' : 'muted';
                          const label = s.submitted ? '已投递' : s.withdrawn ? '已撤回' : '未投递';
                          return (
                            <tr key={s.id} className="row-clickable">
                              <td className="font-medium text-[var(--foreground)]">{s.supplierName}</td>
                              <td className="text-[var(--muted-foreground)]">{s.classification || '—'}</td>
                              <td><StatusPill tone={tone}>{label}</StatusPill></td>
                              <td className="tabular-nums text-[var(--muted-foreground)]">{s.submission?.submittedAt ? formatDateTime(s.submission.submittedAt) : '—'}</td>
                              <td className="tabular-nums text-[var(--foreground)]">{s.submission?.bidPrice ? `¥${Number(s.submission.bidPrice).toLocaleString()}` : '—'}</td>
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
                  <button
                    type="button"
                    onClick={() => void handleNudgeExperts()}
                    disabled={busy || stats.expertCount === 0}
                    className="neu-btn-soft !h-[32px] !text-xs"
                  >
                    <Bell size={13} /> 催促确认
                  </button>
                }
              >
                {workspace.experts.length === 0 ? (
                  <EmptyHint text="尚未组建专家组。请先在「专家抽取」步骤完成抽取并通知。" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="neu-table w-full min-w-[640px]">
                      <thead>
                        <tr>
                          <th>专家</th>
                          <th>专业</th>
                          <th>签到</th>
                          <th>回避确认</th>
                          <th>评审进度</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workspace.experts.map((e) => (
                          <tr key={e.id} className="row-clickable">
                            <td className="font-medium text-[var(--foreground)]">{e.expertName}</td>
                            <td className="text-[var(--muted-foreground)]">{e.major || '—'}</td>
                            <td><StatusPill tone={e.signedIn ? 'success' : 'muted'}>{e.signedIn ? '已签到' : '未签到'}</StatusPill></td>
                            <td><StatusPill tone={e.avoidanceConfirmed ? 'success' : 'warning'}>{e.avoidanceConfirmed ? '已确认' : '待确认'}</StatusPill></td>
                            <td className="text-[var(--muted-foreground)]">{e.progress || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </SectionCard>

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

              {/* ▸ 区块5-8（Phase 2 指挥中心）：开标进度 / 评标管理 / 澄清答疑 / 归档
                  —— :3007 开标执行数据经同一 API 回流，各区块按 stage 自行决定渲染 */}
              {/* D1/G2: 专家在线 + 监督时间线 */}
              {bpId && (
                <div className="mb-3 rounded-xl bg-[#f8fbff] px-4 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-3">
                    {expertOnlineCount > 0 && (
                      <span className="flex items-center gap-1 font-semibold text-[var(--success)]">
                        <span className="inline-block h-2 w-2 rounded-full bg-[var(--success)]" />
                        专家在线 {expertOnlineCount} 人
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-[var(--accent)]">
                      <Shield size={12} /> 监督时间线
                    </span>
                  </div>
                  {/* G2: 最近监督日志(滚动时间线) */}
                  {detail?.supervisionLogs && detail.supervisionLogs.length > 0 && (
                    <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                      {detail.supervisionLogs.slice(-10).reverse().map((log: any, i: number) => (
                        <div key={i} className="flex items-start gap-2 text-[11px]">
                          <span className="shrink-0 text-[var(--muted-foreground)] tabular-nums">
                            {new Date(log.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="font-semibold">{log.role}</span>
                          <span className="text-[var(--muted-foreground)]">{log.action}</span>
                          {log.riskFlag === '高风险' && <span className="font-semibold text-[var(--danger)]">⚠</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {bpId && detail && (
                <>
                  <OpeningProgressBlock
                    bidProjectId={bpId}
                    detail={detail}
                    onChanged={refreshDetail}
                    onConfirmOpening={() => void handleConfirmOpening()}
                    onAbort={() => setAbortDialogOpen(true)}
                  />
                  <EvaluationBlock bidProjectId={bpId} detail={detail} onChanged={refreshDetail} />
                  <ClarificationsBlock bidProjectId={bpId} detail={detail} onChanged={refreshDetail} refreshTick={clarTick} />
                  <ArchiveBlock bidProjectId={bpId} detail={detail} onChanged={refreshDetail} />
                  {/* P2c: 多轮报价轮次管理(仅 谈判/竞价 项目) */}
                  <RoundBlock bidProjectId={bpId} detail={detail} onChanged={refreshDetail} />
                  {/* A1: 公示期状态指示（归档后显示） */}
                  {detail?.stage === 'ARCHIVED' && <PublicityBanner bidProjectId={bpId} />}
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
                      <button type="button" onClick={() => setDelayOpen(true)} disabled={busy} className="neu-btn-soft !h-[36px]">
                        <CalendarClock size={14} /> 延时开标
                      </button>
                      <button type="button" onClick={() => void handleStartOpening()} disabled={busy} className="neu-btn-primary !h-[36px]">
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
                </div>
              </div>
            )}
          </div>
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

/** A1: 公示期状态指示——归档后显示公示倒计时 / 期满可发通知书 */
function PublicityBanner({ bidProjectId }: { bidProjectId: string }) {
  const [status, setStatus] = useState<{ hasPublicity: boolean; publicityEnd: string | null; canIssueAward: boolean } | null>(null);

  useEffect(() => {
    getPublicityStatus(bidProjectId).then(setStatus).catch(() => {});
  }, [bidProjectId]);

  if (!status) return null;

  if (!status.hasPublicity) {
    return (
      <div className="exp-alert exp-alert--info flex items-center gap-2 !p-3">
        <Clock size={14} strokeWidth={1.5} className="shrink-0" />
        <span className="text-xs">尚未发布中标公示</span>
      </div>
    );
  }

  if (status.canIssueAward) {
    return (
      <div className="exp-alert exp-alert--success flex items-center gap-2 !p-3">
        <CheckCircle2 size={14} strokeWidth={1.5} className="shrink-0" />
        <span className="text-xs font-semibold">公示期已满，可发出中标通知书</span>
      </div>
    );
  }

  const remaining = status.publicityEnd
    ? Math.ceil((new Date(status.publicityEnd).getTime() - Date.now()) / 86400000)
    : 0;
  return (
    <div className="exp-alert exp-alert--warning flex items-center gap-2 !p-3">
      <Clock size={14} strokeWidth={1.5} className="shrink-0" />
      <span className="text-xs font-semibold">公示期未满，剩余约 {remaining} 天，暂不可发出中标通知书</span>
    </div>
  );
}
