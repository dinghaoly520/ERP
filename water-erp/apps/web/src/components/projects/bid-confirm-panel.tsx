'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellRing,
  BookmarkPlus,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileDown,
  FileText,
  Gavel,
  Pencil,
  PlusCircle,
  RefreshCw,
  Save,
  Shield,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { ProjectManagementItem } from '@/lib/types/project-management';
import {
  applySavedScoreTemplate,
  applyScoreTemplate,
  BID_STAGE_LABELS,
  SCORE_CATEGORY_LABELS,
  createScoreItem,
  createScorePoint,
  deleteScoreItem,
  deleteScorePoint,
  deleteScoreTemplate,
  ensureBidProject,
  getBidProjectDetail,
  getBidWorkspace,
  listScoreItems,
  listScorePoints,
  listScoreTemplates,
  nudgeExperts,
  nudgeSuppliers,
  notifyBidScheduleChange,
  saveScoreTemplate,
  startOpening,
  updateBidProjectSchedule,
  updateScoreItem,
  updateScorePoint,
  type BidProjectDetail,
  type BidProjectRef,
  type BidScoreItem,
  type BidScorePoint,
  type BidWorkspace,
  type ScoreCategory,
  type ScoreTemplateRef,
} from '@/lib/api/bid';
import { useBidWebSocket } from '@/hooks/use-bid-websocket';
import { ArchiveBlock } from './bid-confirm/archive-block';
import { ClarificationsBlock } from './bid-confirm/clarifications-block';
import { EvaluationBlock } from './bid-confirm/evaluation-block';
import { OpeningProgressBlock } from './bid-confirm/opening-progress-block';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectManagementItem | null;
  round?: number;
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

const SCORE_CATEGORIES = Object.keys(SCORE_CATEGORY_LABELS) as ScoreCategory[];

