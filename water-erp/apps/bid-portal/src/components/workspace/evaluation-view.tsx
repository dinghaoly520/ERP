'use client';

/**
 * 评标管理区块——:3007 项目工作区「评标管理」tab（全操作）。
 * 分工 v3（2026-08-13）：评标管理自 :3005 迁回本端，进度仪表盘、启动评标、专家状态卡、
 * 专家×供应商评分矩阵（偏差>20% 标异常）、供应商汇总排名（实时均分参考 /
 * 官方结果）、3 步生成向导、专家批注查看。归档由 :3005 收尾；实时性由页级 socket 驱动。
 * 唯一副本（:3005 原件已删除，2026-08-14）；函数 API 走 @/lib/api/evaluation（同源封装）。
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck,
  Clock, FileCheck, MessageSquare, Play, ShieldCheck, Sparkles, Star, Trophy, UserCheck, X,
} from 'lucide-react';
import {
  extendEvaluation,
  generateEvaluationResults,
  getExpertMemoInkUrlForAdmin,
  listEvaluationResults,
  listExpertMemosForAdmin,
  startEvaluation,
  type BidEvaluationResultInfo,
  type ExpertMemoForAdmin,
  type ScoreCategory,
} from '@/lib/api/evaluation';
import type { BidProjectDetail } from '@/lib/types';
import AiAnalysisCard from './ai-analysis-card';
import { useBidUser } from '@/hooks/use-bid-user';

type Props = {
  projectId: string;
  project: BidProjectDetail | null;
  onChanged: () => void;
};

const CATEGORY_ORDER: ScoreCategory[] = ['QUALIFICATION', 'RESPONSIVE', 'BUSINESS', 'TECHNICAL', 'PRICE'];
/** 通过性类别（满分 0，只记通过/不通过） */
const PASS_FAIL_CATEGORIES: ScoreCategory[] = ['QUALIFICATION', 'RESPONSIVE'];
const ANOMALY_THRESHOLD = 20; // 偏差 >20% 标异常

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
  for (const expert of project.experts) {
    const cell = matrix.get(expert.id)?.get(supplierId);
    if (cell && cell.maxScore > 0) scores.push((cell.totalScore / cell.maxScore) * 100);
  }
  return scores;
}

/* ── 迷你环形进度 ── */
function Ring({ pct, size = 34, stroke = 4, color }: { pct: number; size?: number; stroke?: number; color: string }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * Math.min(1, pct / 100);
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="oklch(0.92 0.008 258)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" className="transition-all duration-700"
        />
      </svg>
      <span className="absolute text-[9px] font-extrabold tabular-nums" style={{ color }}>{Math.round(pct)}</span>
    </div>
  );
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

