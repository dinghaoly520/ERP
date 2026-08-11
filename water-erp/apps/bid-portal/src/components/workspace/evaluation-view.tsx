'use client';

/**
 * 只读评标管理视图——:3007 项目工作区「评标管理」tab。
 * 专家状态玻璃卡（3 徽标 + 已评分工作量条 + 整体进度条 + 平均分 + 点击展开每供应商进度）、
 * 专家×供应商评分矩阵（表头解密标签 + 得分分布迷你折线，单元格悬停 CellTooltip，偏差 >20%
 * 标异常，表下展开专家明细）、供应商评分汇总（排名 / 单位 / 5 分类列「通过·不通过」结论 +
 * 数值类均分悬停专家明细 / 总分平均 / 推荐列，表头未确认红点脉冲 + 名单 hover 浮窗）。
 * 全部 className 走 cgzxui 规范（neu-card-static / neu-table / kpi-card / oklch 配色）。
 *
 * operation controls omitted (read-only tab)：旧页的阶段流转、结果生成、归档等写入操作
 * 及其向导模态已全部剥离——相关流转统一在采购管理工作台（:3005）进行，本页只读。
 *
 * 数据源改造（唯一偏离旧页逻辑处）：project 不再自取，props 优先（工作区页持有 project + 单一
 * 实时连接）、useBidProjectContext 回退（experts 元素自带 scoreRecords）；评标结果经
 * listEvaluationResults 读取：挂载拉一次 + project.stage 变化时重拉。专家签到 / 评分进度的实时
 * 刷新由页级单连接在场事件 → project prop 更新驱动，本组件无自有 socket（全程单连接）。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  UserCircle, CheckCircle, Clock, ShieldCheck, FileCheck,
  ChevronDown, ChevronRight, AlertTriangle, Play,
  Trophy, X, Users,
} from 'lucide-react';
import { CATEGORY_LABEL, CATEGORY_COLOR, DECRYPT_LABEL, isPassFailCategory } from '@water-erp/shared';
import type { BidProjectDetail } from '@/lib/types';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import { listEvaluationResults, type EvaluationResultRow } from '@/lib/api/bid';
import AiAnalysisCard from './ai-analysis-card';

/* ── Local types ── */
type ExpertInfo = BidProjectDetail['experts'][number];
type SupplierInfo = BidProjectDetail['suppliers'][number];
type ScoreItemInfo = BidProjectDetail['scoreItems'][number];

/** 后端 BidEvaluationResult 另含 disqualified / averageScore（EvaluationResultRow 仅声明子集）；本地交叉补齐。
 *  averageScore = 去极值后平均总分（官方结果优先展示列）；后端缺省时回退 totalScore。 */
type OfficialResultRow = EvaluationResultRow & { disqualified?: boolean; averageScore?: string };

interface ExpertSupplierCell {
  totalScore: number; maxScore: number; scoredCount: number; totalCount: number;
  items: { name: string; score: number; maxScore: number; passed?: boolean | null; reason?: string | null; category?: string }[];
}
type ExpertSupplierMatrix = Map<string, Map<string, ExpertSupplierCell>>;
interface SupplierCategoryCell { sum: number; max: number; count: number; }
type SupplierCategoryMatrix = Map<string, Map<string, SupplierCategoryCell>>;

const CATEGORY_ORDER = ['QUALIFICATION', 'RESPONSIVE', 'BUSINESS', 'TECHNICAL', 'PRICE'] as const;

/* ── Data aggregation ── */
function buildExpertSupplierMatrix(
  experts: ExpertInfo[], scoreItemMap: Map<string, ScoreItemInfo>, suppliers: SupplierInfo[],
): ExpertSupplierMatrix {
  const matrix: ExpertSupplierMatrix = new Map();
  for (const expert of experts) {
    const expertRow: Map<string, ExpertSupplierCell> = new Map();
    for (const supplier of suppliers) {
      expertRow.set(supplier.id, { totalScore: 0, maxScore: 0, scoredCount: 0, totalCount: scoreItemMap.size, items: [] });
    }
    for (const record of expert.scoreRecords) {
      const item = scoreItemMap.get(record.scoreItemId);
      if (!item) continue;
      const cell = expertRow.get(record.supplierId);
      if (!cell) continue;
      const score = Number(record.score);
      cell.totalScore += score; cell.maxScore += Number(item.maxScore); cell.scoredCount += 1;
      cell.items.push({ name: item.name, score, maxScore: Number(item.maxScore), passed: record.passed, reason: record.reason, category: item.category });
    }
    matrix.set(expert.id, expertRow);
  }
  return matrix;
}

function buildSupplierCategoryMatrix(
  experts: ExpertInfo[], scoreItemMap: Map<string, ScoreItemInfo>, suppliers: SupplierInfo[],
): SupplierCategoryMatrix {
  const matrix: SupplierCategoryMatrix = new Map();
  for (const supplier of suppliers) {
    const catMap: Map<string, SupplierCategoryCell> = new Map();
    for (const cat of CATEGORY_ORDER) catMap.set(cat, { sum: 0, max: 0, count: 0 });
    matrix.set(supplier.id, catMap);
  }
  for (const expert of experts) {
    for (const record of expert.scoreRecords) {
      const item = scoreItemMap.get(record.scoreItemId);
      if (!item) continue;
      const catCell = matrix.get(record.supplierId)?.get(item.category);
      if (!catCell) continue;
      catCell.sum += Number(record.score); catCell.max = Number(item.maxScore); catCell.count += 1;
    }
  }
  return matrix;
}

