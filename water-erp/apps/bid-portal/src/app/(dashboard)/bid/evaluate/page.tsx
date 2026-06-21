'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail, BidExpert, BidSupplier, BidScoreItem } from '@/lib/types';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import { CATEGORY_LABEL, CATEGORY_COLOR, DECRYPT_LABEL } from '@water-erp/shared';

import { TableSkeleton } from '@/components/skeleton';
import { MetricCard, PageHero, SectionCard } from '@water-erp/ui';
import { useBidWebSocket } from '@/hooks/use-bid-websocket';
import { ConnectionIndicator } from '@/components/connection-indicator';
import { toast } from 'sonner';
import {
  UserCircle, CheckCircle, Clock, ShieldCheck, FileCheck,
  ChevronDown, ChevronRight, AlertTriangle, Play, Gauge,
  TrendingUp, ClipboardCheck, Star, Trophy, X, Sparkles, Users,
} from 'lucide-react';

/* ── Local types ── */
interface ExpertScoreRecord {
  id: string; expertId: string; scoreItemId: string; supplierId: string;
  score: string; reason?: string | null;
}
interface BidExpertWithScores extends BidExpert {
  scoreRecords: ExpertScoreRecord[];
}
interface BidProjectEvalDetail extends Omit<BidProjectDetail, 'experts'> {
  experts: BidExpertWithScores[];
}
interface EvalResult {
  id: string; supplierId: string; supplierName: string;
  totalScore: string; averageScore: string;
  rank: number; recommended: boolean; generatedAt: string;
}
interface ExpertSupplierCell {
  totalScore: number; maxScore: number; scoredCount: number; totalCount: number;
  items: { name: string; score: number; maxScore: number; reason?: string | null; category?: string }[];
}
type ExpertSupplierMatrix = Map<string, Map<string, ExpertSupplierCell>>;
interface SupplierCategoryCell { sum: number; max: number; count: number; }
type SupplierCategoryMatrix = Map<string, Map<string, SupplierCategoryCell>>;

const CATEGORY_ORDER = ['QUALIFICATION', 'RESPONSIVE', 'BUSINESS', 'TECHNICAL', 'PRICE'] as const;

/* ── Data aggregation ── */
function buildExpertSupplierMatrix(
  experts: BidExpertWithScores[], scoreItemMap: Map<string, BidScoreItem>, suppliers: BidSupplier[],
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
      cell.items.push({ name: item.name, score, maxScore: Number(item.maxScore), reason: record.reason, category: item.category });
    }
    matrix.set(expert.id, expertRow);
  }
  return matrix;
}

function buildSupplierCategoryMatrix(
  experts: BidExpertWithScores[], scoreItemMap: Map<string, BidScoreItem>, suppliers: BidSupplier[],
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
      catCell.sum += Number(record.score); catCell.max += Number(item.maxScore); catCell.count += 1;
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
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="oklch(0.94 0.004 264)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" className="transition-all duration-1000" />
      </svg>
      <span className="absolute text-xs font-extrabold tabular-nums" style={{ color }}>{Math.round(pct)}%</span>
    </div>
  );
}