export default function EvaluationView({ projectId, project, onChanged }: Props) {
  const [results, setResults] = useState<BidEvaluationResultInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const [expandedExperts, setExpandedExperts] = useState<Set<string>>(new Set());
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
  const [durationHours, setDurationHours] = useState(72);
  const [extendDialogOpen, setExtendDialogOpen] = useState(false);
  const [extendHours, setExtendHours] = useState(24);
  const [extendReason, setExtendReason] = useState('');
  const [extendBusy, setExtendBusy] = useState(false);
  const me = useBidUser();
  /** 评标延期审批 leader/admin/bid_host 可见（与后端 @Roles('leader','admin','bid_host') 对齐） */
  const canApproveExtend = me?.role === 'leader' || me?.role === 'admin' || me?.role === 'bid_host';

  const showToast = (text: string, tone: 'ok' | 'err' = 'ok') => {
    setFeedback({ text, tone });
    setTimeout(() => setFeedback(null), 3000);
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
    listEvaluationResults(projectId).then(setResults).catch(() => setResults([]));
  }, [projectId]);

  // F12：仅按项目挂载拉取（project 每次 socket 刷新都换引用，放入依赖会导致
  // 任何无关事件（解密等）都重拉评标结果）；本区块动作已各自刷新
  useEffect(() => { loadResults(); }, [loadResults]);

  /* ── 派生数据 ── */
  const matrix = useMemo(() => (project ? buildExpertSupplierMatrix(project) : new Map()), [project]);

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
  if (stage !== 'OPENING' && stage !== 'EVALUATING' && stage !== 'ARCHIVED') return null;

  const archived = stage === 'ARCHIVED';
  const signedIn = experts.filter(e => e.signedIn).length;
  const reportsDone = experts.filter(e => e.reportConfirmed).length;
  const unconfirmed = experts.filter(e => !e.reportConfirmed);
  const canGenerate = experts.length > 0 && unconfirmed.length === 0;

  // H4: 开标完成度（与后端 startEvaluation 守卫同口径）——未撤回供应商须全部到终局态
  const activeSuppliers = suppliers.filter(s => s.submitStatus !== '已撤回');
  const notReadySuppliers = activeSuppliers.filter(s =>
    s.decryptStatus !== 'DANGER' &&
    (s.decryptStatus !== 'SUCCESS' || (s.confirmStatus !== 'CONFIRMED' && s.confirmStatus !== 'EXCEPTION'))
  );
  const openingDone = activeSuppliers.length > 0 && notReadySuppliers.length === 0;

  const itemCount = scoreItems.length;
  const totalSlots = experts.length * suppliers.length * itemCount;
  let scoredSlots = 0;
  for (const expert of experts) {
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
    return (supplierAvg.get(b.id) ?? 0) - (supplierAvg.get(a.id) ?? 0);
  });

  /** 偏差异常清单（某专家对某供应商的百分制得分偏离全体均分 >20%） */
  const anomalies: { expert: BidProjectDetail['experts'][number]; supplier: BidProjectDetail['suppliers'][number]; pct: number; avg: number }[] = [];
  for (const expert of experts) {
    for (const s of suppliers) {
      const cell = matrix.get(expert.id)?.get(s.id);
      if (!cell || cell.maxScore <= 0) continue;
      const pct = (cell.totalScore / cell.maxScore) * 100;
      const avg = supplierAvg.get(s.id) ?? 0;
      if (avg > 0 && Math.abs(pct - avg) > ANOMALY_THRESHOLD) {
        anomalies.push({ expert, supplier: s, pct, avg });
      }
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
      showToast(e instanceof Error ? e.message : '延期审批失败', 'err');
    } finally {
      setExtendBusy(false);
    }
  }

  async function handleGenerate() {
    setBusy(true);
    try {
      const r = await generateEvaluationResults(projectId);
      setResults(r);
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

  const isCellAnomaly = (expertId: string, supplierId: string): boolean => {
    const cell = matrix.get(expertId)?.get(supplierId);
    if (!cell || cell.maxScore <= 0) return false;
    const avg = supplierAvg.get(supplierId) ?? 0;
    return avg > 0 && Math.abs((cell.totalScore / cell.maxScore) * 100 - avg) > ANOMALY_THRESHOLD;
  };

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
      </div>

      {/* E2: 评标截止时间展示 */}
      {stage === 'EVALUATING' && project?.evaluationDeadline && (() => {
        const remaining = Math.ceil((new Date(project.evaluationDeadline).getTime() - Date.now()) / 3600000);
        const expired = remaining <= 0;
        return (
          <div className={`mb-3 flex items-center justify-between gap-2 rounded-[12px] px-3.5 py-2 text-xs font-semibold ${expired ? '' : ''}`}
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

      {feedback && (
        <div
          className="mb-3 flex items-center gap-2 rounded-[12px] px-3.5 py-2.5 text-xs font-semibold"
          style={{
            background: feedback.tone === 'ok' ? 'color-mix(in oklch, var(--success) 10%, transparent)' : 'color-mix(in oklch, var(--danger) 10%, transparent)',
            color: feedback.tone === 'ok' ? 'var(--success)' : 'var(--danger)',
          }}
        >
          {feedback.tone === 'ok' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {feedback.text}
        </div>
      )}

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
          </div>
          <button
            type="button"
            onClick={() => { setDurationHours(72); setStartDialogOpen(true); }}
            disabled={busy || !openingDone}
            title={openingDone ? '' : `开标未完成：${notReadySuppliers.map(s => s.supplierName).join('、')} 未到终局态`}
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
          label="专家签到" value={`${signedIn}/${experts.length}`} sub="已签到 / 总计"
          pct={experts.length > 0 ? (signedIn / experts.length) * 100 : 0}
          color={signedIn === experts.length && experts.length > 0 ? 'var(--success)' : 'var(--accent)'}
        />
        <StatTile
          label="报告确认" value={`${reportsDone}/${experts.length}`} sub="报告已确认 / 总计"
          pct={experts.length > 0 ? (reportsDone / experts.length) * 100 : 0}
          color={reportsDone === experts.length && experts.length > 0 ? 'var(--success)' : reportsDone > 0 ? 'var(--accent)' : 'var(--muted-foreground)'}
        />
        <StatTile
          label="可生成结果" value={canGenerate ? '是' : '否'}
          sub={canGenerate ? '所有报告已确认' : `仍有 ${unconfirmed.length} 位未确认`}
          pct={canGenerate ? 100 : 0} color={canGenerate ? 'var(--success)' : 'var(--muted-foreground)'}
        />
      </div>

      <div className="space-y-3">
        {/* ── 专家状态卡 ── */}
        <div className="rounded-[14px]" style={{ border: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
          <div className="px-3.5 py-2.5" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.1)', background: 'oklch(0.975 0.012 258 / 0.5)' }}>
            <span className="text-[11px] font-bold text-[var(--foreground)]">专家状态</span>
            <span className="ml-2 text-[10px] text-[var(--muted-foreground)]">点击展开查看各供应商评分明细</span>
          </div>
          {experts.length === 0 ? (
            <div className="px-3.5 py-6 text-center text-xs text-[var(--muted-foreground)]">
              尚未抽取专家{stage !== 'ARCHIVED' && '——请在采购管理工作台（:3005）完成抽取'}
            </div>
          ) : (
            <div>
              {experts.map(expert => {
                const expanded = expandedExperts.has(expert.id);
                const row = matrix.get(expert.id);
                return (
                  <Fragment key={expert.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedExperts(prev => {
                        const next = new Set(prev);
                        if (next.has(expert.id)) next.delete(expert.id); else next.add(expert.id);
                        return next;
                      })}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors hover:bg-[oklch(0.97_0.01_258_/_0.5)]"
                      style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.08)' }}
                    >
                      {expanded ? <ChevronDown size={13} className="shrink-0 text-[var(--muted-foreground)]" /> : <ChevronRight size={13} className="shrink-0 text-[var(--muted-foreground)]" />}
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--foreground)]">
                        {expert.expertName}
                        <span className="ml-2 text-[10px] font-normal text-[var(--muted-foreground)]">{expert.major ?? '—'} · {expert.expertRole}</span>
                      </span>
                      <span className="hidden items-center gap-1 text-[10px] font-semibold sm:inline-flex" style={{ color: expert.signedIn ? 'var(--success)' : 'var(--muted-foreground)' }}>
                        <UserCheck size={11} /> {expert.signedIn ? '已签到' : '未签到'}
                      </span>
                      <span className="hidden items-center gap-1 text-[10px] font-semibold sm:inline-flex" style={{ color: expert.avoidanceConfirmed ? 'var(--success)' : 'var(--warning)' }}>
                        <ShieldCheck size={11} /> {expert.avoidanceConfirmed ? '已回避确认' : '待回避确认'}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold" style={{ color: expert.reportConfirmed ? 'var(--success)' : 'var(--muted-foreground)' }}>
                        <FileCheck size={11} /> {expert.reportConfirmed ? '报告已确认' : '报告未确认'}
                      </span>
                    </button>
                    {expanded && row && (
                      <div className="px-6 py-2.5" style={{ background: 'oklch(0.975 0.012 258 / 0.35)', borderTop: '1px dashed oklch(0.6 0.04 258 / 0.12)' }}>
                        {suppliers.length === 0 ? (
                          <span className="text-[11px] text-[var(--muted-foreground)]">暂无投标供应商</span>
                        ) : (
                          <div className="space-y-1.5">
                            {suppliers.map(s => {
                              const cell = row.get(s.id);
                              const scored = cell && cell.scoredCount > 0;
                              return (
                                <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                  <span className="w-40 shrink-0 truncate text-[11px] font-medium text-[var(--foreground)]">{s.supplierName}</span>
                                  {scored ? (
                                    <>
                                      <span className="font-mono text-[11px] font-bold tabular-nums text-[var(--accent-strong)]">
                                        {cell.totalScore.toFixed(1)}<span className="font-normal text-[var(--muted-foreground)]">/{cell.maxScore}</span>
                                      </span>
                                      <span className="text-[10px] text-[var(--muted-foreground)]">{cell.scoredCount}/{scoreItems.length} 项</span>
                                      <span className="flex flex-wrap gap-1">
                                        {cell.items.map((it: ExpertSupplierCell['items'][number]) => (
                                          <span
                                            key={it.name}
                                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px]"
                                            title={it.reason ?? undefined}
                                            style={{
                                              background: it.passed === false ? 'color-mix(in oklch, var(--danger) 12%, transparent)' : 'oklch(0.94 0.01 258 / 0.7)',
                                              color: it.passed === false ? 'var(--danger)' : 'var(--muted-foreground)',
                                            }}
                                          >
                                            {it.name}：{PASS_FAIL_CATEGORIES.includes(it.category) ? (it.passed === false ? '不通过' : '通过') : `${it.score}/${it.maxScore}`}
                                          </span>
                                        ))}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-[10px] text-[var(--muted-foreground)]">未评分</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          )}
        </div>

        {/* ── 专家×供应商评分矩阵 ── */}
        {experts.length > 0 && suppliers.length > 0 && (
          <div>
            {/* P2-8：匿名/实名还原规则标注——防「同屏时隐时现」被质疑匿名化不一致 */}
            <p className="mb-1.5 text-[10px] text-[var(--muted-foreground)]">
              评分矩阵与分数明细在评标期间按「专家 1/2/…」稳定编号呈现（互不可见他人分数）；现场组织者（主持人/管理员）可在专家状态卡片查看实名，用于签到、签字与现场沟通（查看留痕）；全部专家确认评审报告后恢复实名。
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
                {experts.map(expert => (
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
              {results.length > 0 ? '官方评标结果（去极值 · 废标置后）' : '实时均分参考（未生成官方结果）'}
            </span>
          </div>
          {/* P1-6: 实时排名与官方结果计算方式不同的提示 */}
          {results.length === 0 && suppliers.length > 0 && (
            <div className="mx-3.5 mt-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-3 py-2 text-[11px] leading-relaxed text-[var(--warning)]">
              实时预览基于专家原始评分（含手填价格分，未去极值），最终排名以「生成评标结果」后公式计算为准
            </div>
          )}
          {rankedSuppliers.length === 0 ? (
            <div className="px-3.5 py-6 text-center text-xs text-[var(--muted-foreground)]">暂无投标供应商</div>
          ) : (
            <div>
              {rankedSuppliers.map(s => {
                const official = results.find(r => r.supplierId === s.id);
                const rank = official ? official.rank : (liveRanks.get(s.id) ?? 0);
                const avg = supplierAvg.get(s.id) ?? 0;
                const disqualified = official?.disqualified ?? false;
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
                      {recommended && <Star size={11} className="ml-1 inline fill-[oklch(0.65_0.15_70)] text-[oklch(0.65_0.15_70)]" />}
                      {disqualified && <span className="ml-2 rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'color-mix(in oklch, var(--danger) 12%, transparent)', color: 'var(--danger)' }}>废标</span>}
                    </span>
                    {official?.bidPrice && (
                      <span className="font-mono text-[11px] tabular-nums text-[var(--muted-foreground)]">
                        ¥{Number(official.bidPrice).toLocaleString('zh-CN')}
                      </span>
                    )}
                    <span className="font-mono text-xs font-bold tabular-nums text-[var(--accent-strong)]">
                      {official ? Number(official.totalScore).toFixed(2) : avg.toFixed(1)}
                      <span className="ml-1 text-[9px] font-normal text-[var(--muted-foreground)]">{official ? '官方总分' : '均分参考'}</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" style={{ background: 'oklch(0.2 0.02 258 / 0.4)', backdropFilter: 'blur(2px)' }}>
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
                  <p className="leading-5 text-[var(--muted-foreground)]">生成评标结果要求<span className="font-semibold text-[var(--foreground)]">全部专家已确认评审报告</span>。当前：</p>
                  {unconfirmed.length === 0 ? (
                    <div className="flex items-center gap-2 rounded-[12px] px-3.5 py-3 font-semibold" style={{ background: 'color-mix(in oklch, var(--success) 10%, transparent)', color: 'var(--success)' }}>
                      <CheckCircle2 size={14} /> {experts.length} 位专家已全部确认报告，可进入下一步。
                    </div>
                  ) : (
                    <div className="rounded-[12px] px-3.5 py-3" style={{ background: 'color-mix(in oklch, var(--warning) 10%, transparent)' }}>
                      <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-[var(--warning)]">
                        <Clock size={13} /> 仍有 {unconfirmed.length} 位专家未确认报告
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {unconfirmed.map(e => (
                          <span key={e.id} className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'oklch(1 0 0 / 0.7)', color: 'var(--foreground)' }}>
                            {e.expertName}{!e.signedIn && '（未签到）'}
                          </span>
                        ))}
                      </div>
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
                  disabled={wizardStep === 0 && !canGenerate}
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
            style={{ background: 'oklch(0.2 0.02 258 / 0.4)', backdropFilter: 'blur(2px)' }}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" style={{ background: 'oklch(0.2 0.02 258 / 0.4)', backdropFilter: 'blur(2px)' }}>
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
                min={1}
                max={720}
                step={1}
                value={durationHours}
                onChange={(e) => setDurationHours(Math.max(1, Math.min(720, Math.floor(Number(e.target.value) || 1))))}
                className="workbench-input w-full font-mono"
              />
              <p className="mt-2 text-[11px] tabular-nums text-[var(--muted-foreground)]">
                预计截止：{new Date(Date.now() + durationHours * 3600_000).toLocaleString('zh-CN')}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" style={{ background: 'oklch(0.2 0.02 258 / 0.4)', backdropFilter: 'blur(2px)' }}>
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
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">延长小时数</label>
              <input
                type="number"
                min={1}
                max={720}
                step={1}
                value={extendHours}
                onChange={(e) => setExtendHours(Math.max(1, Math.min(720, Math.floor(Number(e.target.value) || 1))))}
                className="workbench-input w-full font-mono"
              />
              <label className="mb-1.5 mt-4 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">延期理由</label>
              <textarea
                value={extendReason}
                onChange={(e) => setExtendReason(e.target.value)}
                rows={3}
                placeholder="请填写延期原因…"
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
