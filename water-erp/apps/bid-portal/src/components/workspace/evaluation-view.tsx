'use client';

/**
 * 评标管理区块——:3007 项目工作区「评标管理」tab（全操作）。
 * 分工 v3（2026-08-13）：评标管理自 :3005 迁回本端，进度仪表盘、启动评标、专家状态卡、
 * 专家×供应商评分矩阵（偏差>20% 标异常）、供应商汇总排名（实时均分参考 /
 * 官方结果）、3 步生成向导、专家批注查看。归档由 :3005 收尾；实时性由页级 socket 驱动。
 * 唯一副本（:3005 原件已删除，2026-08-14）；函数 API 走 @/lib/api/evaluation（同源封装）。
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, ClipboardCheck,
  Clock, FileCheck, MessageSquare, Play, ShieldCheck, Sparkles, Star, Trophy, UserCheck, X,
} from 'lucide-react';
import {
  extendEvaluation,
  generateEvaluationResults,
  getExpertMemoInkUrlForAdmin,
  getLiveOfficialScores,
  listEvaluationResults,
  listExpertMemosForAdmin,
  startEvaluation,
  type BidEvaluationResultInfo,
  type ExcludedSupplierInfo,
  type LiveOfficialScoresResponse,
  type ExpertMemoForAdmin,
  type ScoreCategory,
} from '@/lib/api/evaluation';
import type { BidProjectDetail } from '@/lib/types';
import { EXPERT_ROLE } from '@water-erp/shared';
import AiAnalysisCard from './ai-analysis-card';
import { Ring, FeedbackBanner, FEEDBACK_AUTOHIDE_MS, MODAL_OVERLAY_STYLE } from './shared';
import { useBidUser } from '@/hooks/use-bid-user';

type Props = {
  projectId: string;
  project: BidProjectDetail | null;
  onChanged: () => void;
  /** 页级结果刷新信号（异议裁决联动废标等会删除评标结果——递增即重拉），同 ClarificationsBlock.refreshSignal 模式 */
  refreshSignal?: number;
};

const CATEGORY_ORDER: ScoreCategory[] = ['QUALIFICATION', 'RESPONSIVE', 'BUSINESS', 'TECHNICAL', 'PRICE'];
/** 通过性类别（满分 0，只记通过/不通过） */
const PASS_FAIL_CATEGORIES: ScoreCategory[] = ['QUALIFICATION', 'RESPONSIVE'];
const ANOMALY_THRESHOLD = 20; // 偏差 >20% 标异常
/** F19：评标时长相关共用常量（启动缺省/延期缺省/上下限与后端 extendEvaluationDeadline 硬校验对齐） */
const DEFAULT_EVALUATION_HOURS = 72;
const DEFAULT_EXTEND_HOURS = 24;
const EVAL_HOURS_MIN = 1;
const EVAL_HOURS_MAX = 720; // 与后端启动封顶 min(·,720)、延期 @Max(720) 同口径
const MS_PER_HOUR = 3600_000;

function memoDeviceLabel(sourceDevice: string): string {
  const [device, input] = sourceDevice.split('_');
  const dl = device === 'desktop' ? '桌面' : device === 'tablet' ? '平板' : device;
  const il = input === 'handwriting' ? '手写' : input === 'keyboard' ? '键盘' : input;
  return `${dl}·${il}`;
}

/* ── 聚合工具（移植自 bid-portal evaluate/page.tsx）── */

interface ExpertSupplierCell {
  totalScore: number;
  maxScore: number;
  scoredCount: number;
  items: { scoreItemId: string; name: string; category: ScoreCategory; score: number; maxScore: number; passed?: boolean | null; reason?: string | null }[];
}
type ExpertSupplierMatrix = Map<string, Map<string, ExpertSupplierCell>>;

function buildExpertSupplierMatrix(project: BidProjectDetail): ExpertSupplierMatrix {
  const itemMap = new Map(project.scoreItems.map(si => [si.id, si]));
  const matrix: ExpertSupplierMatrix = new Map();
  for (const expert of project.experts) {
    const row: Map<string, ExpertSupplierCell> = new Map();
    for (const supplier of project.suppliers) {
      row.set(supplier.id, { totalScore: 0, maxScore: 0, scoredCount: 0, items: [] });
    }
    for (const record of expert.scoreRecords) {
      const item = itemMap.get(record.scoreItemId);
      if (!item) continue;
      const cell = row.get(record.supplierId);
      if (!cell) continue;
      const score = Number(record.score);
      cell.totalScore += score;
      cell.maxScore += Number(item.maxScore);
      cell.scoredCount += 1;
      cell.items.push({
        scoreItemId: record.scoreItemId,
        name: item.name, category: item.category, score, maxScore: Number(item.maxScore),
        passed: record.passed, reason: record.reason,
      });
    }
    matrix.set(expert.id, row);
  }
  return matrix;
}

/** 各专家对同一供应商的百分制得分（用于偏差检测与实时均分） */
function supplierPercentScores(project: BidProjectDetail, matrix: ExpertSupplierMatrix, supplierId: string): number[] {
  const scores: number[] = [];
  // F4：均分只统计正选专家（候补无评分权限；与后端去极值口径一致）
  for (const expert of project.experts.filter(e => e.expertRole === EXPERT_ROLE.REGULAR)) {
    const cell = matrix.get(expert.id)?.get(supplierId);
    if (cell && cell.maxScore > 0) scores.push((cell.totalScore / cell.maxScore) * 100);
  }
  return scores;
}

/** F19：单元格偏差判定（清单与矩阵标色共用同一实现，防两处口径漂移）
 *  ——某专家对某供应商的百分制得分偏离全体均分 > ANOMALY_THRESHOLD */
function cellDeviationAnomaly(
  matrix: ExpertSupplierMatrix,
  avgBySupplier: Map<string, number>,
  expertId: string,
  supplierId: string,
): { pct: number; avg: number } | null {
  const cell = matrix.get(expertId)?.get(supplierId);
  if (!cell || cell.maxScore <= 0) return null;
  const pct = (cell.totalScore / cell.maxScore) * 100;
  const avg = avgBySupplier.get(supplierId) ?? 0;
  return avg > 0 && Math.abs(pct - avg) > ANOMALY_THRESHOLD ? { pct, avg } : null;
}

function StatTile({ label, value, sub, pct, color }: { label: string; value: string; sub: string; pct: number; color: string }) {
  return (
    <div className="flex flex-1 items-center gap-2.5 rounded-[14px] px-3 py-2.5" style={{ background: 'oklch(0.975 0.012 258 / 0.4)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.5)' }}>
      <Ring pct={pct} color={color} />
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">{label}</div>
        <div className="text-sm font-black tabular-nums tracking-[-0.02em] text-[var(--foreground)]">{value}</div>
        <div className="truncate text-[10px] text-[var(--muted-foreground)]">{sub}</div>
      </div>
    </div>
  );
}

/* ═══ 组件 ═══ */