/* ── Ring progress chart ── */
function RingChart({ pct, size = 56, stroke = 5, color }: { pct: number; size?: number; stroke?: number; color: string }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * Math.min(1, pct / 100);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ '--ring-color': color } as React.CSSProperties}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="oklch(0.94 0.004 264)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ring-color)" strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" className="transition-all duration-1000" />
      </svg>
      <span className="absolute text-xs font-extrabold tabular-nums text-[var(--ring-color)]">{Math.round(pct)}%</span>
    </div>
  );
}

/* ── Score distribution mini line chart ── */
const CHART_STROKE = 'oklch(0.56 0.153 251)';

function DistributionChart({ scores, avg }: { scores: number[]; avg: number }) {
  if (scores.length === 0) return null;
  const w = 52, h = 28, padX = 2, padY = 4;
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const range = maxScore - minScore || 1; // avoid div-by-zero when all equal
  // Expand range by 10% so extremes don't clip at egde; keep within [0,100]
  const yMin = Math.max(0, minScore - range * 0.15);
  const yMax = Math.min(100, maxScore + range * 0.15);
  const ySpan = yMax - yMin || 1;
  const xStep = scores.length > 1 ? (w - padX * 2) / (scores.length - 1) : 0;
  const points = scores.map((s, i) => {
    const x = padX + i * xStep;
    const y = padY + (h - padY * 2) * (1 - (s - yMin) / ySpan);
    return `${x},${y}`;
  });
  const polyline = points.join(' ');
  const avgY = padY + (h - padY * 2) * (1 - (avg - yMin) / ySpan);
  return (
    <div className="relative group shrink-0" style={{ width: w, height: h }}>
      <svg width={w} height={h} className="block">
        {/* Grid line at avg */}
        <line x1={0} x2={w} y1={avgY} y2={avgY}
          stroke="oklch(0.55 0.01 264)" strokeWidth={0.5} strokeDasharray="2 2" opacity={0.5} />
        {/* Polyline */}
        <polyline points={polyline} fill="none" stroke={CHART_STROKE} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
        {/* Dots */}
        {scores.map((s, i) => {
          const x = padX + i * xStep;
          const y = padY + (h - padY * 2) * (1 - (s - yMin) / ySpan);
          return <circle key={i} cx={x} cy={y} r={2} fill="oklch(1 0 0)" stroke={CHART_STROKE} strokeWidth={1.2} />;
        })}
      </svg>
      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-[oklch(0.18_0.012_265)] px-1.5 py-0.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100 whitespace-nowrap z-10">
        均分 {avg.toFixed(0)}
      </div>
    </div>
  );
}

/* ── Tooltip — cgzxui floating panel (no border, neumorphic shadow) ── */
const TOOLTIP_PANEL =
  'fixed z-[9999] rounded-[16px] bg-[var(--background)] p-4 ' +
  'shadow-[0_20px_60px_oklch(0.55_0.03_258_/_0.12),inset_0_1px_0_oklch(1_0_0_/_0.7)]';