export function BidConfirmPanel({ isOpen, onClose, project, round }: Props) {
  const [bidProject, setBidProject] = useState<BidProjectRef | null>(null);
  const [workspace, setWorkspace] = useState<BidWorkspace | null>(null);
  const [scoreItems, setScoreItems] = useState<BidScoreItem[]>([]);
  /** Phase 2：项目全量详情（开标进度/评标管理/澄清答疑/归档四区块共用数据源） */
  const [detail, setDetail] = useState<BidProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  // 延时开标
  const [delayOpen, setDelayOpen] = useState(false);
  const [delayTime, setDelayTime] = useState('');

  // 评分项：新增 / 编辑
  const [newItem, setNewItem] = useState<{ name: string; category: ScoreCategory; maxScore: string } | null>(null);
  const [editingItem, setEditingItem] = useState<{ id: string; name: string; category: ScoreCategory; maxScore: string } | null>(null);

  // 得分点（评分细则）：展开 / 缓存 / 新增 / 编辑
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [pointsByItem, setPointsByItem] = useState<Record<string, BidScorePoint[]>>({});
  const [pointsLoading, setPointsLoading] = useState<Set<string>>(new Set());
  const [newPoint, setNewPoint] = useState<{ itemId: string; name: string; fullScore: string; evidenceHint: string } | null>(null);
  const [editingPoint, setEditingPoint] = useState<{ itemId: string; pointId: string; name: string; fullScore: string; evidenceHint: string } | null>(null);

  // 评分模板（整套评分标准的保存 / 复用）
  const [templates, setTemplates] = useState<ScoreTemplateRef[]>([]);
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplListOpen, setTplListOpen] = useState(false);

  // 延时开标后的"是否通知供应商与专家"确认
  const [notifyConfirmOpen, setNotifyConfirmOpen] = useState(false);
  const [pendingOpenTime, setPendingOpenTime] = useState('');

  const showToast = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => setToast({ text, tone }), []);

  const load = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      listScoreTemplates().then(setTemplates).catch(() => { /* 模板加载失败不阻塞主流程 */ });
      const bp = await ensureBidProject(project.id, round);
      setBidProject(bp);
      const [ws, items, dt] = await Promise.all([
        getBidWorkspace(bp.id),
        listScoreItems(bp.id),
        getBidProjectDetail(bp.id).catch(() => null),
      ]);
      setWorkspace(ws);
      setScoreItems(items);
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

  /* ── Phase 2：实时事件 → 阶段流转整体重载，过程事件增量刷新详情 ── */
  useBidWebSocket(isOpen ? bidProject?.id : undefined, {
    onStageChange: () => { if (isOpen) void load(); },
    onEvaluationStarted: () => { if (isOpen) void load(); },
    onDecryptStatus: scheduleRefresh,
    onOpeningConfirmed: scheduleRefresh,
    onOpeningDisputed: scheduleRefresh,
    onOpeningDisputeResolved: scheduleRefresh,
    // F6：唱标录入只 emit supervision:log（无开标记录类事件），订阅它使「唱标录入」计数实时回流
    onSupervisionLog: scheduleRefresh,
    onClarificationCreated: scheduleRefresh,
    onClarificationReplied: scheduleRefresh,
    onExpertPresence: scheduleRefresh,
  });

  /* eslint-disable react-hooks/set-state-in-effect -- 弹窗打开加载 / 关闭重置，符合模态惯例 */
  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  useEffect(() => {
    if (!isOpen) {
      setBidProject(null);
      setWorkspace(null);
      setScoreItems([]);
      setDetail(null);
      setError(null);
      setToast(null);
      setDelayOpen(false);
      setNewItem(null);
      setEditingItem(null);
      setExpandedItems(new Set());
      setPointsByItem({});
      setPointsLoading(new Set());
      setNewPoint(null);
      setEditingPoint(null);
      setTemplates([]);
      setSaveTplOpen(false);
      setTplName('');
      setTplListOpen(false);
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

  /* ── 评分项 CRUD ── */
  async function handleCreateItem() {
    if (!bpId || !newItem) return;
    const ms = Number(newItem.maxScore);
    if (!newItem.name.trim() || Number.isNaN(ms)) {
      showToast('请填写分项名称与分值', 'err');
      return;
    }
    await withBusy(async () => {
      const created = await createScoreItem(bpId, { category: newItem.category, name: newItem.name.trim(), maxScore: ms });
      setScoreItems((prev) => [...prev, created]);
      setNewItem(null);
      showToast('已新增评分项');
    }, '新增失败');
  }

  async function handleSaveItem() {
    if (!bpId || !editingItem) return;
    const ms = Number(editingItem.maxScore);
    if (!editingItem.name.trim() || Number.isNaN(ms)) {
      showToast('请填写分项名称与分值', 'err');
      return;
    }
    await withBusy(async () => {
      const updated = await updateScoreItem(bpId, editingItem.id, { category: editingItem.category, name: editingItem.name.trim(), maxScore: ms });
      setScoreItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)));
      setEditingItem(null);
      showToast('已保存');
    }, '保存失败');
  }

  async function handleDeleteItem(itemId: string) {
    if (!bpId) return;
    await withBusy(async () => {
      await deleteScoreItem(bpId, itemId);
      setScoreItems((prev) => prev.filter((it) => it.id !== itemId));
      showToast('已删除');
    }, '删除失败');
  }

  async function handleApplyTemplate() {
    if (!bpId) return;
    await withBusy(async () => {
      const items = await applyScoreTemplate(bpId);
      setScoreItems(items);
      showToast('已应用标准评分模板');
    }, '应用模板失败');
  }

  /* ── 得分点（细则）展开 / CRUD ── */
  async function loadPoints(itemId: string) {
    if (!bpId) return;
    setPointsLoading((prev) => new Set(prev).add(itemId));
    try {
      const pts = await listScorePoints(bpId, itemId);
      setPointsByItem((prev) => ({ ...prev, [itemId]: pts }));
    } catch (e) {
      showToast(e instanceof Error ? e.message : '加载细则失败', 'err');
    } finally {
      setPointsLoading((prev) => {
        const n = new Set(prev);
        n.delete(itemId);
        return n;
      });
    }
  }

  async function toggleExpand(itemId: string) {
    const isOpen = expandedItems.has(itemId);
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
    if (!isOpen && !pointsByItem[itemId]) {
      await loadPoints(itemId);
    }
  }

  async function handleCreatePoint(itemId: string) {
    if (!bpId || !newPoint) return;
    const fs = Number(newPoint.fullScore);
    if (!newPoint.name.trim() || Number.isNaN(fs)) {
      showToast('请填写细则名称与分值', 'err');
      return;
    }
    await withBusy(async () => {
      const created = await createScorePoint(bpId, itemId, {
        name: newPoint.name.trim(),
        fullScore: fs,
        evidenceHint: newPoint.evidenceHint.trim() || undefined,
      });
      setPointsByItem((prev) => ({ ...prev, [itemId]: [...(prev[itemId] ?? []), created] }));
      setNewPoint(null);
      showToast('已新增细则');
    }, '新增细则失败');
  }

  async function handleSavePoint(itemId: string) {
    if (!bpId || !editingPoint) return;
    const fs = Number(editingPoint.fullScore);
    if (!editingPoint.name.trim() || Number.isNaN(fs)) {
      showToast('请填写细则名称与分值', 'err');
      return;
    }
    await withBusy(async () => {
      const updated = await updateScorePoint(bpId, itemId, editingPoint.pointId, {
        name: editingPoint.name.trim(),
        fullScore: fs,
        evidenceHint: editingPoint.evidenceHint.trim() || undefined,
      });
      setPointsByItem((prev) => ({
        ...prev,
        [itemId]: (prev[itemId] ?? []).map((p) => (p.id === updated.id ? updated : p)),
      }));
      setEditingPoint(null);
      showToast('已保存');
    }, '保存细则失败');
  }

  async function handleDeletePoint(itemId: string, pointId: string) {
    if (!bpId) return;
    await withBusy(async () => {
      await deleteScorePoint(bpId, itemId, pointId);
      setPointsByItem((prev) => ({
        ...prev,
        [itemId]: (prev[itemId] ?? []).filter((p) => p.id !== pointId),
      }));
      showToast('已删除细则');
    }, '删除细则失败');
  }

  /* ── 评分模板 ── */
  async function handleSaveTemplate() {
    if (!bpId) return;
    const name = tplName.trim();
    if (!name) {
      showToast('请输入模板名称', 'err');
      return;
    }
    await withBusy(async () => {
      const created = await saveScoreTemplate(bpId, name);
      setTemplates((prev) => [created, ...prev]);
      setTplName('');
      setSaveTplOpen(false);
      showToast(`已保存模板「${created.name}」`);
    }, '保存模板失败');
  }

  async function handleApplySavedTemplate(templateId: string) {
    if (!bpId) return;
    await withBusy(async () => {
      const items = await applySavedScoreTemplate(bpId, templateId);
      setScoreItems(items);
      // 结构可能变化，清空得分点缓存与展开态
      setPointsByItem({});
      setExpandedItems(new Set());
      setTplListOpen(false);
      showToast('已应用模板');
    }, '应用模板失败');
  }

  async function handleDeleteTemplate(templateId: string) {
    await withBusy(async () => {
      await deleteScoreTemplate(templateId);
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
      showToast('已删除模板');
    }, '删除模板失败');
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

              {/* ▸ 区块4：评分标准编制 */}
              <SectionCard
                icon={<FileText size={14} />}
                title="评分标准编制"
                accent="var(--stage-evaluation)"
                accentSoft="var(--stage-evaluation-soft)"
                action={
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <button type="button" onClick={() => { setSaveTplOpen((v) => !v); setTplListOpen(false); }} disabled={busy || scoreItems.length === 0} className="neu-btn-soft !h-[32px] !text-xs" title="把当前评分标准（含得分点）存为可复用模板">
                      <BookmarkPlus size={13} /> 保存为模板
                    </button>
                    <button type="button" onClick={() => { setTplListOpen((v) => !v); setSaveTplOpen(false); }} disabled={busy} className="neu-btn-soft !h-[32px] !text-xs" title="应用已保存的模板">
                      <FileDown size={13} /> 我的模板
                    </button>
                    <button type="button" onClick={() => void handleApplyTemplate()} disabled={busy} className="neu-btn-soft !h-[32px] !text-xs" title="应用五类标准评分项模板">
                      应用标准模板
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewItem({ name: '', category: 'TECHNICAL', maxScore: '10' })}
                      disabled={busy || !!newItem}
                      className="neu-btn-primary !h-[32px] !text-xs"
                    >
                      <PlusCircle size={13} /> 新增分项
                    </button>
                  </div>
                }
              >
                {/* 保存为模板 / 应用模板 inline 区 */}
                {saveTplOpen && (
                  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[14px] px-3 py-2.5" style={{ background: 'oklch(0.975 0.012 258 / 0.5)', boxShadow: 'inset 2px 2px 5px oklch(0.55 0.03 258 / 0.08), inset -1px -1px 3px oklch(1 0 0 / 0.5)' }}>
                    <BookmarkPlus size={14} className="text-[var(--accent)]" />
                    <span className="text-xs font-semibold text-[var(--foreground)]">模板名称</span>
                    <input className="workbench-input !h-[32px] min-w-[200px] flex-1" value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="如：通用工程类评分模板" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveTemplate(); }} />
                    <button type="button" onClick={() => void handleSaveTemplate()} disabled={busy} className="neu-btn-primary !h-[32px] !text-xs">保存</button>
                    <button type="button" onClick={() => { setSaveTplOpen(false); setTplName(''); }} className="neu-btn-soft !h-[32px] !text-xs">取消</button>
                  </div>
                )}
                {tplListOpen && (
                  <div className="mb-3 rounded-[14px] px-3 py-2.5" style={{ background: 'oklch(0.975 0.012 258 / 0.5)', boxShadow: 'inset 2px 2px 5px oklch(0.55 0.03 258 / 0.08), inset -1px -1px 3px oklch(1 0 0 / 0.5)' }}>
                    <div className="mb-2 text-xs font-semibold text-[var(--foreground)]">已保存的模板</div>
                    {templates.length === 0 ? (
                      <div className="rounded-[10px] px-3 py-2 text-[11px] text-[var(--muted-foreground)]" style={{ background: 'oklch(0.975 0.012 258 / 0.4)' }}>
                        暂无已保存模板。编辑好评分标准后点「保存为模板」即可在此复用。
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {templates.map((t) => (
                          <div key={t.id} className="flex items-center gap-2 rounded-[10px] px-2 py-1.5">
                            <span className="min-w-0 flex-1 truncate text-xs text-[var(--foreground)]">{t.name}</span>
                            {t.createdByName && <span className="shrink-0 text-[10px] text-[var(--muted-foreground)]">· {t.createdByName}</span>}
                            <button type="button" onClick={() => void handleApplySavedTemplate(t.id)} disabled={busy} className="neu-btn-xs is-success">应用</button>
                            <button type="button" onClick={() => void handleDeleteTemplate(t.id)} disabled={busy} className="neu-btn-xs is-danger"><Trash2 size={12} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="neu-table w-full min-w-[680px]">
                    <thead>
                      <tr>
                        <th>分类</th>
                        <th>分项名称</th>
                        <th>分值</th>
                        <th>来源</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scoreItems.map((it) => (
                        <Fragment key={it.id}>
                          {editingItem?.id === it.id ? (
                            <tr>
                              <td>
                                <select
                                  className="workbench-input !h-[30px] !text-xs"
                                  value={editingItem.category}
                                  onChange={(e) => setEditingItem({ ...editingItem, category: e.target.value as ScoreCategory })}
                                >
                                  {SCORE_CATEGORIES.map((c) => (
                                    <option key={c} value={c}>{SCORE_CATEGORY_LABELS[c]}</option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                <input
                                  className="workbench-input !h-[30px] !text-xs w-full min-w-[180px]"
                                  value={editingItem.name}
                                  onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  className="workbench-input !h-[30px] !text-xs w-[80px]"
                                  value={editingItem.maxScore}
                                  onChange={(e) => setEditingItem({ ...editingItem, maxScore: e.target.value })}
                                />
                              </td>
                              <td className="text-[var(--muted-foreground)]">—</td>
                              <td>
                                <div className="flex items-center gap-1.5">
                                  <button type="button" onClick={() => void handleSaveItem()} disabled={busy} className="neu-btn-xs"><Save size={13} /></button>
                                  <button type="button" onClick={() => setEditingItem(null)} className="neu-btn-xs"><X size={13} /></button>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            <>
                              <tr className="row-clickable">
                                <td><CategoryPill>{SCORE_CATEGORY_LABELS[it.category]}</CategoryPill></td>
                                <td>
                                  <div className="flex items-center gap-2">
                                    <button type="button" onClick={() => void toggleExpand(it.id)} className="neu-btn-xs !p-1" title={expandedItems.has(it.id) ? '收起细则' : '展开细则'}>
                                      {expandedItems.has(it.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                    </button>
                                    <button type="button" onClick={() => void toggleExpand(it.id)} className="text-left text-[var(--foreground)]">
                                      {it.name}
                                    </button>
                                  </div>
                                </td>
                                <td className="tabular-nums font-semibold text-[var(--foreground)]">{it.maxScore}</td>
                                <td className="text-[var(--muted-foreground)] text-xs">{it.criteriaSource === 'ai_inferred' ? 'AI 推断' : it.criteriaSource === 'manual' ? '人工' : '—'}</td>
                                <td>
                                  <div className="flex items-center gap-1.5">
                                    <button type="button" onClick={() => setEditingItem({ id: it.id, name: it.name, category: it.category, maxScore: it.maxScore })} className="neu-btn-xs"><Pencil size={13} /></button>
                                    <button type="button" onClick={() => void handleDeleteItem(it.id)} disabled={busy} className="neu-btn-xs is-danger"><Trash2 size={13} /></button>
                                  </div>
                                </td>
                              </tr>
                              {expandedItems.has(it.id) && (
                                <tr>
                                  <td colSpan={5} style={{ background: 'transparent', padding: 0 }}>
                                    <div className="my-1 ml-2 rounded-[14px] px-4 py-3" style={{ background: 'oklch(0.975 0.012 258 / 0.5)', boxShadow: 'inset 2px 2px 5px oklch(0.55 0.03 258 / 0.08), inset -1px -1px 3px oklch(1 0 0 / 0.5)' }}>
                                      <div className="mb-2 flex items-center justify-between gap-2">
                                        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">评分细则 · 得分点</span>
                                        <button type="button" onClick={() => setNewPoint({ itemId: it.id, name: '', fullScore: '', evidenceHint: '' })} disabled={busy || !!newPoint || !!editingPoint} className="neu-btn-xs">
                                          <PlusCircle size={12} /> 新增细则
                                        </button>
                                      </div>
                                      {pointsLoading.has(it.id) ? (
                                        <div className="flex items-center justify-center py-3">
                                          <RefreshCw size={14} className="animate-spin text-[var(--muted-foreground)]" />
                                        </div>
                                      ) : (pointsByItem[it.id]?.length ?? 0) > 0 ? (
                                        <div className="space-y-1">
                                          {(pointsByItem[it.id] ?? []).map((p) =>
                                            editingPoint?.pointId === p.id ? (
                                              <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-[10px] px-2 py-1.5" style={{ background: 'oklch(1 0 0 / 0.55)' }}>
                                                <input className="workbench-input !h-[28px] !text-xs min-w-[160px] flex-1" value={editingPoint.name} onChange={(e) => setEditingPoint({ ...editingPoint, name: e.target.value })} placeholder="细则名称" />
                                                <input type="number" className="workbench-input !h-[28px] !text-xs w-[72px]" value={editingPoint.fullScore} onChange={(e) => setEditingPoint({ ...editingPoint, fullScore: e.target.value })} />
                                                <input className="workbench-input !h-[28px] !text-xs min-w-[160px] flex-1" value={editingPoint.evidenceHint} onChange={(e) => setEditingPoint({ ...editingPoint, evidenceHint: e.target.value })} placeholder="评审要点（可选）" />
                                                <button type="button" onClick={() => void handleSavePoint(it.id)} disabled={busy} className="neu-btn-xs is-success"><Save size={12} /></button>
                                                <button type="button" onClick={() => setEditingPoint(null)} className="neu-btn-xs"><X size={12} /></button>
                                              </div>
                                            ) : (
                                              <div key={p.id} className="flex items-center gap-2 rounded-[10px] px-2 py-1.5">
                                                <span className="min-w-0 flex-1">
                                                  <span className="block text-xs text-[var(--foreground)]">{p.name}</span>
                                                  {p.evidenceHint && <span className="mt-0.5 block truncate text-[10px] text-[var(--muted-foreground)]">评审要点：{p.evidenceHint}</span>}
                                                </span>
                                                <span className="w-10 text-right text-xs font-semibold tabular-nums text-[var(--foreground)]">{p.fullScore}</span>
                                                <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'color-mix(in oklch, var(--muted-foreground) 10%, transparent)', color: 'var(--muted-foreground)' }}>{p.objective ? '客观' : '主观'}</span>
                                                <button type="button" onClick={() => setEditingPoint({ itemId: it.id, pointId: p.id, name: p.name, fullScore: p.fullScore, evidenceHint: p.evidenceHint ?? '' })} className="neu-btn-xs"><Pencil size={12} /></button>
                                                <button type="button" onClick={() => void handleDeletePoint(it.id, p.id)} disabled={busy} className="neu-btn-xs is-danger"><Trash2 size={12} /></button>
                                              </div>
                                            ),
                                          )}
                                        </div>
                                      ) : (
                                        <div className="rounded-[10px] px-3 py-2 text-[11px] text-[var(--muted-foreground)]" style={{ background: 'oklch(0.975 0.012 258 / 0.4)' }}>
                                          暂无细则，可点击「新增细则」添加得分点。
                                        </div>
                                      )}
                                      {newPoint?.itemId === it.id && (
                                        <div className="mt-1 flex flex-wrap items-center gap-2 rounded-[10px] px-2 py-1.5" style={{ background: 'oklch(1 0 0 / 0.55)' }}>
                                          <input className="workbench-input !h-[28px] !text-xs min-w-[160px] flex-1" value={newPoint.name} onChange={(e) => setNewPoint({ ...newPoint, name: e.target.value })} placeholder="细则名称" autoFocus />
                                          <input type="number" className="workbench-input !h-[28px] !text-xs w-[72px]" value={newPoint.fullScore} onChange={(e) => setNewPoint({ ...newPoint, fullScore: e.target.value })} placeholder="分值" />
                                          <input className="workbench-input !h-[28px] !text-xs min-w-[160px] flex-1" value={newPoint.evidenceHint} onChange={(e) => setNewPoint({ ...newPoint, evidenceHint: e.target.value })} placeholder="评审要点（可选）" />
                                          <button type="button" onClick={() => void handleCreatePoint(it.id)} disabled={busy} className="neu-btn-xs is-success"><Save size={12} /></button>
                                          <button type="button" onClick={() => setNewPoint(null)} className="neu-btn-xs"><X size={12} /></button>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </>
                          )}
                        </Fragment>
                      ))}
                      {newItem && (
                        <tr>
                          <td>
                            <select
                              className="workbench-input !h-[30px] !text-xs"
                              value={newItem.category}
                              onChange={(e) => setNewItem({ ...newItem, category: e.target.value as ScoreCategory })}
                            >
                              {SCORE_CATEGORIES.map((c) => (
                                <option key={c} value={c}>{SCORE_CATEGORY_LABELS[c]}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className="workbench-input !h-[30px] !text-xs w-full min-w-[180px]"
                              placeholder="分项名称"
                              value={newItem.name}
                              autoFocus
                              onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              className="workbench-input !h-[30px] !text-xs w-[80px]"
                              value={newItem.maxScore}
                              onChange={(e) => setNewItem({ ...newItem, maxScore: e.target.value })}
                            />
                          </td>
                          <td className="text-[var(--muted-foreground)]">—</td>
                          <td>
                            <div className="flex items-center gap-1.5">
                              <button type="button" onClick={() => void handleCreateItem()} disabled={busy} className="neu-btn-xs is-success"><Save size={13} /></button>
                              <button type="button" onClick={() => setNewItem(null)} className="neu-btn-xs"><X size={13} /></button>
                            </div>
                          </td>
                        </tr>
                      )}
                      {scoreItems.length === 0 && !newItem && (
                        <tr>
                          <td colSpan={5}><EmptyHint text="尚未编制评分标准。可点击「应用标准模板」快速生成五类评分项，或「新增分项」手动添加。" /></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              {/* ▸ 区块5-8（Phase 2 指挥中心）：开标进度 / 评标管理 / 澄清答疑 / 归档
                  —— :3007 开标执行数据经同一 API 回流，各区块按 stage 自行决定渲染 */}
              {bpId && detail && (
                <>
                  <OpeningProgressBlock bidProjectId={bpId} detail={detail} onChanged={refreshDetail} />
                  <EvaluationBlock bidProjectId={bpId} detail={detail} onChanged={refreshDetail} />
                  <ClarificationsBlock bidProjectId={bpId} detail={detail} onChanged={refreshDetail} />
                  <ArchiveBlock bidProjectId={bpId} detail={detail} onChanged={refreshDetail} />
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

function CategoryPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]" style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)' }}>
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