export default function EvaluationView({ projectId, project, onChanged, refreshSignal }: Props) {
  const [results, setResults] = useState<BidEvaluationResultInfo[]>([]);
  /** 生成时排除的供应商（开标确认 EXCEPTION，未纳入排名）——仅生成响应携带 */
  const [excludedSuppliers, setExcludedSuppliers] = useState<ExcludedSupplierInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const [expandedCell, setExpandedCell] = useState<string | null>(null); // `${expertId}:${supplierId}`
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<0 | 1 | 2>(0);
  const [annotationCell, setAnnotationCell] = useState<string | null>(null); // `${expertId}:${supplierId}:${scoreItemId}`
  const [annotationMemos, setAnnotationMemos] = useState<ExpertMemoForAdmin[]>([]);
  const [annotationLoading, setAnnotationLoading] = useState(false);
  const [annotationCounts, setAnnotationCounts] = useState<Record<string, number>>({});
  const [inkUrls, setInkUrls] = useState<Record<string, string>>({}); // memoId → presigned URL
  // E2: 「自定义评标时长」（启动评标弹窗）与「评标延期审批」（弹窗）
  const [startDialogOpen, setStartDialogOpen] = useState(false);
  const [durationHours, setDurationHours] = useState(DEFAULT_EVALUATION_HOURS);
  const [extendDialogOpen, setExtendDialogOpen] = useState(false);
  const [extendHours, setExtendHours] = useState(DEFAULT_EXTEND_HOURS);
  const [extendReason, setExtendReason] = useState('');
  const [extendBusy, setExtendBusy] = useState(false);
  const me = useBidUser();
  /** 评标延期审批 leader/admin/bid_host 可见（与后端 @Roles('leader','admin','bid_host') 对齐） */
  const canApproveExtend = me?.role === 'leader' || me?.role === 'admin' || me?.role === 'bid_host';

  const showToast = (text: string, tone: 'ok' | 'err' = 'ok') => {
    setFeedback({ text, tone });
    setTimeout(() => setFeedback(null), FEEDBACK_AUTOHIDE_MS);
  };

  const loadAnnotations = async (expertId: string, supplierId: string, scoreItemId: string) => {
    const key = `${expertId}:${supplierId}:${scoreItemId}`;
    setAnnotationCell(key);
    setAnnotationLoading(true);
    setAnnotationMemos([]);
    setInkUrls({});
    try {
      const memos = await listExpertMemosForAdmin(projectId, { expertId, supplierId, scoreItemId });
      setAnnotationMemos(memos);
      // lazy-load ink URLs
      for (const m of memos) {
        if (m.inkFileId) {
          getExpertMemoInkUrlForAdmin(projectId, m.id)
            .then(({ url }) => setInkUrls(prev => ({ ...prev, [m.id]: url })))
            .catch(() => {});
        }
      }
    } catch { /* silent */ }
    finally { setAnnotationLoading(false); }
  };

  const loadAnnotationCounts = async (expertId: string, supplierId: string) => {
    setAnnotationLoading(true);
    try {
      const allMemos = await listExpertMemosForAdmin(projectId, { expertId, supplierId });
      const counts: Record<string, number> = {};
      for (const m of allMemos) {
        if (m.scoreItemId) counts[m.scoreItemId] = (counts[m.scoreItemId] ?? 0) + 1;
      }
      setAnnotationCounts(counts);
    } catch { /* silent */ }
    finally { setAnnotationLoading(false); }
  };

  const loadResults = useCallback(() => {
    listEvaluationResults(projectId)
      .then(r => { setResults(r); })
      .catch(() => setResults([]));
  }, [projectId]);

  // F12（2026-08-28）：官方口径实时排名预览（结果未生成时排名区主数据源）——与生成同源聚合
  // （去极值/公式价格分/废标置后），替代旧的「正选百分制原始均分」；端点失败回退旧均分。
  const [liveOfficial, setLiveOfficial] = useState<LiveOfficialScoresResponse | null>(null);

  // F12：按项目挂载拉取（project 每次 socket 刷新都换引用，放入依赖会导致
  // 任何无关事件（解密等）都重拉评标结果）；本区块动作已各自刷新。
  // F6（2026-08-28）：新增页级 refreshSignal 依赖——异议裁决联动废标会删除评标结果，
  // 此前 results 仅挂载时拉取一次，删除后本区块仍显示旧排名（缓存失活）。信号变化即重拉。
  // 重拉后生成响应携带的 excludedSuppliers 告警不再可靠，一并清空。
  useEffect(() => { loadResults(); }, [loadResults]);
  const firstSignalRun = useRef(true);
  useEffect(() => {
    if (refreshSignal === undefined) return;
    if (firstSignalRun.current) { firstSignalRun.current = false; return; } // 挂载首跑跳过（上方挂载 effect 已拉）
    loadResults();
    setExcludedSuppliers([]);
  }, [refreshSignal, loadResults]);

  /* ── 派生数据 ── */
  const matrix = useMemo(() => (project ? buildExpertSupplierMatrix(project) : new Map()), [project]);

  // F12：官方口径预览的拉取签名——project 引用随 socket 高频更换（loadResults 同款坑），不能直接
  // 进依赖；签名 = 各专家对全部供应商的 totalScore 合计拼接，仅在实际分数变化时改变（防抖拉取）。
  const liveScoresSignature = useMemo(() => {
    if (matrix.size === 0) return '';
    return [...matrix.entries()]
      .map(([eid, row]) => `${eid}:${[...row.values()].reduce((s, c) => s + (c?.totalScore ?? 0), 0)}`)
      .sort().join('|');
  }, [matrix]);

  // F12：结果未生成时拉官方口径预览；生成后不再拉（排名区切官方结果）
  useEffect(() => {
    if (!projectId || results.length > 0) return;
    let cancelled = false;
    getLiveOfficialScores(projectId)
      .then(r => { if (!cancelled) setLiveOfficial(r); })
      .catch(() => { if (!cancelled) setLiveOfficial(null); });
    return () => { cancelled = true; };
  }, [projectId, results.length, liveScoresSignature]);

  const supplierAvg = useMemo(() => {
    if (!project) return new Map<string, number>();
    const avgs = new Map<string, number>();
    for (const s of project.suppliers) {
      const scores = supplierPercentScores(project, matrix, s.id);
      avgs.set(s.id, scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0);
    }
    return avgs;
  }, [project, matrix]);

  /** 实时均分排名（未生成官方结果时，仅供参考） */
  const liveRanks = useMemo(() => {
    if (!project) return new Map<string, number>();
    const entries = [...project.suppliers].map(s => ({ id: s.id, avg: supplierAvg.get(s.id) ?? 0 }));
    entries.sort((a, b) => b.avg - a.avg);
    const ranks = new Map<string, number>();
    let rank = 1;
    for (let i = 0; i < entries.length; i++) {
      if (i > 0 && entries[i].avg < entries[i - 1].avg) rank = i + 1;
      ranks.set(entries[i].id, rank);
    }
    return ranks;
  }, [project, supplierAvg]);

  // P3-4: 按业务逻辑序排列评分项（而非 API 字母序）。useMemo 必须在所有条件返回之前调用。
  const scoreItems = useMemo(() => {
    if (!project) return [];
    const orderMap = new Map(CATEGORY_ORDER.map((c, i) => [c, i]));
    return [...project.scoreItems].sort((a, b) => (orderMap.get(a.category) ?? 99) - (orderMap.get(b.category) ?? 99));
  }, [project]);
  if (!project) return null;
  const { stage, experts, suppliers } = project;
  // F5（2026-08-28）：ABORTED 不再空白死页——渲染终止态卡片（流标原因 + 去向指引），
  // 评标已随流标终止，本 tab 无操作可做；其余非评标阶段仍返回 null。
  if (stage === 'ABORTED') {
    return (
      <section className="neu-table-card px-4 py-4">
        <div className="mb-3 flex items-center gap-2.5">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]"
            style={{ background: 'color-mix(in oklch, var(--danger) 12%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}
          >
            <AlertTriangle size={15} className="text-[var(--danger)]" />
          </div>
          <h3 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">评标管理</h3>
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'color-mix(in oklch, var(--danger) 12%, transparent)', color: 'var(--danger)' }}>
            已流标
          </span>
        </div>
        <div className="rounded-[14px] px-4 py-3.5 text-xs leading-relaxed" style={{ border: '1px solid oklch(0.6 0.04 258 / 0.14)', background: 'oklch(0.975 0.012 258 / 0.5)' }}>
          <p className="font-semibold text-[var(--foreground)]">本项目已流标，评标活动终止，无评标过程可执行。</p>
          <p className="mt-1.5 text-[var(--muted-foreground)]">
            流标原因：<span className="text-[var(--foreground)]">{project.riskNote || '未记录原因'}</span>
          </p>
          <p className="mt-1.5 text-[var(--muted-foreground)]">
            后续处理（重新招标 / 变更采购方式等）在采购管理工作台（:3005）「开标确认」面板进行；开标现场记录可在「开标大厅」tab 回看。
          </p>
        </div>
      </section>
    );
  }
  if (stage !== 'OPENING' && stage !== 'EVALUATING' && stage !== 'ARCHIVED') return null;

  const archived = stage === 'ARCHIVED';
  // F4（2026-08-28）：生成门槛与统计仅计正选专家——候补不参与评分/报告确认/签字
  // （后端 assertRegularExpert 拦截，生成闸门也只查正选）。此前把候补计入分母，
  // 有候补的项目「可生成结果」恒为否、生成按钮永久禁用。
  const regularExperts = experts.filter(e => e.expertRole === EXPERT_ROLE.REGULAR);
  const alternateExperts = experts.filter(e => e.expertRole !== EXPERT_ROLE.REGULAR);
  const signedIn = regularExperts.filter(e => e.signedIn).length;
  const reportsDone = regularExperts.filter(e => e.reportConfirmed).length;
  const unconfirmed = regularExperts.filter(e => !e.reportConfirmed);
  const canGenerate = regularExperts.length > 0 && unconfirmed.length === 0;

  // H4: 开标完成度（与后端 startEvaluation 守卫同口径）——未撤回供应商须全部到终局态
  const activeSuppliers = suppliers.filter(s => s.submitStatus !== '已撤回');
  const notReadySuppliers = activeSuppliers.filter(s =>
    s.decryptStatus !== 'DANGER' &&
    (s.decryptStatus !== 'SUCCESS' || (s.confirmStatus !== 'CONFIRMED' && s.confirmStatus !== 'EXCEPTION'))
  );
  const openingDone = activeSuppliers.length > 0 && notReadySuppliers.length === 0;

  // F9（2026-08-28）：启动评标守卫前端镜像（后端 startEvaluation 同口径）——委员会 = 已确认正选
  // 5 人以上单数（水利项目 7 人以上单数，由后端按 PMI/项目名判定，前端按通用口径提示）；
  // 可评供应商 = 解密成功且未撤回 ≥ 法定家数（minBidders 随详情下发）。旧实现仅拦「开标完成」，
  // 委员会不足/家数不足要点了按钮才被 409 教育。
  const confirmedRegular = regularExperts.filter(e => e.invitationStatus === 'confirmed').length;
  const committeeOk = confirmedRegular >= 5 && confirmedRegular % 2 === 1;
  const evaluableCount = suppliers.filter(s => s.decryptStatus === 'SUCCESS' && s.submitStatus !== '已撤回').length;
  const minBidders = project.minBidders ?? 3;
  const biddersOk = evaluableCount >= minBidders;
  const startBlockers: string[] = [];
  if (!openingDone) startBlockers.push(`开标未完成：${notReadySuppliers.map(s => s.supplierName).join('、')} 未到终局态`);
  if (!committeeOk) startBlockers.push(`已确认正选专家 ${confirmedRegular} 人，须 5 人以上单数（水利项目 7 人以上单数）`);
  if (!biddersOk) startBlockers.push(`有效投标（解密成功且未撤回）仅 ${evaluableCount} 家，不足法定 ${minBidders} 家`);

  // F9：生成向导第 0 步清单补全——镜像 generateEvaluationResults 其余前置闸门（旧清单只有专家报告确认）
  const openDisputeCount = (project.expertDisputes ?? []).filter(d => d.status === 'open').length;
  const leaderSigned = !!project.leaderCoSigned;
  const roundsRequired = !!project.roundMode && project.roundMode !== 'sealed_auction';
  const allRounds = project.bidRounds ?? [];
  const roundsUnclosed = allRounds.filter(r => r.status !== 'closed').length;
  const roundsClosed = allRounds.length > 0 && roundsUnclosed === 0;
  const step0Ready = canGenerate && leaderSigned && openDisputeCount === 0 && (!roundsRequired || roundsClosed);

  const itemCount = scoreItems.length;
  // F4：评分格位分母同样只计正选（候补无评分权限，计入会压低进度百分比）
  const totalSlots = regularExperts.length * suppliers.length * itemCount;
  let scoredSlots = 0;
  for (const expert of regularExperts) {
    const row = matrix.get(expert.id);
    if (row) for (const s of suppliers) scoredSlots += Math.min(row.get(s.id)?.scoredCount ?? 0, itemCount);
  }
  const scorePct = totalSlots > 0 ? Math.round((scoredSlots / totalSlots) * 100) : 0;

  /** 官方排名（含废标置后）或实时排名 */
  const rankedSuppliers = [...suppliers].sort((a, b) => {
    if (results.length > 0) {
      const rankOf = new Map(results.map(r => [r.supplierId, r.rank]));
      return (rankOf.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rankOf.get(b.id) ?? Number.MAX_SAFE_INTEGER);
    }
    // F12：官方口径预览可用时按预览序（去极值+公式分），否则回退原始均分序
    if (liveOfficial && liveOfficial.results.length > 0) {
      const rankOf = new Map(liveOfficial.results.map(r => [r.supplierId, r.rank]));
      return (rankOf.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rankOf.get(b.id) ?? Number.MAX_SAFE_INTEGER);
    }
    return (supplierAvg.get(b.id) ?? 0) - (supplierAvg.get(a.id) ?? 0);
  });

  /** 偏差异常清单（某专家对某供应商的百分制得分偏离全体均分 >20%） */
  // F4：仅正选参与偏差检测（候补无评分记录，行内为空会被 maxScore<=0 跳过，此处显式收口）
  const anomalies: { expert: BidProjectDetail['experts'][number]; supplier: BidProjectDetail['suppliers'][number]; pct: number; avg: number }[] = [];
  for (const expert of regularExperts) {
    for (const s of suppliers) {
      const hit = cellDeviationAnomaly(matrix, supplierAvg, expert.id, s.id);
      if (hit) anomalies.push({ expert, supplier: s, pct: hit.pct, avg: hit.avg });
    }
  }

  /* ── 操作 ── */
  async function handleStartEvaluation(hours: number) {
    setBusy(true);
    try {
      await startEvaluation(projectId, hours);
      setStartDialogOpen(false);
      showToast(`评标已启动（评标时限 ${hours} 小时），项目进入评标阶段`);
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '启动评标失败', 'err');
    } finally {
      setBusy(false);
    }
  }

  async function handleExtendEvaluation() {
    if (!extendReason.trim()) {
      showToast('请填写延期理由', 'err');
      return;
    }
    setExtendBusy(true);
    try {
      const r = await extendEvaluation(projectId, { extendHours, reason: extendReason.trim() });
      setExtendDialogOpen(false);
      setExtendReason('');
      showToast(`评标延期审批通过：延长 ${extendHours} 小时，新截止 ${new Date(r.evaluationDeadline).toLocaleString('zh-CN')}`);
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '评标延期审批失败', 'err');
    } finally {
      setExtendBusy(false);
    }
  }

  async function handleGenerate() {
    setBusy(true);
    try {
      const r = await generateEvaluationResults(projectId);
      setResults(r.results);
      setExcludedSuppliers(r.excludedSuppliers ?? []);
      setWizardOpen(false);
      setWizardStep(0);
      showToast('评标结果已生成');
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '生成评标结果失败', 'err');
    } finally {
      setBusy(false);
    }
  }

  /** F6（2026-08-28）：重生成入口——结果已存在时此前无入口（按钮仅在 results.length===0 显示），
   *  裁决废标/评分修正后只能刷新整页。二次确认：未闭环签字包将随重生成作废（后端同事务删除+重置签字）。 */
  async function handleRegenerate() {
    const ok = window.confirm(
      '重新生成评标结果？\n· 未闭环的评标签字包将随之作废（签字登记全部重置，须重新生成与登记）；\n· 已闭环签字包则后端拒绝重生成。\n确认后继续。',
    );
    if (!ok) return;
    await handleGenerate();
  }

  const isCellAnomaly = (expertId: string, supplierId: string): boolean =>
    cellDeviationAnomaly(matrix, supplierAvg, expertId, supplierId) !== null;

  return (
    <section className="neu-table-card px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]"
            style={{ background: 'color-mix(in oklch, var(--stage-evaluation, var(--accent)) 14%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}
          >
            <ClipboardCheck size={15} className="text-[var(--accent)]" />
          </div>
          <h3 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">评标管理</h3>
          {results.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'color-mix(in oklch, var(--success) 12%, transparent)', color: 'var(--success)' }}>
              <Trophy size={10} /> 结果已生成
            </span>
          )}
        </div>
        {stage === 'EVALUATING' && results.length === 0 && !archived && (
          <button type="button" onClick={() => { setWizardStep(0); setWizardOpen(true); }} disabled={!canGenerate || busy} className="neu-btn-primary !h-[32px] !text-xs disabled:opacity-40">
            <Sparkles size={13} /> 生成评标结果
          </button>
        )}
        {stage === 'EVALUATING' && results.length > 0 && !archived && (
          <button
            type="button"
            onClick={() => void handleRegenerate()}
            disabled={!canGenerate || busy}
            className="neu-btn-soft !h-[32px] !text-xs disabled:opacity-40"
            title="重新生成将覆盖现有结果；未闭环签字包随之作废"
          >
            <Sparkles size={13} /> 重新生成
          </button>
        )}
      </div>

      {/* E2: 评标截止时间展示 */}
      {stage === 'EVALUATING' && project?.evaluationDeadline && (() => {
        const remaining = Math.ceil((new Date(project.evaluationDeadline).getTime() - Date.now()) / MS_PER_HOUR);
        const expired = remaining <= 0;
        return (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-[12px] px-3.5 py-2 text-xs font-semibold"
            style={{ background: expired ? 'color-mix(in oklch, var(--danger) 8%, transparent)' : 'color-mix(in oklch, var(--warning, var(--accent)) 8%, transparent)' }}>
            <div className="flex min-w-0 items-center gap-2">
              <Clock size={13} className={expired ? 'text-[var(--danger)]' : 'text-[var(--accent)]'} />
              <span className={expired ? 'text-[var(--danger)]' : 'text-[var(--muted-foreground)]'}>
                {expired ? `评标已超时（截止 ${new Date(project.evaluationDeadline).toLocaleString('zh-CN')}）` : `评标时限剩余约 ${remaining} 小时（截止 ${new Date(project.evaluationDeadline).toLocaleString('zh-CN')}）`}
              </span>
            </div>
            {canApproveExtend && (
              <button type="button" onClick={() => setExtendDialogOpen(true)} className="neu-btn-soft !h-[30px] !text-[11px] shrink-0">
                <CalendarClock size={12} /> 评标延期审批
              </button>
            )}
          </div>
        );
      })()}

      <FeedbackBanner feedback={feedback} />

      {/* AI 辅助评标进度（沿用原只读视图的 AI 卡片：补救操作不改阶段） */}
      <div className="mb-3">
        <AiAnalysisCard projectId={projectId} stage={stage} />
      </div>

      {/* 启动评标横幅（OPENING 阶段） */}
      {stage === 'OPENING' && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[14px] px-4 py-3" style={{ background: 'color-mix(in oklch, var(--accent) 8%, transparent)' }}>
          <div className="flex items-center gap-2.5 text-xs">
            <Play size={15} className="shrink-0 text-[var(--accent)]" />
            <span className="font-bold text-[var(--accent-strong)]">当前阶段：在线开标</span>
            <span className="text-[var(--muted-foreground)]">— 开标完成后可启动专家评标（须已抽取专家、存在可评供应商且评分标准完整）</span>
            {!openingDone && notReadySuppliers.length > 0 && (
              <span className="text-[var(--warning)]">开标未完成：{notReadySuppliers.map(s => s.supplierName).join('、')} 待解密/确认</span>
            )}
            {!committeeOk && (
              <span className="text-[var(--warning)]">已确认正选专家 {confirmedRegular} 人（须 5 人以上单数，水利项目 7 人以上）</span>
            )}
            {!biddersOk && (
              <span className="text-[var(--warning)]">有效投标 {evaluableCount} 家（法定最少 {minBidders} 家）</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => { setDurationHours(DEFAULT_EVALUATION_HOURS); setStartDialogOpen(true); }}
            disabled={busy || startBlockers.length > 0}
            title={startBlockers.length > 0 ? startBlockers.join('\n') : ''}
            className="neu-btn-primary !h-[32px] !text-xs shrink-0 disabled:opacity-40"
          >
            <Play size={13} /> {busy ? '启动中…' : '启动评标'}
          </button>
        </div>
      )}

      {/* 进度四联 */}
      <div className="mb-3 flex flex-wrap gap-2.5">
        <StatTile
          label="评分进度" value={`${scorePct}%`}
          sub={scorePct >= 80 ? '即将完成全部评分' : scorePct >= 50 ? '评分进行中' : '评分刚起步'}
          pct={scorePct} color={scorePct >= 80 ? 'var(--success)' : scorePct >= 50 ? 'var(--accent)' : 'var(--warning)'}
        />
        <StatTile
          label="专家签到" value={`${signedIn}/${regularExperts.length}`} sub="正选已签到 / 正选总数"
          pct={regularExperts.length > 0 ? (signedIn / regularExperts.length) * 100 : 0}
          color={signedIn === regularExperts.length && regularExperts.length > 0 ? 'var(--success)' : 'var(--accent)'}
        />
        <StatTile
          label="报告确认" value={`${reportsDone}/${regularExperts.length}`} sub="正选已确认 / 正选总数"
          pct={regularExperts.length > 0 ? (reportsDone / regularExperts.length) * 100 : 0}
          color={reportsDone === regularExperts.length && regularExperts.length > 0 ? 'var(--success)' : reportsDone > 0 ? 'var(--accent)' : 'var(--muted-foreground)'}
        />
        <StatTile
          label="可生成结果" value={canGenerate ? '是' : '否'}
          sub={canGenerate ? '正选报告均已确认' : `仍有 ${unconfirmed.length} 位正选未确认`}
          pct={canGenerate ? 100 : 0} color={canGenerate ? 'var(--success)' : 'var(--muted-foreground)'}
        />
      </div>

      <div className="space-y-3">
        {/* ── 专家状态卡 ── */}
        <div className="rounded-[14px]" style={{ border: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
          <div className="px-3.5 py-2.5" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.1)', background: 'oklch(0.975 0.012 258 / 0.5)' }}>
            <span className="text-[11px] font-bold text-[var(--foreground)]">专家状态</span>
            <span className="ml-2 text-[10px] text-[var(--muted-foreground)]">实名组织视图——签到·签字·现场沟通（查看留痕）；评分明细见下方编号矩阵</span>
          </div>
          {experts.length === 0 ? (
            <div className="px-3.5 py-6 text-center text-xs text-[var(--muted-foreground)]">
              尚未抽取专家{stage !== 'ARCHIVED' && '——请在采购管理工作台（:3005）完成抽取'}
            </div>
          ) : (
            <div>
              {experts.map(expert => (
                <div
                  key={expert.id}
                  className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
                  style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.08)' }}
                >
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--foreground)]">
                    {expert.expertName}
                    <span className="ml-2 text-[10px] font-normal text-[var(--muted-foreground)]">{expert.major ?? '—'} · {expert.expertRole}</span>
                    {/* A-132：评委分工（分组·职责）——两维皆空则不渲染 */}
                    {(expert.reviewGroup || expert.dutyRole) && (
                      <span className="ml-2 text-[10px] font-normal text-[var(--accent)]" title="评标委员会分工（:3005 步骤5 配置）">
                        {[expert.reviewGroup, expert.dutyRole].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  {/* F10（2026-08-28）：邀请状态徽章（与 :3005 专家确认同词表）——declined 标红；
                      婉拒/未确认的正选不计入启动评标委员会（后端只认 confirmed 正选） */}
                  {expert.invitationStatus === 'confirmed' && (
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'color-mix(in oklch, var(--success) 12%, transparent)', color: 'var(--success)' }}>
                      已确认邀请
                    </span>
                  )}
                  {expert.invitationStatus === 'declined' && (
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'color-mix(in oklch, var(--danger) 12%, transparent)', color: 'var(--danger)' }} title="专家已婉拒邀请——正选缺席时由候补递补（:3005 专家确认）">
                      已婉拒
                    </span>
                  )}
                  {(!expert.invitationStatus || expert.invitationStatus === 'invited') && (
                    <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'color-mix(in oklch, var(--warning) 12%, transparent)', color: 'var(--warning)' }} title="专家尚未确认邀请">
                      待确认邀请
                    </span>
                  )}
                  {expert.expertRole !== EXPERT_ROLE.REGULAR && (
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold"
                      style={{ background: 'color-mix(in oklch, var(--muted-foreground) 14%, transparent)', color: 'var(--muted-foreground)' }}
                      title="候补专家不参与评分、评审报告确认与签字；正选缺席时递补后方可参与"
                    >
                      候补·未递补
                    </span>
                  )}
                  <span className="hidden items-center gap-1 text-[10px] font-semibold sm:inline-flex" style={{ color: expert.signedIn ? 'var(--success)' : 'var(--muted-foreground)' }}>
                    <UserCheck size={11} /> {expert.signedIn ? '已签到' : '未签到'}
                  </span>
                  <span className="hidden items-center gap-1 text-[10px] font-semibold sm:inline-flex" style={{ color: expert.avoidanceConfirmed ? 'var(--success)' : 'var(--warning)' }}>
                    <ShieldCheck size={11} /> {expert.avoidanceConfirmed ? '已回避确认' : '待回避确认'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: expert.reportConfirmed ? 'var(--success)' : 'var(--muted-foreground)' }}>
                    <FileCheck size={11} /> {expert.reportConfirmed ? '报告已确认' : '报告未确认'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── 专家×供应商评分矩阵 ── */}
        {regularExperts.length > 0 && suppliers.length > 0 && (
          <div>
            {/* P2-8：匿名/实名还原规则标注——防「同屏时隐时现」被质疑匿名化不一致 */}
            <p className="mb-1.5 text-[10px] text-[var(--muted-foreground)]">
              评分矩阵与分数明细在评标期间按「专家 1/2/…」稳定编号呈现（互不可见他人分数）；现场组织者（主持人/管理员）可在专家状态卡片查看实名，用于签到、签字与现场沟通（查看留痕）；全部专家确认评审报告后恢复实名。
              {/* F4：矩阵仅列正选专家；编号为服务端按全体专家预分配的稳定号，候补在列时可能不连续（不重排，防刷新换号） */}
              {alternateExperts.length > 0 && `另有 ${alternateExperts.length} 名候补专家不参与评分，未列入矩阵。`}
            </p>
            <div className="overflow-x-auto rounded-[14px]" style={{ border: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)]" style={{ background: 'oklch(0.975 0.012 258 / 0.5)' }}>
                  <th className="px-3.5 py-2">评分矩阵</th>
                  {suppliers.map(s => (
                    <th key={s.id} className="max-w-[130px] truncate px-3.5 py-2" title={s.supplierName}>{s.supplierName}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {regularExperts.map(expert => (
                  <Fragment key={expert.id}>
                    <tr style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.1)' }}>
                      <td className="px-3.5 py-2 font-medium text-[var(--foreground)]">{expert.anonLabel ?? expert.expertName}</td>
                      {suppliers.map(s => {
                        const cell = matrix.get(expert.id)?.get(s.id);
                        const scored = cell && cell.scoredCount > 0;
                        const anomaly = isCellAnomaly(expert.id, s.id);
                        const key = `${expert.id}:${s.id}`;
                        return (
                          <td key={s.id} className="px-3.5 py-2">
                            {scored ? (
                              <button
                                type="button"
                                onClick={() => setExpandedCell(prev => {
                                  const next = prev === key ? null : key;
                                  if (next) loadAnnotationCounts(expert.id, s.id);
                                  return next;
                                })}
                                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums transition-colors hover:bg-[oklch(0.94_0.01_258_/_0.8)]"
                                title="点击查看评分项明细"
                                style={{
                                  color: anomaly ? 'var(--danger)' : 'var(--accent-strong)',
                                  background: anomaly ? 'color-mix(in oklch, var(--danger) 10%, transparent)' : undefined,
                                }}
                              >
                                {cell.totalScore.toFixed(1)}<span className="text-[9px] font-normal text-[var(--muted-foreground)]">/{cell.maxScore}</span>
                                {anomaly && <AlertTriangle size={10} />}
                              </button>
                            ) : (
                              <span className="text-[10px] text-[var(--muted-foreground)]">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {(() => {
                      const [exId, spId] = (expandedCell ?? '').split(':');
                      if (exId !== expert.id) return null;
                      const cell = matrix.get(expert.id)?.get(spId);
                      if (!cell || cell.scoredCount === 0) return null;
                      const supplier = suppliers.find(s => s.id === spId);
                      return (
                        <tr key={`${expert.id}-detail`}>
                          <td colSpan={suppliers.length + 1} className="px-6 py-2.5" style={{ background: 'oklch(0.975 0.012 258 / 0.35)', borderTop: '1px dashed oklch(0.6 0.04 258 / 0.12)' }}>
                            <div className="mb-1 flex items-center justify-between">
                              <span className="text-[10px] font-bold text-[var(--muted-foreground)]">
                                {expert.anonLabel ?? expert.expertName} → {supplier?.supplierName} · {cell.totalScore.toFixed(1)}/{cell.maxScore}（{cell.scoredCount}/{scoreItems.length} 项）
                              </span>
                              <button type="button" onClick={() => setExpandedCell(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X size={11} /></button>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              {cell.items.map((it: ExpertSupplierCell['items'][number]) => {
                                const memoCount = annotationCounts[it.scoreItemId] ?? 0;
                                return (
                                  <span key={it.scoreItemId} className="text-[10px] text-[var(--muted-foreground)]" title={it.reason ?? undefined}>
                                    {it.name}{' '}
                                    <b style={{ color: it.passed === false ? 'var(--danger)' : 'var(--foreground)' }}>
                                      {PASS_FAIL_CATEGORIES.includes(it.category) ? (it.passed === false ? '不通过' : '通过') : `${it.score}/${it.maxScore}`}
                                    </b>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); loadAnnotations(expert.id, spId, it.scoreItemId); }}
                                      className={`ml-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold transition-colors ${
                                        memoCount > 0
                                          ? 'bg-[color-mix(in_oklch,var(--accent)_12%,transparent)] text-[var(--accent-strong)]'
                                          : 'text-[var(--muted-foreground)] hover:bg-[oklch(0.94_0.01_258/0.7)]'
                                      }`}
                                      title={memoCount > 0 ? `${memoCount} 条批注` : '查看批注'}
                                    >
                                      <MessageSquare size={9} strokeWidth={1.5} />
                                      {memoCount > 0 && <span className="tabular-nums">{memoCount}</span>}
                                    </button>
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      );
                    })()}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {anomalies.length > 0 && (
              <div className="flex items-start gap-1.5 px-3.5 py-2 text-[10px]" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.1)', background: 'color-mix(in oklch, var(--danger) 5%, transparent)', color: 'var(--danger)' }}>
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                <span>{anomalies.length} 处评分偏差超过 {ANOMALY_THRESHOLD}%（与全体均分相比），生成结果前请重点复核。</span>
              </div>
            )}
            </div>
          </div>
        )}

        {/* ── 供应商汇总与排名 ── */}
        <div className="rounded-[14px]" style={{ border: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
          <div className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.1)', background: 'oklch(0.975 0.012 258 / 0.5)' }}>
            <span className="text-[11px] font-bold text-[var(--foreground)]">供应商排名</span>
            <span className="text-[10px] text-[var(--muted-foreground)]">
              {results.length > 0
                ? '官方评标结果（去极值 · 废标置后）'
                : liveOfficial
                  ? '官方口径实时预览（去极值 · 公式价格分 · 废标置后）'
                  : '实时均分参考（未生成官方结果）'}
            </span>
          </div>
          {/* P1-6: 预览口径提示——F12 后官方口径预览为主，原始均分仅为端点失败回退 */}
          {results.length === 0 && suppliers.length > 0 && (
            liveOfficial?.priceFormulaError ? (
              <div className="mx-3.5 mt-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-[11px] leading-relaxed text-[var(--danger)]">
                <AlertTriangle size={11} className="mr-1 inline" />
                {liveOfficial.priceFormulaError}（生成评标结果时将被硬性拦截）
              </div>
            ) : liveOfficial ? (
              <div className="mx-3.5 mt-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-3 py-2 text-[11px] leading-relaxed text-[var(--warning)]">
                官方口径实时预览——与「生成评标结果」同一聚合（≥5 位专家去 1 高 1 低、公式价格分、废标置后）；评分仍在进行，最终以生成为准
              </div>
            ) : (
              <div className="mx-3.5 mt-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-3 py-2 text-[11px] leading-relaxed text-[var(--warning)]">
                实时预览基于专家原始评分（含手填价格分，未去极值，非官方口径），最终排名以「生成评标结果」后公式计算为准
              </div>
            )
          )}
          {/* 生成时被排除的供应商（开标确认异常，未纳入排名）告警 */}
          {excludedSuppliers.length > 0 && (
            <div className="mx-3.5 mt-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2 text-[11px] leading-relaxed text-[var(--danger)]">
              <AlertTriangle size={11} className="mr-1 inline" />
              以下供应商开标确认状态异常，未纳入排名：{excludedSuppliers.map(s => `${s.supplierName}（${s.reason}）`).join('；')}
            </div>
          )}
          {rankedSuppliers.length === 0 ? (
            <div className="px-3.5 py-6 text-center text-xs text-[var(--muted-foreground)]">暂无投标供应商</div>
          ) : (
            <div>
              {rankedSuppliers.map(s => {
                const official = results.find(r => r.supplierId === s.id);
                const live = results.length === 0 ? liveOfficial?.results.find(r => r.supplierId === s.id) : undefined;
                const rank = official ? official.rank : (live?.rank ?? (liveRanks.get(s.id) ?? 0));
                const avg = supplierAvg.get(s.id) ?? 0;
                const disqualified = official?.disqualified ?? live?.disqualified ?? false;
                const recommended = official?.recommended ?? false;
                return (
                  <div
                    key={s.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5"
                    style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.08)', opacity: disqualified ? 0.55 : undefined }}
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black tabular-nums"
                      style={{
                        background: rank === 1 && !disqualified ? 'color-mix(in oklch, var(--warning) 22%, transparent)' : 'oklch(0.94 0.01 258 / 0.8)',
                        color: rank === 1 && !disqualified ? 'oklch(0.45 0.12 70)' : 'var(--muted-foreground)',
                      }}
                    >
                      {rank}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--foreground)]">
                      {s.supplierName}
                      {recommended && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'color-mix(in oklch, var(--warning) 16%, transparent)', color: 'oklch(0.45 0.12 70)' }}>
                          <Star size={10} className="inline fill-[oklch(0.65_0.15_70)] text-[oklch(0.65_0.15_70)]" />
                          中标候选人
                        </span>
                      )}
                      {disqualified && <span className="ml-2 rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'color-mix(in oklch, var(--danger) 12%, transparent)', color: 'var(--danger)' }}>废标</span>}
                    </span>
                    {official?.bidPrice && (
                      <span className="font-mono text-[11px] tabular-nums text-[var(--muted-foreground)]">
                        ¥{Number(official.bidPrice).toLocaleString('zh-CN')}
                      </span>
                    )}
                    <span className="font-mono text-xs font-bold tabular-nums text-[var(--accent-strong)]">
                      {official ? Number(official.totalScore).toFixed(2) : live ? live.totalScore.toFixed(2) : avg.toFixed(1)}
                      <span className="ml-1 text-[9px] font-normal text-[var(--muted-foreground)]">{official ? '官方总分' : live ? '预览总分' : '均分参考'}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── 3 步生成向导 ── */}
      {wizardOpen && stage === 'EVALUATING' && results.length === 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" style={MODAL_OVERLAY_STYLE}>
          <div className="w-full max-w-[560px] rounded-[20px]" style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.72))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)' }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">生成评标结果</h2>
                <div className="flex items-center gap-1.5">
                  {['专家确认', '异常审阅', '确认生成'].map((label, i) => (
                    <Fragment key={label}>
                      {i > 0 && <span className="h-px w-4" style={{ background: 'oklch(0.7 0.02 258)' }} />}
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{
                          background: wizardStep >= i ? 'color-mix(in oklch, var(--accent) 14%, transparent)' : 'transparent',
                          color: wizardStep >= i ? 'var(--accent-strong)' : 'var(--muted-foreground)',
                        }}
                      >
                        {i + 1} {label}
                      </span>
                    </Fragment>
                  ))}
                </div>
              </div>
              <button type="button" onClick={() => setWizardOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X size={16} /></button>
            </div>

            <div className="px-6 py-5">
              {wizardStep === 0 && (
                <div className="space-y-2 text-xs">
                  <p className="leading-5 text-[var(--muted-foreground)]">生成评标结果前置条件（与后端闸门同口径，全部满足方可继续）：</p>
                  {[
                    {
                      ok: unconfirmed.length === 0,
                      text: unconfirmed.length === 0
                        ? `${regularExperts.length} 位正选专家已全部确认评审报告（候补不参与）`
                        : `仍有 ${unconfirmed.length} 位正选专家未确认评审报告`,
                    },
                    {
                      ok: leaderSigned,
                      text: leaderSigned ? '评审报告已经组长末签' : '评审报告尚未经组长末签（生成前须完成末签）',
                    },
                    {
                      ok: openDisputeCount === 0,
                      text: openDisputeCount === 0 ? '无待裁决的专家异议' : `有 ${openDisputeCount} 个专家异议待裁决，须先裁决`,
                    },
                    ...(roundsRequired ? [{
                      ok: roundsClosed,
                      text: roundsClosed
                        ? `报价轮次已全部结束（共 ${allRounds.length} 轮）`
                        : allRounds.length === 0
                          ? '尚未创建报价轮次——谈判项目须至少完成一轮报价（「报价轮次」tab）'
                          : `还有 ${roundsUnclosed} 个报价轮次未结束，请先在「报价轮次」tab 关闭`,
                    }] : []),
                  ].map(p => (
                    <div
                      key={p.text}
                      className="flex items-center gap-2 rounded-[12px] px-3.5 py-2.5 font-semibold"
                      style={{
                        background: `color-mix(in oklch, ${p.ok ? 'var(--success)' : 'var(--warning)'} 10%, transparent)`,
                        color: p.ok ? 'var(--success)' : 'var(--warning)',
                      }}
                    >
                      {p.ok ? <CheckCircle2 size={14} className="shrink-0" /> : <Clock size={13} className="shrink-0" />}
                      {p.text}
                    </div>
                  ))}
                  {unconfirmed.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {unconfirmed.map(e => (
                        <span key={e.id} className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'oklch(1 0 0 / 0.7)', color: 'var(--foreground)' }}>
                          {e.expertName}{!e.signedIn && '（未签到）'}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {wizardStep === 1 && (
                <div className="space-y-2 text-xs">
                  <p className="leading-5 text-[var(--muted-foreground)]">以下评分与全体均分偏差超过 {ANOMALY_THRESHOLD}%，生成前请确认无异常（生成时按规则去极值）：</p>
                  {anomalies.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-[12px] px-3.5 py-3 font-semibold" style={{ background: 'color-mix(in oklch, var(--success) 10%, transparent)', color: 'var(--success)' }}>
                      <CheckCircle2 size={14} /> 未发现异常偏差评分。
                    </div>
                  ) : (
                    <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                      {anomalies.map((a, i) => (
                        <div key={i} className="flex items-center gap-2 rounded-[10px] px-3 py-2" style={{ background: 'color-mix(in oklch, var(--danger) 7%, transparent)' }}>
                          <AlertTriangle size={12} className="shrink-0 text-[var(--danger)]" />
                          <span className="flex-1 text-[11px]">
                            <b>{a.expert.anonLabel ?? a.expert.expertName}</b> 对 <b>{a.supplier.supplierName}</b> 打分
                            <b className="mx-1 tabular-nums" style={{ color: 'var(--danger)' }}>{a.pct.toFixed(1)}%</b>
                            （全体均分 <b className="tabular-nums">{a.avg.toFixed(1)}%</b>）
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {wizardStep === 2 && (
                <div className="space-y-2.5 text-xs leading-5 text-[var(--muted-foreground)]">
                  <p>确认生成评标结果？生成规则：</p>
                  <ul className="list-inside list-disc space-y-1 pl-1">
                    <li>仅纳入解密成功、已确认且未撤回的供应商</li>
                    <li>通过性审查（资格/响应性）不通过票<span className="font-semibold text-[var(--foreground)]">严格过半即废标</span>，废标置后</li>
                    <li>专家组 ≥5 人时去掉 1 个最高分与 1 个最低分后求均分</li>
                    <li>第 1 名推荐为中标候选人；完整归档后自动生成中标公示草稿（在 :3005 信息发布中心发布）</li>
                  </ul>
                  <p className="font-semibold text-[var(--foreground)]">结果生成后可再次生成覆盖（专家报告确认状态不变）。</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
              <button type="button" onClick={() => (wizardStep === 0 ? setWizardOpen(false) : setWizardStep((wizardStep - 1) as 0 | 1))} className="neu-btn-soft !h-[36px] !text-xs">
                {wizardStep === 0 ? '取消' : '上一步'}
              </button>
              {wizardStep < 2 ? (
                <button
                  type="button"
                  onClick={() => setWizardStep((wizardStep + 1) as 1 | 2)}
                  disabled={wizardStep === 0 && !step0Ready}
                  className="neu-btn-primary !h-[36px] !text-xs disabled:opacity-40"
                >
                  下一步 <ChevronRight size={13} />
                </button>
              ) : (
                <button type="button" onClick={() => void handleGenerate()} disabled={busy} className="neu-btn-primary !h-[36px] !text-xs">
                  <Sparkles size={13} /> {busy ? '生成中…' : '确认生成'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 批注查看弹窗 */}
      {annotationCell && (() => {
        const [exId, spId] = annotationCell.split(':');
        const expert = experts.find(e => e.id === exId);
        const expertName = expert ? (expert.anonLabel ?? expert.expertName) : '';
        const supplierName = suppliers.find(s => s.id === spId)?.supplierName ?? '';
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center px-6"
            style={MODAL_OVERLAY_STYLE}
            onClick={() => setAnnotationCell(null)}>
            <div className="w-full max-w-[480px] rounded-[20px] bg-white p-5"
              style={{ boxShadow: '3px 4px 16px oklch(0.46 0.07 258 / 0.18)' }}
              onClick={e => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-[var(--foreground)]">
                  批注 · {expertName} → {supplierName}
                </h3>
                <button type="button" onClick={() => setAnnotationCell(null)}
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                  <X size={16} />
                </button>
              </div>
              {annotationLoading ? (
                <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">加载中…</p>
              ) : annotationMemos.length === 0 ? (
                <p className="py-6 text-center text-xs text-[var(--muted-foreground)]">暂无批注</p>
              ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto">
                  {annotationMemos.map(m => (
                    <div key={m.id} className="rounded-[10px] border border-[oklch(0.6_0.04_258/0.1)] bg-[oklch(0.975_0.012_258/0.3)] px-3 py-2">
                      {m.contentText && (
                        <p className="break-words text-xs text-[var(--foreground)]">{m.contentText}</p>
                      )}
                      {m.inkFileId && inkUrls[m.id] && (
                        <img src={inkUrls[m.id]} alt="手写批注" className="mt-1 w-full rounded-lg" />
                      )}
                      {m.inkFileId && !inkUrls[m.id] && (
                        <p className="text-[10px] italic text-[var(--muted-foreground)]">墨迹加载中…</p>
                      )}
                      <div className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                        {new Date(m.createdAt).toLocaleString('zh-CN')}
                        {m.sourceDevice && ` · ${memoDeviceLabel(m.sourceDevice)}`}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── 自定义评标时长（启动评标弹窗，E2）── */}
      {startDialogOpen && stage === 'OPENING' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" style={MODAL_OVERLAY_STYLE}>
          <div className="w-full max-w-[440px] rounded-[20px]" style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.72))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)' }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
              <h2 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">启动评标 · 自定义评标时长</h2>
              <button type="button" onClick={() => setStartDialogOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X size={16} /></button>
            </div>
            <div className="px-6 py-5">
              <p className="mb-4 text-xs leading-5 text-[var(--muted-foreground)]">
                评标时限 = 启动评标时刻 + 时长（小时）。截止后仍可在本页经「评标延期审批」延长。
              </p>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">评标时长（小时）</label>
              <input
                type="number"
                min={EVAL_HOURS_MIN}
                max={EVAL_HOURS_MAX}
                step={1}
                value={durationHours}
                onChange={(e) => setDurationHours(Math.max(EVAL_HOURS_MIN, Math.min(EVAL_HOURS_MAX, Math.floor(Number(e.target.value) || EVAL_HOURS_MIN))))}
                className="workbench-input w-full font-mono"
              />
              <p className="mt-2 text-[11px] tabular-nums text-[var(--muted-foreground)]">
                预计截止：{new Date(Date.now() + durationHours * MS_PER_HOUR).toLocaleString('zh-CN')}
              </p>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
              <button type="button" onClick={() => setStartDialogOpen(false)} className="neu-btn-soft !h-[36px] !text-xs">取消</button>
              <button type="button" onClick={() => void handleStartEvaluation(durationHours)} disabled={busy} className="neu-btn-primary !h-[36px] !text-xs">
                <Play size={13} /> {busy ? '启动中…' : '启动评标'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 评标延期审批（leader/admin，E2）── */}
      {extendDialogOpen && stage === 'EVALUATING' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" style={MODAL_OVERLAY_STYLE}>
          <div className="w-full max-w-[460px] rounded-[20px]" style={{ background: 'linear-gradient(170deg, oklch(1 0 0 / 0.97), oklch(0.99 0.003 258 / 0.72))', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.88), 3px 4px 16px oklch(0.46 0.07 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.94)' }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
              <h2 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">评标延期审批</h2>
              <button type="button" onClick={() => setExtendDialogOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X size={16} /></button>
            </div>
            <div className="px-6 py-5">
              <p className="mb-3 text-xs leading-5 text-[var(--muted-foreground)]">
                当前截止：<span className="tabular-nums text-[var(--foreground)]">{project?.evaluationDeadline ? new Date(project.evaluationDeadline).toLocaleString('zh-CN') : '—'}</span>
                {project?.evaluationDeadline && new Date(project.evaluationDeadline).getTime() < Date.now() && <span className="ml-1 font-semibold text-[var(--danger)]">（已超时）</span>}
              </p>
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">延长小时数<span className="ml-1.5 font-normal normal-case tracking-normal">（单次最长 720 小时，与启动评标时长相通）</span></label>
              <input
                type="number"
                min={EVAL_HOURS_MIN}
                max={EVAL_HOURS_MAX}
                step={1}
                value={extendHours}
                onChange={(e) => setExtendHours(Math.max(EVAL_HOURS_MIN, Math.min(EVAL_HOURS_MAX, Math.floor(Number(e.target.value) || EVAL_HOURS_MIN))))}
                className="workbench-input w-full font-mono"
              />
              <label className="mb-1.5 mt-4 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">延期理由</label>
              <textarea
                value={extendReason}
                onChange={(e) => setExtendReason(e.target.value)}
                rows={3}
                placeholder="请填写延期理由…"
                className="workbench-input w-full resize-none"
              />
              <p className="mt-3 text-[11px] leading-4 text-[var(--muted-foreground)]">
                审批后将在当前截止时间（已超时则自当前时刻）基础上累加 {extendHours} 小时，并写入监督日志与审计日志。
              </p>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.12)' }}>
              <button type="button" onClick={() => setExtendDialogOpen(false)} className="neu-btn-soft !h-[36px] !text-xs">取消</button>
              <button type="button" onClick={() => void handleExtendEvaluation()} disabled={extendBusy || !extendReason.trim()} className="neu-btn-primary !h-[36px] !text-xs disabled:opacity-40">
                <CalendarClock size={13} /> {extendBusy ? '审批中…' : '确认延期'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