function CellTooltip({ cell, supplierName, expertName, onClose, anchorRect }: {
  cell: ExpertSupplierCell; supplierName: string; expertName: string; onClose: () => void;
  anchorRect: DOMRect;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; flip: boolean }>({ left: 0, top: 0, flip: false });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const h = ref.current.offsetHeight;
    const spaceAbove = anchorRect.top;
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const left = Math.min(anchorRect.left, window.innerWidth - 340);
    // Prefer above; flip below if not enough space above
    const flip = spaceAbove < h + 12 && spaceBelow > spaceAbove;
    const top = flip ? anchorRect.bottom + 8 : anchorRect.top - h - 8;
    setPos({ left, top, flip });
  }, [anchorRect]);

  return createPortal(
    <div ref={ref} className={`${TOOLTIP_PANEL} w-[320px]`} style={{ left: pos.left, top: pos.top }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-bold text-[color:var(--foreground)]">
          {expertName === '专家' ? `评标进行中，暂不公开 → ${supplierName}` : `${expertName} → ${supplierName}`}
        </span>
        <button onClick={onClose} className="text-[color:var(--muted-foreground)] hover:text-[color:var(--foreground)]"><X size={12} /></button>
      </div>
      <div className="mb-2 font-mono text-xs font-bold text-[color:var(--accent-strong)]">
        {cell.totalScore.toFixed(1)}/{cell.maxScore} ({cell.scoredCount}/{cell.totalCount} 项)
      </div>
      <div className="space-y-1.5">
        {cell.items.map(item => (
          <div key={item.name} className="flex items-center justify-between text-[11px]">
            <span className="flex-1 truncate text-[color:var(--muted-foreground)]">{item.name}</span>
            <span className="ml-2 font-mono font-bold text-[color:var(--foreground)]">{item.score}/{item.maxScore}</span>
            {item.reason && <span className="ml-1 text-[10px] text-[color:var(--muted-foreground)]">({item.reason})</span>}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

function CategoryDetailTooltip({ expertScores, onClose, anchorRect }: {
  expertScores: { name: string; score: number }[];
  onClose: () => void;
  anchorRect: DOMRect;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; flip: boolean }>({ left: 0, top: 0, flip: false });

  useLayoutEffect(() => {
    if (!ref.current) return;
    const h = ref.current.offsetHeight;
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const spaceAbove = anchorRect.top;
    const left = Math.min(anchorRect.left, window.innerWidth - 220);
    // Prefer below; flip above if not enough space below
    const flip = spaceBelow < h + 8 && spaceAbove > h + 8;
    const top = flip ? anchorRect.top - h - 4 : anchorRect.bottom + 4;
    setPos({ left, top, flip });
  }, [anchorRect]);

  return createPortal(
    <div ref={ref} className={`${TOOLTIP_PANEL} w-48 p-3`} style={{ left: pos.left, top: pos.top }}>
      <div className="mb-1.5 text-[11px] font-semibold text-[color:var(--muted-foreground)]">专家明细</div>
      {expertScores.map(es => (
        <div key={es.name} className="flex items-center justify-between py-0.5 text-[11px]">
          <span className="text-[oklch(0.55_0.01_264)]">
            {es.name === '专家' ? '评标进行中，暂不公开' : es.name}
          </span>
          <span className="font-mono font-bold text-[oklch(0.18_0.012_265)]">{es.score.toFixed(1)}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ═══ View ═══ */
export default function EvaluationView({ projectId, project: propsProject }: { projectId: string; project?: BidProjectDetail }) {
  const ctx = useBidProjectContext();
  // 工作区页级单源优先（page.tsx 持有 project + 实时），context 仅作回退。
  const project = propsProject ?? ctx.project;
  const [results, setResults] = useState<OfficialResultRow[]>([]);
  const [expandedExperts, setExpandedExperts] = useState<Set<string>>(new Set());
  const [expandedCard, setExpandedCard] = useState<Set<string>>(new Set());

  // ═══ New UX state ═══
  const [tooltip, setTooltip] = useState<{ cell: ExpertSupplierCell; expertName: string; supplierName: string; anchorRect: DOMRect } | null>(null);
  const [categoryTooltip, setCategoryTooltip] = useState<{ expertScores: { name: string; score: number }[]; anchorRect: DOMRect; key: string } | null>(null);

  /* ── Data loading：评标结果——挂载拉一次 + project.stage 变化时重拉（官方结果随阶段流转生成；
     专家签到 / 评分进度的实时刷新由页级单连接在场事件 → project prop 更新驱动，本组件无自有 socket）── */
  const loadResults = useCallback(() => {
    listEvaluationResults(projectId).then(setResults).catch(() => {});
  }, [projectId]);

  useEffect(() => { loadResults(); }, [loadResults, project?.stage]);

  /* ── Derived data ── */
  const scoreItemMap = useMemo(() => {
    if (!project) return new Map<string, ScoreItemInfo>();
    return new Map(project.scoreItems.map(si => [si.id, si]));
  }, [project]);

  const expertMatrix = useMemo(() => {
    if (!project) return new Map<string, Map<string, ExpertSupplierCell>>();
    return buildExpertSupplierMatrix(project.experts, scoreItemMap, project.suppliers);
  }, [project, scoreItemMap]);

  const categoryMatrix = useMemo(() => {
    if (!project) return new Map<string, Map<string, SupplierCategoryCell>>();
    return buildSupplierCategoryMatrix(project.experts, scoreItemMap, project.suppliers);
  }, [project, scoreItemMap]);

  const allReportsConfirmed = useMemo(() => {
    if (!project) return false;
    if (project.experts.length === 0) return false;
    return project.experts.every(e => e.reportConfirmed);
  }, [project]);

  const unconfirmedCount = useMemo(() => {
    if (!project) return 0;
    return project.experts.filter(e => !e.reportConfirmed).length;
  }, [project]);

  const unconfirmedNames = useMemo(() => {
    if (!project) return [];
    return project.experts.filter(e => !e.reportConfirmed).map(e => e.expertName);
  }, [project]);

  // ═══ Progress dashboard metrics ═══
  const dashMetrics = useMemo(() => {
    if (!project) return null;
    const { experts, suppliers } = project;
    // 进度按「评分项完成度」计算（专家×供应商×评分项），而非 slot 只要有 1 条记录即记满
    const itemCount = project.scoreItems?.length ?? 0;
    const totalItemSlots = experts.length * suppliers.length * itemCount;
    let scoredItems = 0;
    for (const expert of experts) {
      const row = expertMatrix.get(expert.id);
      if (row) for (const supplier of suppliers) {
        const cell = row.get(supplier.id);
        if (cell) scoredItems += Math.min(cell.scoredCount, itemCount);
      }
    }
    const scorePct = totalItemSlots > 0 ? Math.round((scoredItems / totalItemSlots) * 100) : 0;
    const signedIn = experts.filter(e => e.signedIn).length;
    const reportsDone = experts.filter(e => e.reportConfirmed).length;
    const canGenerate = allReportsConfirmed;
    return { scorePct, signedIn, total: experts.length, reportsDone, canGenerate };
  }, [project, expertMatrix, allReportsConfirmed]);

  const supplierRanks = useMemo(() => {
    if (!project) return new Map<string, number>();
    // 官方结果已生成 → 直接用官方 rank（含去极值后的排序与废标置后）
    if (results.length > 0) {
      return new Map(results.map(r => [r.supplierId, r.rank]));
    }
    // 未生成：实时均分排名（仅供参考）
    const entries: { supplierId: string; avg: number }[] = [];
    for (const supplier of project.suppliers) {
      const catMap = categoryMatrix.get(supplier.id);
      if (!catMap) continue;
      let total = 0;
      for (const cat of CATEGORY_ORDER) {
        const cell = catMap.get(cat);
        if (cell && cell.count > 0) total += cell.sum / cell.count;
      }
      entries.push({ supplierId: supplier.id, avg: total });
    }
    entries.sort((a, b) => b.avg - a.avg);
    const rankMap = new Map<string, number>();
    let rank = 1;
    for (let i = 0; i < entries.length; i++) {
      if (i > 0 && entries[i].avg < entries[i - 1].avg) rank = i + 1;
      rankMap.set(entries[i].supplierId, rank);
    }
    return rankMap;
  }, [project, categoryMatrix, results]);

  const rankedSuppliers = useMemo(() => {
    if (!project) return [];
    // 官方结果已生成 → 按官方 rank 排序（废标置后），否则按实时均分
    if (results.length > 0) {
      const rankOf = new Map(results.map(r => [r.supplierId, r.rank]));
      return [...project.suppliers].sort((a, b) => (rankOf.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rankOf.get(b.id) ?? Number.MAX_SAFE_INTEGER));
    }
    return [...project.suppliers].sort((a, b) => {
      const catMapA = categoryMatrix.get(a.id);
      const catMapB = categoryMatrix.get(b.id);
      let totalA = 0, totalB = 0;
      for (const cat of CATEGORY_ORDER) {
        const cellA = catMapA?.get(cat);
        const cellB = catMapB?.get(cat);
        if (cellA && cellA.count > 0) totalA += cellA.sum / cellA.count;
        if (cellB && cellB.count > 0) totalB += cellB.sum / cellB.count;
      }
      return totalB - totalA;
    });
  }, [project, categoryMatrix, results]);

  // ═══ Anomaly detection ═══
  const anomalyThreshold = 20; // deviation >20% flagged
  const supplierAverages = useMemo(() => {
    if (!project) return new Map<string, number>();
    const avgs = new Map<string, number>();
    for (const supplier of project.suppliers) {
      const scores: number[] = [];
      for (const expert of project.experts) {
        const cell = expertMatrix.get(expert.id)?.get(supplier.id);
        if (cell && cell.maxScore > 0) scores.push((cell.totalScore / cell.maxScore) * 100);
      }
      avgs.set(supplier.id, scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0);
    }
    return avgs;
  }, [project, expertMatrix]);

  /* ── empty ── */
  if (!project) return <div className="py-16 text-center text-[13px] text-[color:var(--muted-foreground)]">暂无评标数据</div>;

  const { experts, suppliers } = project;

  return (
    <div className="space-y-6">
      {/* ═══ Progress dashboard ═══ */}
      {/* ═══ AI 辅助评标进度（只读 tab 的窄例外：补救操作不改阶段）═══ */}
      <AiAnalysisCard projectId={projectId} stage={project.stage} />
      {dashMetrics && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {/* 评分进度 */}
          <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">评分进度</span>
            <div className="flex items-center gap-2">
              <RingChart pct={dashMetrics.scorePct} size={40} stroke={4} color={
                dashMetrics.scorePct >= 80 ? 'oklch(0.54 0.16 158)' : dashMetrics.scorePct >= 50 ? 'oklch(0.56 0.153 251)' : 'oklch(0.64 0.16 82)'
              } />
              <span className="text-[1.35rem] font-black leading-none tracking-[-0.04em] tabular-nums text-[color:var(--foreground)]">{dashMetrics.scorePct}%</span>
            </div>
            <span className="text-[10px] font-medium text-[color:var(--muted-foreground)]">
              {dashMetrics.scorePct >= 80 ? '即将完成全部评分' : dashMetrics.scorePct >= 50 ? '评分进行中' : '评分刚起步'}
            </span>
          </div>
          {/* 专家签到 */}
          <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">专家签到</span>
              <Users size={14} className="text-[color:var(--muted-foreground)]" />
            </div>
            <span className="text-[1.55rem] font-black leading-none tracking-[-0.04em] tabular-nums text-[color:var(--foreground)]">
              <span className="text-[oklch(0.54_0.16_158)]">{dashMetrics.signedIn}</span>
              <span className="text-[color:var(--muted-foreground)]">/{dashMetrics.total}</span>
            </span>
            <span className="text-[10px] font-medium text-[color:var(--muted-foreground)]">已签到 / 总计</span>
          </div>
          {/* 报告确认 */}
          <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">报告确认</span>
              <FileCheck size={14} className="text-[color:var(--muted-foreground)]" />
            </div>
            <span className="text-[1.55rem] font-black leading-none tracking-[-0.04em] tabular-nums text-[color:var(--foreground)]">
              <span className="text-[oklch(0.54_0.16_158)]">{dashMetrics.reportsDone}</span>
              <span className="text-[color:var(--muted-foreground)]">/{dashMetrics.total}</span>
            </span>
            <span className="text-[10px] font-medium text-[color:var(--muted-foreground)]">报告已确认 / 总计</span>
          </div>
          {/* 可生成结果 */}
          <div className="kpi-card flex h-full flex-col gap-1.5 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">可生成结果</span>
              {dashMetrics.canGenerate ? <CheckCircle size={14} className="text-[oklch(0.54_0.16_158)]" /> : <Clock size={14} className="text-[color:var(--muted-foreground)]" />}
            </div>
            <span className="text-[1.55rem] font-black leading-none tracking-[-0.04em] text-[color:var(--foreground)]">{dashMetrics.canGenerate ? '是' : '否'}</span>
            <span className="text-[10px] font-medium text-[color:var(--muted-foreground)]">
              {dashMetrics.canGenerate ? '所有报告已确认' : `仍有 ${unconfirmedCount} 位未确认`}
            </span>
          </div>
        </div>
      )}

      {/* ═══ Stage transition（只读横幅：operation controls omitted，流转在 :3005）═══ */}
      {project.stage === 'OPENING' && (
        <div className="flex items-center justify-between rounded-[16px] bg-[oklch(0.96_0.02_251_/_0.5)] p-4">
          <div className="flex items-center gap-3">
            <Play size={16} strokeWidth={1.5} className="text-[color:var(--accent-strong)]" />
            <div>
              <span className="text-sm font-bold text-[color:var(--accent-strong)]">当前阶段：在线开标</span>
              <span className="ml-2 text-xs text-[color:var(--muted-foreground)]">— 评标启动 / 生成结果 / 归档均在采购管理工作台（:3005）进行，本页只读</span>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Section 1: Expert status cards ═══ */}
      <div className="neu-card-static overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3.5">
          <h2 className="text-[13px] font-semibold tracking-tight text-[color:var(--foreground)]">专家状态</h2>
        </div>
        <hr className="wb-section-rule" />
        <div className="p-5">
        {experts.length === 0 ? (
          <div className="flex items-center gap-2 rounded-[12px] bg-[oklch(0.97_0.02_260_/_0.5)] p-4">
            <AlertTriangle size={14} strokeWidth={1.5} className="text-[oklch(0.55_0.01_264)]" />
            <span className="text-[12px] text-[color:var(--foreground)]">暂无专家数据，请先配置评标专家。</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-4">
            {experts.map(expert => {
              const isExpanded = expandedCard.has(expert.id);
              const row = expertMatrix.get(expert.id);
              const supplierCount = suppliers.length;
              // 平均分用「本卡所依赖矩阵中已评分供应商的 per-supplier 总分均值」，与下方
              // 评分矩阵单元格同口径同数据源；不读持久化 expert.totalScore（种子未回填恒 0，
              // 且其运行时口径仅含活跃供应商，会与含 DANGER 的矩阵矛盾——旧页此处即 0.0，
              // 系数据缺陷非设计，故在保持界面逐字不变的前提下校正该单一数值）。
              const scoredCells = row ? Array.from(row.values()).filter(c => c.scoredCount > 0) : [];
              const scoredCount = scoredCells.length;
              return (
                <div key={expert.id}
                  className={`min-w-[240px] flex-1 cursor-pointer rounded-[16px] p-4 transition-all duration-300 neu-card-static ${
                    expert.signedIn && expert.avoidanceConfirmed && expert.reportConfirmed
                      ? 'hover:translate-y-[-1px]'
                      : 'hover:translate-y-[-1px]'
                  }`}
                  onClick={() => setExpandedCard(prev => { const next = new Set(prev); if (isExpanded) next.delete(expert.id); else next.add(expert.id); return next; })}
                >
                  {/* Name + specialty */}
                  <div className="mb-3 flex items-center gap-2">
                    <UserCircle size={14} strokeWidth={1.5} className="shrink-0 text-[oklch(0.42_0.14_260)]" />
                    <span className="truncate text-[13px] font-semibold tracking-tight text-[color:var(--foreground)]">
                      {expert.expertName}
                    </span>
                    {expert.major && <span className="shrink-0 text-[11px] text-[color:var(--muted-foreground)]">{expert.major}</span>}
                    {isExpanded ? <ChevronDown size={12} className="ml-auto text-[color:var(--muted-foreground)]" /> : <ChevronRight size={12} className="ml-auto text-[color:var(--muted-foreground)]" />}
                  </div>

                  {/* Status badges */}
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      expert.signedIn
                        ? 'bg-[oklch(0.96_0.03_158_/_0.6)] text-[oklch(0.54_0.16_158)]'
                        : 'bg-[oklch(0.97_0.004_264_/_0.6)] text-[oklch(0.62_0.008_264)]'
                    }`}>
                      {expert.signedIn ? <CheckCircle size={10} strokeWidth={2} /> : <Clock size={10} strokeWidth={2} />}
                      {expert.signedIn ? '已签到' : '未签到'}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      expert.avoidanceConfirmed
                        ? 'bg-[oklch(0.96_0.03_158_/_0.6)] text-[oklch(0.54_0.16_158)]'
                        : 'bg-[oklch(0.96_0.04_85_/_0.6)] text-[oklch(0.64_0.16_82)]'
                    }`}>
                      <ShieldCheck size={10} strokeWidth={2} />{expert.avoidanceConfirmed ? '已回避' : '未回避'}
                    </span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      expert.reportConfirmed
                        ? 'bg-[oklch(0.96_0.03_158_/_0.6)] text-[oklch(0.54_0.16_158)]'
                        : 'bg-[oklch(0.97_0.004_264_/_0.6)] text-[oklch(0.55_0.01_264)]'
                    }`}>
                      <FileCheck size={10} strokeWidth={2} />{expert.reportConfirmed ? '报告已确认' : '报告未确认'}
                    </span>
                  </div>

                  {/* Scoring workload */}
                  <div className="mb-2">
                    <div className="mb-1 flex items-center justify-between text-[10px] text-[color:var(--muted-foreground)]">
                      <span>已评分</span>
                      <span className="font-mono">{scoredCount}/{supplierCount} 供应商</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[oklch(0.94_0.004_264)]">
                      <div className="h-full rounded-full bg-[oklch(0.42_0.14_260)] transition-all"
                        style={{ width: `${supplierCount > 0 ? (scoredCount / supplierCount) * 100 : 0}%` }} />
                    </div>
                  </div>

                  {/* Progress + total */}
                  <div className="mb-1 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-[oklch(0.94_0.004_264)]">
                      <div className="h-full rounded-full bg-[oklch(0.42_0.14_260)] transition-all" style={{ width: `${expert.progress}%` }} />
                    </div>
                    <span className="font-mono text-[11px] font-semibold text-[oklch(0.42_0.14_260)]">{expert.progress}%</span>
                  </div>
                  <div className="text-[12px] text-[color:var(--muted-foreground)]">
                    平均分 <span className="font-mono font-bold text-[color:var(--foreground)]">{scoredCount > 0 ? (scoredCells.reduce((s, c) => s + c.totalScore, 0) / scoredCount).toFixed(1) : '0.0'}</span>
                  </div>

                  {/* Expandable: per-supplier progress */}
                  {isExpanded && row && (
                    <div className="mt-3 space-y-1.5 border-t border-[oklch(0.94_0.004_264)] pt-3">
                      {suppliers.map(supplier => {
                        const cell = row.get(supplier.id);
                        const spct = cell && cell.totalCount > 0 ? Math.round((cell.scoredCount / cell.totalCount) * 100) : 0;
                        return (
                          <div key={supplier.id} className="flex items-center gap-2 text-[11px]">
                            <span className="w-20 truncate text-[color:var(--muted-foreground)]">{supplier.supplierName}</span>
                            <div className="h-1 flex-1 rounded-full bg-[oklch(0.94_0.004_264)]">
                              <div className={`h-full rounded-full transition-all ${
                                spct >= 100 ? 'bg-[oklch(0.54_0.16_158)]' : spct > 0 ? 'bg-[oklch(0.56_0.153_251)]' : 'bg-[oklch(0.88_0.006_264)]'
                              }`} style={{ width: `${spct}%` }} />
                            </div>
                            <span className="w-10 text-right font-mono font-bold tabular-nums">{cell ? `${cell.totalScore.toFixed(0)}` : '—'}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {/* ═══ Section 2: Expert×Supplier matrix ═══ */}
      {suppliers.length === 0 ? (
        <div className="mb-8 flex items-center gap-2 rounded-[12px] bg-[oklch(0.97_0.02_260_/_0.5)] p-4">
          <AlertTriangle size={14} strokeWidth={1.5} className="text-[oklch(0.55_0.01_264)]" />
          <span className="text-[12px] text-[color:var(--foreground)]">暂无供应商数据。</span>
        </div>
      ) : (
        <div className="neu-card-static mb-8">
          <div className="flex items-center px-5 py-4">
            <h2 className="text-[13px] font-semibold tracking-tight text-[color:var(--foreground)]">
              专家评分概览
            </h2>
          </div>
          <hr className="wb-section-rule" />
          {experts.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-[color:var(--muted-foreground)]">暂无专家数据</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="neu-table mx-auto">
                <thead>
                  <tr className="text-[color:var(--muted-foreground)]">
                    <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap">专家</th>
                    {suppliers.map(s => {
                      const scores = experts.map(e => {
                        const cell = expertMatrix.get(e.id)?.get(s.id);
                        return cell && cell.maxScore > 0 ? (cell.totalScore / cell.maxScore) * 100 : null;
                      }).filter(Boolean) as number[];
                      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
                      return (
                        <th key={s.id} className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap">
                          <div className="text-[color:var(--foreground)]">{s.supplierName}</div>
                          <div className="mt-1 flex items-center justify-center gap-2">
                            <span className="text-[10px] font-normal text-[color:var(--muted-foreground)]">{DECRYPT_LABEL[s.decryptStatus] || s.decryptStatus}</span>
                            {scores.length > 1 && <DistributionChart scores={scores} avg={avg} />}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {experts.map(expert => {
                    const isExpanded = expandedExperts.has(expert.id);
                    const row = expertMatrix.get(expert.id);
                    const hasAnyScore = Array.from(row?.values() ?? []).some(c => c.scoredCount > 0);
                    return (
                      <tr key={expert.id}>
                        <td className="px-5 py-3">
                          <button onClick={() => setExpandedExperts(prev => { const next = new Set(prev); if (isExpanded) next.delete(expert.id); else next.add(expert.id); return next; })} disabled={!hasAnyScore}
                            className={`inline-flex items-center gap-1.5 text-left transition-colors ${hasAnyScore ? 'cursor-pointer hover:text-[oklch(0.42_0.14_260)]' : 'cursor-default'}`}>
                            {hasAnyScore && (isExpanded ? <ChevronDown size={12} strokeWidth={1.5} className="shrink-0 text-[color:var(--muted-foreground)]" /> : <ChevronRight size={12} strokeWidth={1.5} className="shrink-0 text-[color:var(--muted-foreground)]" />)}
                            <span className="text-[13px] font-semibold tracking-tight text-[color:var(--foreground)]">{expert.expertName}</span>
                          </button>
                        </td>
                        {suppliers.map(s => {
                          const cell = row?.get(s.id);
                          const avg = supplierAverages.get(s.id) ?? 0;
                          const cellPct = cell && cell.maxScore > 0 ? (cell.totalScore / cell.maxScore) * 100 : null;
                          const isAnomaly = cellPct !== null && avg > 0 && Math.abs(cellPct - avg) > anomalyThreshold;
                          if (!cell || cell.scoredCount === 0) {
                            return <td key={s.id} className="px-5 py-3 text-[12px] text-[color:var(--muted-foreground)]">—</td>;
                          }
                          return (
                            <td key={s.id} className="px-5 py-3">
                              <div className={`relative inline-flex cursor-default items-center gap-1 rounded-md px-2 py-1 transition-all ${
                                isAnomaly ? 'bg-[oklch(0.97_0.04_83_/_0.5)]' : ''
                              }`}
                                onMouseEnter={(e) => setTooltip({ cell, expertName: expert.expertName, supplierName: s.supplierName, anchorRect: e.currentTarget.getBoundingClientRect() })}
                                onMouseLeave={() => setTooltip(null)}
                              >
                                <span className="font-mono text-[color:var(--foreground)]">
                                  <span className="font-bold">{cell.totalScore.toFixed(1)}</span>
                                  <span className="text-[color:var(--muted-foreground)]">/{cell.maxScore}</span>
                                </span>
                                <span className="text-[11px] text-[color:var(--muted-foreground)]">({cell.scoredCount})</span>
                                {isAnomaly && <AlertTriangle size={10} className="text-[oklch(0.64_0.16_82)]" />}
                                {tooltip && tooltip.expertName === expert.expertName && tooltip.supplierName === s.supplierName && (
                                  <CellTooltip cell={cell} expertName={expert.expertName} supplierName={s.supplierName}
                                    anchorRect={tooltip.anchorRect}
                                    onClose={() => setTooltip(null)} />
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {/* Expanded detail panels — one per expanded expert */}
              {[...expandedExperts].map(expId => {
                const expert = experts.find(e => e.id === expId);
                if (!expert) return null;
                const row = expertMatrix.get(expId);
                if (!row) return null;
                return (
                  <div key={expId} className="border-t border-[oklch(0.91_0.006_264)]">
                    <div className="bg-[oklch(0.98_0.005_264_/_0.5)] p-5">
                      <div className="mb-3 text-[12px] font-semibold tracking-tight text-[oklch(0.42_0.14_260)]">
                        {expert.expertName} 详细评分
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        {suppliers.map(supplier => {
                          const cell = row.get(supplier.id);
                          if (!cell || cell.scoredCount === 0) return null;
                          return (
                            <div key={supplier.id} className="neu-card-static p-4">
                              <div className="mb-2 text-[13px] font-semibold tracking-tight text-[color:var(--foreground)]">{supplier.supplierName}</div>
                              {cell.items.map(item => (
                                <div key={item.name} className="flex items-center justify-between border-b border-[oklch(0.94_0.004_264)] py-1.5 text-[12px] last:border-0">
                                  <span className="text-[color:var(--muted-foreground)]">{item.name}</span>
                                  <span className="font-mono">
                                    <span className="font-bold text-[color:var(--foreground)]">{item.score}</span>
                                    <span className="text-[color:var(--muted-foreground)]">/{item.maxScore}</span>
                                    {item.reason && <span className="ml-1.5 text-[11px] text-[color:var(--muted-foreground)]">({item.reason})</span>}
                                  </span>
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ Section 3: Supplier score summary ═══ */}
      {suppliers.length > 0 && (
        <div className="neu-card-static mb-8">
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <h2 className="text-[13px] font-semibold tracking-tight text-[color:var(--foreground)]">
                供应商评分汇总
              </h2>
              <p className="mt-1 text-[11px] text-[color:var(--muted-foreground)]">各分类展示专家均分。尚无官方结果时排名/总分为实时参考值（未去极值）；官方结果生成后以其为准（≥5 专家去 1 高 1 低、废标置后）。悬停分类得分查看专家明细。</p>
            </div>
            <div className="flex items-center gap-3">
              {!allReportsConfirmed && experts.length > 0 && (
                <span className="group relative inline-flex cursor-default items-center gap-1.5 text-[11px] font-semibold text-[oklch(0.55_0.13_70)]" title={unconfirmedNames.join('、')}>
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--danger)] opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--danger)]" />
                  </span>
                  {unconfirmedCount} 位未确认
                  <span className="absolute right-0 top-full mt-1 z-50 w-48 rounded-[12px] bg-[var(--background)] p-2.5 text-left text-[11px] font-normal text-[color:var(--muted-foreground)] opacity-0 shadow-[0_12px_40px_oklch(0.55_0.03_258_/_0.1),inset_0_1px_0_oklch(1_0_0_/_0.7)] transition group-hover:visible group-hover:opacity-100">
                    {unconfirmedNames.map((n, i) => <div key={n} className="py-0.5">{i + 1}. {n}</div>)}
                  </span>
                </span>
              )}
            </div>
          </div>
          <hr className="wb-section-rule" />
          <div className="overflow-x-auto overflow-y-visible">
            <table className="neu-table mx-auto">
              <thead>
                <tr className="relative z-0 text-[color:var(--muted-foreground)]">
                  <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap" title="按专家总分均分排名，同分同名次（竞赛式）">排名</th>
                  <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap">投标单位</th>
                  {CATEGORY_ORDER.map(cat => (
                    <th key={cat} className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap">{CATEGORY_LABEL[cat] || cat}</th>
                  ))}
                  <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap" title="商务+技术+价格分类均分之和，满分 100">总分(平均)</th>
                  {results.length > 0 && (
                    <th className="px-5 py-3 text-[11px] font-medium uppercase tracking-wider whitespace-nowrap">推荐</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rankedSuppliers.map(supplier => {
                  const catMap = categoryMatrix.get(supplier.id);
                  const rank = supplierRanks.get(supplier.id);
                  // 总分(平均)：各分类均分之和（与 per-category 显示值同源，确保自洽）
                  let total = 0;
                  if (catMap) {
                    for (const cat of CATEGORY_ORDER) {
                      if (isPassFailCategory(cat)) continue;
                      const cell = catMap.get(cat);
                      if (cell && cell.count > 0) total += cell.sum / cell.count;
                    }
                  }
                  const evalResult = results.find(r => r.supplierId === supplier.id);
                  // 官方结果已生成 → 显示官方 averageScore（去极值后，缺省回退 totalScore）；否则实时均分（仅供参考）
                  const overallAvg = evalResult
                    ? Number(evalResult.averageScore ?? evalResult.totalScore).toFixed(1)
                    : (total > 0 ? total.toFixed(1) : null);
                  return (
                    <tr key={supplier.id} className={`transition-colors ${evalResult?.disqualified ? 'opacity-60' : ''}`}>
                      <td className="px-5 py-3">
                        {rank != null ? (
                          <span className="font-mono font-bold text-[color:var(--foreground)] transition-all duration-300">#{rank}</span>
                        ) : <span className="text-[12px] text-[color:var(--muted-foreground)]">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 font-semibold text-[color:var(--foreground)]">{supplier.supplierName}</td>
                      {CATEGORY_ORDER.map(cat => {
                        const cell = catMap?.get(cat);
                        // ── Pass-fail categories: show verdict ──
                        if (isPassFailCategory(cat)) {
                          let passCount = 0, failCount = 0;
                          for (const expert of experts) {
                            const expertCell = expertMatrix.get(expert.id)?.get(supplier.id);
                            if (expertCell) {
                              const catItems = expertCell.items.filter(i => i.category === cat);
                              for (const it of catItems) {
                                if (it.passed === false) failCount++;
                                else if (it.passed === true) passCount++;
                              }
                            }
                          }
                          const hasVerdict = passCount + failCount > 0;
                          const failed = failCount > passCount;
                          return (
                            <td key={cat} className="px-5 py-3">
                              {hasVerdict ? (
                                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold ${
                                  failed
                                    ? 'bg-[oklch(0.97_0.03_22_/_0.5)] text-[var(--danger)]'
                                    : 'bg-[oklch(0.96_0.03_158_/_0.5)] text-[oklch(0.54_0.16_158)]'
                                }`}>
                                  {failed ? '不通过' : '通过'}
                                </span>
                              ) : <span className="text-[12px] text-[color:var(--muted-foreground)]">—</span>}
                            </td>
                          );
                        }
                        // ── Numeric categories: show avg ──
                        const hasData = cell && cell.count > 0;
                        const avg = hasData ? (cell!.sum / cell!.count).toFixed(1) : null;
                        const expertScores: { name: string; score: number }[] = [];
                        if (catMap) {
                          for (const expert of experts) {
                            const expertCell = expertMatrix.get(expert.id)?.get(supplier.id);
                            if (expertCell) {
                              const catItems = expertCell.items.filter(i => i.category === cat);
                              const catTotal = catItems.reduce((a, b) => a + b.score, 0);
                              if (catItems.length > 0) expertScores.push({ name: expert.expertName, score: catTotal });
                            }
                          }
                        }
                        return (
                          <td key={cat} className="px-5 py-3">
                            {avg != null ? (
                              <span className="inline-flex cursor-default items-center gap-1.5"
                                onMouseEnter={(e) => setCategoryTooltip({ expertScores, anchorRect: e.currentTarget.getBoundingClientRect(), key: `${supplier.id}-${cat}` })}
                                onMouseLeave={() => setCategoryTooltip(null)}
                              >
                                <span className="h-3 w-0.5 shrink-0 bg-[var(--cat-accent)]" style={{ '--cat-accent': CATEGORY_COLOR[cat] } as React.CSSProperties} />
                                <span className="font-mono font-bold text-[color:var(--foreground)]">{avg}</span>
                                {categoryTooltip && categoryTooltip.key === `${supplier.id}-${cat}` && (
                                  <CategoryDetailTooltip expertScores={categoryTooltip.expertScores}
                                    anchorRect={categoryTooltip.anchorRect}
                                    onClose={() => setCategoryTooltip(null)} />
                                )}
                              </span>
                            ) : <span className="text-[12px] text-[color:var(--muted-foreground)]">—</span>}
                          </td>
                        );
                      })}
                      <td className="px-5 py-3">
                        {overallAvg != null ? (
                          <span className="font-mono font-bold text-[oklch(0.42_0.14_260)]">{overallAvg}</span>
                        ) : <span className="text-[12px] text-[color:var(--muted-foreground)]">—</span>}
                      </td>
                      {results.length > 0 && (
                          <td className="px-5 py-3">
                            {evalResult?.disqualified ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.97_0.03_22_/_0.5)] px-2.5 py-1 text-[11px] font-bold tracking-wide text-[var(--danger)]">
                                废标（资格/响应性不通过）
                              </span>
                            ) : evalResult?.recommended ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.96_0.03_158_/_0.5)] px-2.5 py-1 text-[11px] font-bold tracking-wide text-[oklch(0.54_0.16_158)]">
                                <Trophy size={11} /> 第一中标候选人
                              </span>
                            ) : <span className="text-[11px] text-[color:var(--muted-foreground)]">—</span>}
                          </td>
                        )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {allReportsConfirmed || project?.stage !== 'EVALUATING' ? null : (
              <p className="mt-3 text-[11px] text-[color:var(--muted-foreground)]">匿名模式下展示均分，专家个人分数待报告确认后公开。</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