/* ── Score distribution mini chart ── */
function DistributionChart({ scores, avg }: { scores: number[]; avg: number }) {
  if (scores.length === 0) return null;
  return (
    <div className="flex items-end gap-0.5 h-8">
      {scores.map((s, i) => (
        <div key={i} className="relative group">
          <div className="w-1.5 rounded-t-sm transition-all" style={{
            height: `${Math.max(4, (s / 100) * 32)}px`,
            backgroundColor: s >= 85 ? '#11a874' : s >= 70 ? '#064ea2' : s >= 55 ? '#d97706' : '#dc2626',
            opacity: 0.7,
          }} />
          <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-[#18243a] text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition whitespace-nowrap z-10">
            {s.toFixed(0)}
          </div>
        </div>
      ))}
      <div className="w-px h-full bg-[oklch(0.55_0.01_264)]/40 ml-0.5" title={`平均 ${avg.toFixed(1)}`} />
    </div>
  );
}

/* ── Tooltip ── */
function CellTooltip({ cell, supplierName, expertName, onClose }: {
  cell: ExpertSupplierCell; supplierName: string; expertName: string; onClose: () => void;
}) {
  return (
    <div className="absolute z-50 left-full top-0 ml-2 w-[320px] rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-[0_18px_60px_rgba(15,47,87,0.15)]"
      onMouseLeave={onClose}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-[#18243a]">{expertName} → {supplierName}</span>
        <button onClick={onClose} className="text-[#8a99ad] hover:text-[#18243a]"><X size={12} /></button>
      </div>
      <div className="text-xs font-mono font-bold mb-2" style={{ color: '#064ea2' }}>
        {cell.totalScore.toFixed(1)}/{cell.maxScore} ({cell.scoredCount}/{cell.totalCount} 项)
      </div>
      <div className="space-y-1.5">
        {cell.items.map(item => (
          <div key={item.name} className="flex items-center justify-between text-[11px]">
            <span className="text-[#5a6d8a] truncate flex-1">{item.name}</span>
            <span className="font-mono font-bold text-[#18243a] ml-2">{item.score}/{item.maxScore}</span>
            {item.reason && <span className="text-[10px] text-[#8a99ad] ml-1">({item.reason})</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══ Page ═══ */
export default function BidEvaluatePage() {
  const { projectId } = useBidProjectContext();
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<BidProjectEvalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [generating, setGenerating] = useState(false);
  const [startingEvaluation, setStartingEvaluation] = useState(false);
  const [expandedExpert, setExpandedExpert] = useState<string | null>(null);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  // ═══ New UX state ═══
  const [tooltip, setTooltip] = useState<{ cell: ExpertSupplierCell; expertName: string; supplierName: string } | null>(null);
  const [wizardStep, setWizardStep] = useState<0 | 1 | 2>(0);
  const [showWizard, setShowWizard] = useState(false);
  const [revealResults, setRevealResults] = useState(false);

  /* ── Data loading ── */
  const loadProject = useCallback(async () => {
    if (!projectId) return;
    setError(null);
    setLoading(true);
    try {
      const p = await api.get<BidProjectEvalDetail>(`/bid/projects/${projectId}`);
      setProject(p);
      api.get<EvalResult[]>(`/bid/projects/${projectId}/evaluation-results`).then(setResults).catch(() => setResults([]));
    } catch (e: any) {
      setError(e?.message || '加载评标数据失败');
      toast.error(e?.message || '加载评标数据失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    loadProject();
  }, [projectId, loadProject]);

  /* ── WebSocket: live scoring updates ── */
  const { connection, lastEventAt, reconnectNow } = useBidWebSocket(projectId ?? undefined, {
    onStageChange: () => {
      if (projectId) api.get<BidProjectEvalDetail>(`/bid/projects/${projectId}`).then(setProject);
    },
  });


  /* ── Operations ── */
  const handleGenerate = async () => {
    if (!projectId) return;
    setGenerating(true);
    try {
      const r = await api.post<EvalResult[]>(`/bid/projects/${projectId}/evaluation-results/generate`, {});
      setResults(r);
      setShowWizard(false);
      setWizardStep(0);
      // Reveal results with staggered animation
      setRevealResults(true);
    } catch (e: any) { toast.error(e.message || '生成失败'); }
    setGenerating(false);
  };

  const handleStartEvaluation = async () => {
    if (!projectId) return;
    setStartingEvaluation(true);
    try {
      await api.post(`/bid/projects/${projectId}/start-evaluation`, {});
      const updated = await api.get<BidProjectEvalDetail>(`/bid/projects/${projectId}`);
      setProject(updated);
      toast.success('评标已启动，项目进入评标阶段');
    } catch (e: any) { toast.error(e.message || '启动评标失败'); }
    setStartingEvaluation(false);
  };

  /* ── Derived data ── */
  const scoreItemMap = useMemo(() => {
    if (!project) return new Map<string, BidScoreItem>();
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
    const totalSlots = experts.length * suppliers.length;
    let scoredSlots = 0;
    for (const expert of experts) {
      const row = expertMatrix.get(expert.id);
      if (row) for (const supplier of suppliers) {
        const cell = row.get(supplier.id);
        if (cell && cell.scoredCount > 0) scoredSlots++;
      }
    }
    const scorePct = totalSlots > 0 ? Math.round((scoredSlots / totalSlots) * 100) : 0;
    const signedIn = experts.filter(e => e.signedIn).length;
    const reportsDone = experts.filter(e => e.reportConfirmed).length;
    const canGenerate = allReportsConfirmed;
    return { scorePct, signedIn, total: experts.length, reportsDone, canGenerate };
  }, [project, expertMatrix, allReportsConfirmed]);

  const supplierRanks = useMemo(() => {
    if (!project) return new Map<string, number>();
    const entries: { supplierId: string; avg: number }[] = [];
    for (const supplier of project.suppliers) {
      const catMap = categoryMatrix.get(supplier.id);
      if (!catMap) continue;
      let totalSum = 0; let totalCount = 0;
      for (const cat of CATEGORY_ORDER) {
        const cell = catMap.get(cat);
        if (cell && cell.count > 0) { totalSum += (cell.sum / cell.count) * cell.max; totalCount += cell.max; }
      }
      entries.push({ supplierId: supplier.id, avg: totalCount > 0 ? totalSum / totalCount : 0 });
    }
    entries.sort((a, b) => b.avg - a.avg);
    const rankMap = new Map<string, number>();
    let rank = 1;
    for (let i = 0; i < entries.length; i++) {
      if (i > 0 && entries[i].avg < entries[i - 1].avg) rank = i + 1;
      rankMap.set(entries[i].supplierId, rank);
    }
    return rankMap;
  }, [project, categoryMatrix]);

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

  /* ── Loading / empty ── */
  if (loading) return <TableSkeleton rows={8} cols={6} />;
  if (!project) return <div className="text-[13px] text-[oklch(0.62_0.008_264)] text-center py-20">暂无项目数据</div>;
  if (!projectId) return null;

  const { experts, suppliers } = project;

  return (
    <div className="space-y-6">
      <PageHero
        tone="purple"
        icon={<ClipboardCheck size={14} strokeWidth={1.5} />}
        title="专家评标管理端"
        description="专家组状态 · 评分概览 · 结果汇总"
        actions={<ConnectionIndicator connection={connection} lastEventAt={lastEventAt} onReconnect={reconnectNow} />}
      />

      {/* ═══ Progress dashboard ═══ */}
      {dashMetrics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard label="评分进度" value={`${dashMetrics.scorePct}%`} tone={dashMetrics.scorePct >= 80 ? 'green' : dashMetrics.scorePct >= 50 ? 'blue' : 'orange'}
            icon={<RingChart pct={dashMetrics.scorePct} size={40} stroke={4} color={
              dashMetrics.scorePct >= 80 ? '#11a874' : dashMetrics.scorePct >= 50 ? '#064ea2' : '#f5a623'
            } />}
            hint={dashMetrics.scorePct >= 80 ? '即将完成全部评分' : dashMetrics.scorePct >= 50 ? '评分进行中' : '评分刚起步'}
          />
          <MetricCard label="专家签到" value={<><span className="text-[#11a874]">{dashMetrics.signedIn}</span><span className="text-[#8a99ad]">/{dashMetrics.total}</span></>}
            tone={dashMetrics.signedIn === dashMetrics.total ? 'green' : 'blue'}
            icon={<Users size={14} />} hint="已签到 / 总计"
          />
          <MetricCard label="报告确认" value={<><span className="text-[#11a874]">{dashMetrics.reportsDone}</span><span className="text-[#8a99ad]">/{dashMetrics.total}</span></>}
            tone={dashMetrics.reportsDone === dashMetrics.total ? 'green' : dashMetrics.reportsDone > 0 ? 'blue' : 'gray'}
            icon={<FileCheck size={14} />} hint="报告已确认 / 总计"
          />
          <MetricCard label="可生成结果" value={dashMetrics.canGenerate ? '是' : '否'}
            tone={dashMetrics.canGenerate ? 'green' : 'gray'}
            icon={dashMetrics.canGenerate ? <CheckCircle size={14} /> : <Clock size={14} />}
            hint={dashMetrics.canGenerate ? '所有报告已确认' : `仍有 ${unconfirmedCount} 位未确认`}
          />
        </div>
      )}

      {/* ═══ Stage transition ═══ */}
      {project.stage === 'OPENING' && (
        <div className="rounded-2xl border border-[#bfdbfe] bg-[#eff6ff] p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Play size={16} strokeWidth={1.5} className="text-[#064ea2]" />
            <div>
              <span className="text-sm font-bold text-[#064ea2]">当前阶段：在线开标</span>
              <span className="text-xs text-[#5a6d8a] ml-2">— 所有供应商完成解密后，可启动专家评标</span>
            </div>
          </div>
          <button onClick={handleStartEvaluation} disabled={startingEvaluation}
            className="rounded-xl bg-[#064ea2] px-4 py-2 text-xs font-bold text-white hover:bg-[#054280] transition disabled:opacity-50">
            {startingEvaluation ? '启动中…' : '启动评标'}
          </button>
        </div>
      )}

      {/* ═══ Section 1: Expert status cards ═══ */}
      <SectionCard title="专家状态" className="overflow-hidden">
        {experts.length === 0 ? (
          <div className="bg-[oklch(0.96_0.02_260)] border border-[oklch(0.88_0.04_258)] p-4 flex items-center gap-2">
            <AlertTriangle size={14} strokeWidth={1.5} className="text-[oklch(0.55_0.01_264)]" />
            <span className="text-[12px] text-[oklch(0.18_0.012_265)]">暂无专家数据，请先配置评标专家。</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-4">
            {experts.map(expert => {
              const isExpanded = expandedCard === expert.id;
              const row = expertMatrix.get(expert.id);
              const supplierCount = suppliers.length;
              const scoredCount = row ? Array.from(row.values()).filter(c => c.scoredCount > 0).length : 0;
              return (
                <div key={expert.id}
                  className={`flex-1 min-w-[240px] bg-white border p-4 cursor-pointer transition-all duration-300 ${
                    expert.signedIn && expert.avoidanceConfirmed && expert.reportConfirmed
                      ? 'border-[#11a874]/30 hover:border-[#11a874]'
                      : 'border-[oklch(0.91_0.006_264)] hover:border-[oklch(0.82_0.04_258)]'
                  }`}
                  onClick={() => setExpandedCard(isExpanded ? null : expert.id)}
                >
                  {/* Name + specialty */}
                  <div className="flex items-center gap-2 mb-3">
                    <UserCircle size={14} strokeWidth={1.5} className="text-[oklch(0.42_0.14_260)] shrink-0" />
                    <span className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight truncate">
                      {expert.expertName}
                    </span>
                    {expert.major && <span className="text-[11px] text-[oklch(0.62_0.008_264)] shrink-0">{expert.major}</span>}
                    {isExpanded ? <ChevronDown size={12} className="ml-auto text-[oklch(0.55_0.01_264)]" /> : <ChevronRight size={12} className="ml-auto text-[oklch(0.55_0.01_264)]" />}
                  </div>

                  {/* Status badges */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5"
                      style={{ color: expert.signedIn ? 'oklch(0.54 0.16 158)' : 'oklch(0.62 0.008 264)', backgroundColor: expert.signedIn ? 'oklch(0.96 0.03 158)' : 'oklch(0.97 0.004 264)' }}>
                      {expert.signedIn ? <CheckCircle size={10} strokeWidth={2} /> : <Clock size={10} strokeWidth={2} />}
                      {expert.signedIn ? '已签到' : '未签到'}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5"
                      style={{ color: expert.avoidanceConfirmed ? 'oklch(0.54 0.16 158)' : 'oklch(0.64 0.16 82)', backgroundColor: expert.avoidanceConfirmed ? 'oklch(0.96 0.03 158)' : 'oklch(0.96 0.04 85)' }}>
                      <ShieldCheck size={10} strokeWidth={2} />{expert.avoidanceConfirmed ? '已回避' : '未回避'}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5"
                      style={{ color: expert.reportConfirmed ? 'oklch(0.54 0.16 158)' : 'oklch(0.55 0.01 264)', backgroundColor: expert.reportConfirmed ? 'oklch(0.96 0.03 158)' : 'oklch(0.97 0.004 264)' }}>
                      <FileCheck size={10} strokeWidth={2} />{expert.reportConfirmed ? '报告已确认' : '报告未确认'}
                    </span>
                  </div>

                  {/* Scoring workload */}
                  <div className="mb-2">
                    <div className="flex items-center justify-between text-[10px] text-[oklch(0.62_0.008_264)] mb-1">
                      <span>已评分</span>
                      <span className="font-mono">{scoredCount}/{supplierCount} 供应商</span>
                    </div>
                    <div className="h-1.5 bg-[oklch(0.94_0.004_264)]">
                      <div className="h-full bg-[oklch(0.42_0.14_260)] transition-all"
                        style={{ width: `${supplierCount > 0 ? (scoredCount / supplierCount) * 100 : 0}%` }} />
                    </div>
                  </div>

                  {/* Progress + total */}
                  <div className="flex items-center gap-2 mb-1">
                    <div className="flex-1 h-1.5 bg-[oklch(0.94_0.004_264)]">
                      <div className="h-full bg-[oklch(0.42_0.14_260)] transition-all" style={{ width: `${expert.progress}%` }} />
                    </div>
                    <span className="text-[11px] font-mono font-semibold text-[oklch(0.42_0.14_260)]">{expert.progress}%</span>
                  </div>
                  <div className="text-[12px] text-[oklch(0.55_0.01_264)]">
                    总分 <span className="font-mono font-bold text-[oklch(0.18_0.012_265)]">{Number(expert.totalScore)}</span>
                  </div>

                  {/* Expandable: per-supplier progress */}
                  {isExpanded && row && (
                    <div className="mt-3 pt-3 border-t border-[oklch(0.94_0.004_264)] space-y-1.5">
                      {suppliers.map(supplier => {
                        const cell = row.get(supplier.id);
                        const spct = cell && cell.totalCount > 0 ? Math.round((cell.scoredCount / cell.totalCount) * 100) : 0;
                        return (
                          <div key={supplier.id} className="flex items-center gap-2 text-[11px]">
                            <span className="w-20 truncate text-[oklch(0.55_0.01_264)]">{supplier.supplierName}</span>
                            <div className="flex-1 h-1 bg-[oklch(0.94_0.004_264)]">
                              <div className="h-full transition-all" style={{
                                width: `${spct}%`,
                                backgroundColor: spct >= 100 ? '#11a874' : spct > 0 ? '#064ea2' : 'oklch(0.88 0.006 264)',
                              }} />
                            </div>
                            <span className="font-mono font-bold w-10 text-right tabular-nums">{cell ? `${cell.totalScore.toFixed(0)}` : '—'}</span>
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
      </SectionCard>

      {/* ═══ Section 2: Expert×Supplier matrix ═══ */}
      {suppliers.length === 0 ? (
        <div className="bg-[oklch(0.96_0.02_260)] border border-[oklch(0.88_0.04_258)] p-4 mb-8 flex items-center gap-2">
          <AlertTriangle size={14} strokeWidth={1.5} className="text-[oklch(0.55_0.01_264)]" />
          <span className="text-[12px] text-[oklch(0.18_0.012_265)]">暂无供应商数据。</span>
        </div>
      ) : (
        <SectionCard title="评分矩阵" className="overflow-hidden p-0">
          {experts.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-[oklch(0.62_0.008_264)]">暂无专家数据</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="workbench-table">
                <thead>
                  <tr className="text-[oklch(0.55_0.01_264)]">
                    <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider whitespace-nowrap">专家</th>
                    {suppliers.map(s => {
                      const scores = experts.map(e => {
                        const cell = expertMatrix.get(e.id)?.get(s.id);
                        return cell && cell.maxScore > 0 ? (cell.totalScore / cell.maxScore) * 100 : null;
                      }).filter(Boolean) as number[];
                      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
                      return (
                        <th key={s.id} className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider whitespace-nowrap">
                          <div className="text-[oklch(0.18_0.012_265)]">{s.supplierName}</div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-normal text-[oklch(0.62_0.008_264)]">{DECRYPT_LABEL[s.decryptStatus] || s.decryptStatus}</span>
                            {scores.length > 1 && <DistributionChart scores={scores} avg={avg} />}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {experts.map(expert => {
                    const isExpanded = expandedExpert === expert.id;
                    const row = expertMatrix.get(expert.id);
                    const hasAnyScore = Array.from(row?.values() ?? []).some(c => c.scoredCount > 0);
                    return (
                      <tr key={expert.id}>
                        <td className="px-5 py-3">
                          <button onClick={() => setExpandedExpert(isExpanded ? null : expert.id)} disabled={!hasAnyScore}
                            className={`flex items-center gap-1.5 text-left ${hasAnyScore ? 'cursor-pointer hover:text-[oklch(0.42_0.14_260)]' : 'cursor-default'} transition-colors`}>
                            {hasAnyScore && (isExpanded ? <ChevronDown size={12} strokeWidth={1.5} className="text-[oklch(0.55_0.01_264)] shrink-0" /> : <ChevronRight size={12} strokeWidth={1.5} className="text-[oklch(0.55_0.01_264)] shrink-0" />)}
                            <span className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight">{expert.expertName}</span>
                          </button>
                        </td>
                        {suppliers.map(s => {
                          const cell = row?.get(s.id);
                          const avg = supplierAverages.get(s.id) ?? 0;
                          const cellPct = cell && cell.maxScore > 0 ? (cell.totalScore / cell.maxScore) * 100 : null;
                          const isAnomaly = cellPct !== null && avg > 0 && Math.abs(cellPct - avg) > anomalyThreshold;
                          if (!cell || cell.scoredCount === 0) {
                            return <td key={s.id} className="px-5 py-3 text-[12px] text-[oklch(0.62_0.008_264)]">—</td>;
                          }
                          return (
                            <td key={s.id} className="px-5 py-3 relative">
                              <div className={`inline-flex items-center gap-1 cursor-default rounded-md px-2 py-1 transition-all ${
                                isAnomaly ? 'border border-[#f5a623] bg-[#fef6e8]' : ''
                              }`}
                                onMouseEnter={() => setTooltip({ cell, expertName: expert.expertName, supplierName: s.supplierName })}
                                onMouseLeave={() => setTooltip(null)}
                              >
                                <span className="font-mono text-[oklch(0.18_0.012_265)]">
                                  <span className="font-bold">{cell.totalScore.toFixed(1)}</span>
                                  <span className="text-[oklch(0.62_0.008_264)]">/{cell.maxScore}</span>
                                </span>
                                <span className="text-[11px] text-[oklch(0.62_0.008_264)]">({cell.scoredCount})</span>
                                {isAnomaly && <AlertTriangle size={10} className="text-[#f5a623]" />}
                              </div>
                              {tooltip && tooltip.expertName === expert.expertName && tooltip.supplierName === s.supplierName && (
                                <CellTooltip cell={cell} expertName={expert.expertName} supplierName={s.supplierName}
                                  onClose={() => setTooltip(null)} />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {/* Expanded detail panel */}
              {expandedExpert && (() => {
                const expert = experts.find(e => e.id === expandedExpert);
                if (!expert) return null;
                const row = expertMatrix.get(expandedExpert);
                if (!row) return null;
                return (
                  <div className="border-t border-[oklch(0.91_0.006_264)]">
                    <div className="p-5 bg-[oklch(0.98_0.005_264)]">
                      <div className="text-[12px] font-semibold text-[oklch(0.42_0.14_260)] mb-3 tracking-tight">
                        {expert.expertName} 详细评分
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        {suppliers.map(supplier => {
                          const cell = row.get(supplier.id);
                          if (!cell || cell.scoredCount === 0) return null;
                          return (
                            <div key={supplier.id} className="bg-white border border-[oklch(0.91_0.006_264)] p-4">
                              <div className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] mb-2 tracking-tight">{supplier.supplierName}</div>
                              {cell.items.map(item => (
                                <div key={item.name} className="flex justify-between items-center text-[12px] py-1.5 border-b border-[oklch(0.94_0.004_264)] last:border-0">
                                  <span className="text-[oklch(0.55_0.01_264)]">{item.name}</span>
                                  <span className="font-mono">
                                    <span className="font-bold text-[oklch(0.18_0.012_265)]">{item.score}</span>
                                    <span className="text-[oklch(0.62_0.008_264)]">/{item.maxScore}</span>
                                    {item.reason && <span className="text-[oklch(0.55_0.01_264)] ml-1.5 text-[11px]">({item.reason})</span>}
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
              })()}
            </div>
          )}
        </SectionCard>
      )}

      {/* ═══ Section 3: Supplier score summary ═══ */}
      {suppliers.length > 0 && (
        <SectionCard title="供应商评分汇总" description="按评审类别汇总平均分，作为排名依据。悬停分类得分查看专家明细。" className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="workbench-table">
              <thead>
                <tr className="text-[oklch(0.55_0.01_264)]">
                  <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider whitespace-nowrap">排名</th>
                  <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider whitespace-nowrap">投标单位</th>
                  {CATEGORY_ORDER.map(cat => (
                    <th key={cat} className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider whitespace-nowrap">{CATEGORY_LABEL[cat] || cat}</th>
                  ))}
                  <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider whitespace-nowrap">总分(平均)</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map(supplier => {
                  const catMap = categoryMatrix.get(supplier.id);
                  const rank = supplierRanks.get(supplier.id);
                  let overallSum = 0; let overallMax = 0;
                  if (catMap) {
                    for (const cat of CATEGORY_ORDER) {
                      const cell = catMap.get(cat);
                      if (cell && cell.count > 0) { overallSum += (cell.sum / cell.count) * cell.max; overallMax += cell.max; }
                    }
                  }
                  const overallAvg = overallMax > 0 ? ((overallSum / overallMax) * 100).toFixed(1) : null;
                  return (
                    <tr key={supplier.id} className="transition-colors">
                      <td className="px-5 py-3">
                        {rank != null ? (
                          <span className="font-mono font-bold text-[oklch(0.18_0.012_265)] transition-all duration-300">#{rank}</span>
                        ) : <span className="text-[12px] text-[oklch(0.62_0.008_264)]">—</span>}
                      </td>
                      <td className="px-5 py-3 font-semibold text-[oklch(0.18_0.012_265)] whitespace-nowrap">{supplier.supplierName}</td>
                      {CATEGORY_ORDER.map(cat => {
                        const cell = catMap?.get(cat);
                        const hasData = cell && cell.count > 0;
                        const avg = hasData ? ((cell!.sum / cell!.count / cell!.max) * 100).toFixed(1) : null;
                        // Get per-expert scores for this category
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
                              <span className="relative group inline-flex items-center gap-1.5 cursor-default">
                                <span className="w-0.5 h-3 shrink-0" style={{ backgroundColor: CATEGORY_COLOR[cat] }} />
                                <span className="font-mono font-bold text-[oklch(0.18_0.012_265)]">{avg}</span>
                                {expertScores.length > 0 && (
                                  <div className="absolute left-0 bottom-full mb-1 w-48 rounded-xl border border-[#dce6f3] bg-white p-3 shadow-[0_12px_40px_rgba(15,47,87,0.12)] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition duration-150 z-50">
                                    <div className="text-[11px] font-semibold text-[#5a6d8a] mb-1.5">专家明细</div>
                                    {expertScores.map(es => (
                                      <div key={es.name} className="flex items-center justify-between text-[11px] py-0.5">
                                        <span className="text-[oklch(0.55_0.01_264)]">{es.name}</span>
                                        <span className="font-mono font-bold text-[oklch(0.18_0.012_265)]">{es.score.toFixed(1)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </span>
                            ) : <span className="text-[12px] text-[oklch(0.62_0.008_264)]">—</span>}
                          </td>
                        );
                      })}
                      <td className="px-5 py-3">
                        {overallAvg != null ? (
                          <span className="font-mono font-bold text-[oklch(0.42_0.14_260)]">{overallAvg}</span>
                        ) : <span className="text-[12px] text-[oklch(0.62_0.008_264)]">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ═══ Section 4: Results generation ═══ */}
      <div className="bg-white border border-[oklch(0.91_0.006_264)]">
        <div className="px-5 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight">
                评标结果汇总
              </h2>
              <p className="text-[11px] text-[oklch(0.62_0.008_264)] mt-1">
                需所有专家确认评审报告后方可生成；按平均分排名，第一名推荐为中标候选人。
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Pulsing dot reminder */}
              {!allReportsConfirmed && experts.length > 0 && (
                <span className="relative inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#92400e] group cursor-default" title={unconfirmedNames.join('、')}>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#e74c3c] opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#e74c3c]" />
                  </span>
                  {unconfirmedCount} 位未确认
                  <span className="absolute top-full mt-1 right-0 w-48 rounded-xl border border-[#dce6f3] bg-white p-2.5 text-[11px] text-[#5a6d8a] shadow-[0_8px_30px_rgba(15,47,87,0.1)] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition z-50 text-left font-normal">
                    {unconfirmedNames.map((n, i) => <div key={n} className="py-0.5">{i + 1}. {n}</div>)}
                  </span>
                </span>
              )}
              <button onClick={() => { setWizardStep(0); setShowWizard(true); }}
                disabled={generating || !allReportsConfirmed || project.stage !== 'EVALUATING'}
                className="px-4 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors disabled:opacity-50 rounded-xl">
                {generating ? '生成中…' : '生成评标结果'}
              </button>
            </div>
          </div>
          {!allReportsConfirmed && experts.length > 0 && (
            <div className="mt-3 bg-[oklch(0.96_0.04_85)] border border-[oklch(0.88_0.06_82)] p-3 flex items-center gap-2 rounded-xl">
              <AlertTriangle size={14} strokeWidth={1.5} className="text-[oklch(0.64_0.16_82)] shrink-0" />
              <span className="text-[12px] text-[oklch(0.18_0.012_265)]">
                仍有 {unconfirmedCount} 位专家未确认评审报告（{unconfirmedNames.join('、')}），需全部确认后方可生成评标结果。
              </span>
            </div>
          )}
        </div>
        <table className="workbench-table">
          <thead>
            <tr className="text-[oklch(0.55_0.01_264)]">
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">排名</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">投标单位</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">总分</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">平均分</th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">推荐</th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-12 text-center text-[13px] text-[oklch(0.62_0.008_264)]">暂未生成评标结果</td></tr>
            ) : (
              results.map((r, idx) => (
                <tr key={r.id} className={revealResults ? 'animate-[count-up_400ms_ease-out]' : ''}
                  style={revealResults ? { animationDelay: `${idx * 120}ms`, animationFillMode: 'backwards' } : undefined}>
                  <td className="px-5 py-3 font-mono font-bold text-[oklch(0.18_0.012_265)]">{r.rank}</td>
                  <td className="px-5 py-3 font-medium text-[oklch(0.18_0.012_265)]">{r.supplierName}</td>
                  <td className="px-5 py-3 font-mono text-[oklch(0.18_0.012_265)]">{r.totalScore}</td>
                  <td className="px-5 py-3 font-mono font-bold text-[oklch(0.42_0.14_260)]">{r.averageScore}</td>
                  <td className="px-5 py-3">
                    {r.recommended ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 tracking-wide rounded-full text-[#11a874] border border-[#11a874]/40 bg-gradient-to-r from-[#f0fdf4] to-[#ecfdf5] animate-[glow-pulse_2s_ease-in-out_infinite]">
                        <Trophy size={11} /> 第一中标候选人
                      </span>
                    ) : <span className="text-[11px] text-[oklch(0.62_0.008_264)]">—</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ═══ 3-step confirmation wizard modal ═══ */}
      {showWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowWizard(false)} />
          <div className="relative glass-card glass-card-deeper glass-card-purple rounded-2xl p-6 w-full max-w-lg mx-4 shadow-[0_24px_80px_rgba(15,47,87,0.18)]">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-black text-[#18243a]">生成评标结果</h3>
              <button onClick={() => setShowWizard(false)} className="text-[#8a99ad] hover:text-[#18243a]"><X size={16} /></button>
            </div>

            {/* Step indicators */}
            <div className="flex items-center gap-2 mb-6">
              {['专家确认检查', '异常评分审阅', '确认生成'].map((label, i) => (
                <div key={label} className="flex items-center gap-2">
                  <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold transition-all ${
                    wizardStep === i ? 'bg-[#064ea2] text-white' : wizardStep > i ? 'bg-[#f0fdf4] text-[#11a874]' : 'bg-[#f1f5f9] text-[#8a99ad]'
                  }`}>
                    {wizardStep > i ? <CheckCircle size={11} /> : <span className="w-4 h-4 flex items-center justify-center text-[10px]">{i + 1}</span>}
                    {label}
                  </div>
                  {i < 2 && <span className="w-3 h-px bg-[#dce6f3]" />}
                </div>
              ))}
            </div>

            {/* Step content */}
            {wizardStep === 0 && (
              <div className="space-y-2 mb-6">
                <p className="text-xs text-[#5a6d8a] mb-3">以下专家需确认评审报告：</p>
                {experts.map(e => (
                  <div key={e.id} className="flex items-center justify-between py-2 px-3 rounded-lg border border-[#edf2f7]">
                    <span className="text-sm font-semibold text-[#18243a]">{e.expertName}</span>
                    <span className={`text-[11px] font-semibold ${e.reportConfirmed ? 'text-[#11a874]' : 'text-[#e74c3c]'}`}>
                      {e.reportConfirmed ? <><CheckCircle size={11} className="inline mr-1" />已确认</> : <><AlertTriangle size={11} className="inline mr-1" />未确认</>}
                    </span>
                  </div>
                ))}
                {allReportsConfirmed && <p className="text-xs text-[#11a874] font-semibold mt-2">✓ 所有专家已确认，可以继续</p>}
              </div>
            )}

            {wizardStep === 1 && (
              <div className="space-y-2 mb-6 max-h-[300px] overflow-y-auto">
                <p className="text-xs text-[#5a6d8a] mb-3">检测到以下评分可能与平均分偏差较大（≥{anomalyThreshold}%），请确认是否继续：</p>
                {suppliers.flatMap(supplier =>
                  experts.map(expert => {
                    const cell = expertMatrix.get(expert.id)?.get(supplier.id);
                    const avg = supplierAverages.get(supplier.id) ?? 0;
                    const cellPct = cell && cell.maxScore > 0 ? (cell.totalScore / cell.maxScore) * 100 : null;
                    if (!cellPct || Math.abs(cellPct - avg) <= anomalyThreshold) return null;
                    return (
                      <div key={`${expert.id}-${supplier.id}`} className="flex items-center justify-between py-2 px-3 rounded-lg border border-[#fcd34d] bg-[#fffbeb]">
                        <span className="text-xs text-[#18243a]">
                          {expert.expertName} → {supplier.supplierName}
                        </span>
                        <span className="text-[11px] font-mono font-bold">
                          <span className={cellPct > avg ? 'text-[#e74c3c]' : 'text-[#f5a623]'}>{cellPct.toFixed(1)}</span>
                          <span className="text-[#8a99ad]"> vs 平均 {avg.toFixed(1)}</span>
                        </span>
                      </div>
                    );
                  })
                ).filter(Boolean)}
                {!suppliers.some(supplier =>
                  experts.some(expert => {
                    const cell = expertMatrix.get(expert.id)?.get(supplier.id);
                    const avg = supplierAverages.get(supplier.id) ?? 0;
                    const cellPct = cell && cell.maxScore > 0 ? (cell.totalScore / cell.maxScore) * 100 : null;
                    return cellPct && Math.abs(cellPct - avg) > anomalyThreshold;
                  })
                ) && (
                  <p className="text-xs text-[#11a874] font-semibold">✓ 未检测到异常评分</p>
                )}
              </div>
            )}

            {wizardStep === 2 && (
              <div className="space-y-3 mb-6">
                <p className="text-xs text-[#5a6d8a]">
                  即将基于当前所有评分数据生成评标结果。系统将按平均分排名，第一名自动推荐为中标候选人。
                </p>
                <div className="rounded-xl border border-[#bfdbfe] bg-[#eff6ff] p-3 text-xs text-[#064ea2] font-semibold">
                  📋 共 {experts.length} 位专家，{suppliers.length} 家供应商参与评标
                </div>
                <p className="text-xs text-[#8a99ad]">生成后可在下方结果表格中查看排名与推荐情况。</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between">
              <button onClick={() => setShowWizard(false)} className="rounded-xl border border-[#dce6f3] px-4 py-2 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition">取消</button>
              <div className="flex items-center gap-2">
                {wizardStep > 0 && (
                  <button onClick={() => setWizardStep(prev => (prev - 1) as 0 | 1 | 2)}
                    className="rounded-xl border border-[#dce6f3] px-4 py-2 text-xs font-bold text-[#5a6d8a] hover:bg-[#f8fafc] transition">上一步</button>
                )}
                {wizardStep < 2 ? (
                  <button onClick={() => setWizardStep(prev => (prev + 1) as 0 | 1 | 2)}
                    disabled={wizardStep === 0 && !allReportsConfirmed}
                    className="rounded-xl bg-[#064ea2] px-4 py-2 text-xs font-bold text-white hover:bg-[#054280] transition disabled:opacity-50">下一步</button>
                ) : (
                  <button onClick={handleGenerate} disabled={generating}
                    className="rounded-xl bg-[#11a874] px-4 py-2 text-xs font-bold text-white hover:bg-[#0e8c5f] transition disabled:opacity-50">
                    {generating ? '生成中...' : '确认生成'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
