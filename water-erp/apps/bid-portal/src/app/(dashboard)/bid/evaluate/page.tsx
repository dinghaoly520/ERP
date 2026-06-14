'use client';

import { useEffect, useState, useMemo } from 'react';
import { api } from '@/lib/api';
import type { BidProjectDetail, BidExpert, BidSupplier, BidScoreItem } from '@/lib/types';
import { CATEGORY_LABEL, CATEGORY_COLOR, DECRYPT_LABEL } from '@water-erp/shared';
import ProjectSelector from '@/components/project-selector';
import { TableSkeleton } from '@/components/skeleton';
import { toast } from 'sonner';
import {
  UserCircle, CheckCircle, Clock, ShieldCheck, FileCheck,
  ChevronDown, ChevronRight, AlertTriangle,
} from 'lucide-react';

/* ── 局部类型（共享包 BidExpert 不含 scoreRecords，但 API 通过 Prisma include 返回）── */

interface ExpertScoreRecord {
  id: string;
  expertId: string;
  scoreItemId: string;
  supplierId: string;
  score: string;       // Prisma Decimal → JSON string
  reason?: string | null;
}

interface BidExpertWithScores extends BidExpert {
  scoreRecords: ExpertScoreRecord[];
}

interface BidProjectEvalDetail extends Omit<BidProjectDetail, 'experts'> {
  experts: BidExpertWithScores[];
}

/* ── 评标结果类型（与 Prisma BidEvaluationResult 对齐）── */

interface EvalResult {
  id: string;
  supplierId: string;
  supplierName: string;
  totalScore: string;    // Decimal → string
  averageScore: string;  // Decimal → string
  rank: number;
  recommended: boolean;
  generatedAt: string;
}

/* ── 聚合结果类型 ── */

interface ExpertSupplierCell {
  totalScore: number;
  maxScore: number;
  scoredCount: number;
  totalCount: number;
  items: { name: string; score: number; maxScore: number; reason?: string | null }[];
}

type ExpertSupplierMatrix = Map<string, Map<string, ExpertSupplierCell>>;

interface SupplierCategoryCell {
  sum: number;
  max: number;
  count: number;
}

type SupplierCategoryMatrix = Map<string, Map<string, SupplierCategoryCell>>;

/* ── 数据聚合函数 ── */

const CATEGORY_ORDER = ['QUALIFICATION', 'RESPONSIVE', 'BUSINESS', 'TECHNICAL', 'PRICE'];

function buildExpertSupplierMatrix(
  experts: BidExpertWithScores[],
  scoreItemMap: Map<string, BidScoreItem>,
  suppliers: BidSupplier[],
): ExpertSupplierMatrix {
  const matrix: ExpertSupplierMatrix = new Map();

  for (const expert of experts) {
    const expertRow: Map<string, ExpertSupplierCell> = new Map();

    // 初始化所有供应商的空单元格
    for (const supplier of suppliers) {
      expertRow.set(supplier.id, {
        totalScore: 0,
        maxScore: 0,
        scoredCount: 0,
        totalCount: scoreItemMap.size,
        items: [],
      });
    }

    for (const record of expert.scoreRecords) {
      const item = scoreItemMap.get(record.scoreItemId);
      if (!item) continue;

      const cell = expertRow.get(record.supplierId);
      if (!cell) continue;

      const score = Number(record.score);
      cell.totalScore += score;
      cell.maxScore += Number(item.maxScore);
      cell.scoredCount += 1;
      cell.items.push({
        name: item.name,
        score,
        maxScore: Number(item.maxScore),
        reason: record.reason,
      });
    }

    matrix.set(expert.id, expertRow);
  }

  return matrix;
}

function buildSupplierCategoryMatrix(
  experts: BidExpertWithScores[],
  scoreItemMap: Map<string, BidScoreItem>,
  suppliers: BidSupplier[],
): SupplierCategoryMatrix {
  const matrix: SupplierCategoryMatrix = new Map();

  for (const supplier of suppliers) {
    const catMap: Map<string, SupplierCategoryCell> = new Map();
    for (const cat of CATEGORY_ORDER) {
      catMap.set(cat, { sum: 0, max: 0, count: 0 });
    }
    matrix.set(supplier.id, catMap);
  }

  for (const expert of experts) {
    for (const record of expert.scoreRecords) {
      const item = scoreItemMap.get(record.scoreItemId);
      if (!item) continue;

      const catCell = matrix.get(record.supplierId)?.get(item.category);
      if (!catCell) continue;

      catCell.sum += Number(record.score);
      catCell.max += Number(item.maxScore);
      catCell.count += 1;
    }
  }

  return matrix;
}

/* ── 页面组件 ── */

export default function BidEvaluatePage() {
  const [projectId, setProjectId] = useState('');
  const [project, setProject] = useState<BidProjectEvalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<EvalResult[]>([]);
  const [generating, setGenerating] = useState(false);
  const [expandedExpert, setExpandedExpert] = useState<string | null>(null);

  /* ── 数据加载 ── */

  useEffect(() => {
    api.get<{ id: string }[]>('/bid/projects').then(ps => {
      if (ps.length) setProjectId(ps[0].id);
    });
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.get<BidProjectEvalDetail>(`/bid/projects/${projectId}`).then(p => {
      setProject(p);
      setLoading(false);
    });
    api.get<EvalResult[]>(`/bid/projects/${projectId}/evaluation-results`)
      .then(setResults)
      .catch(() => setResults([]));
  }, [projectId]);

  /* ── 操作 ── */

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const r = await api.post<EvalResult[]>(
        `/bid/projects/${projectId}/evaluation-results/generate`,
        {},
      );
      setResults(r);
      toast.success('评标结果已生成');
    } catch (e: any) {
      toast.error(e.message || '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  /* ── 派生数据（useMemo）── */

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

  /* ── 供应商排名（按总分平均降序）── */

  const supplierRanks = useMemo(() => {
    if (!project) return new Map<string, number>();
    const entries: { supplierId: string; avg: number }[] = [];
    for (const supplier of project.suppliers) {
      const catMap = categoryMatrix.get(supplier.id);
      if (!catMap) continue;
      let totalSum = 0;
      let totalCount = 0;
      for (const cat of CATEGORY_ORDER) {
        const cell = catMap.get(cat);
        if (cell && cell.count > 0) {
          totalSum += (cell.sum / cell.count) * cell.max;
          totalCount += cell.max;
        }
      }
      const overallAvg = totalCount > 0 ? totalSum / totalCount : 0;
      entries.push({ supplierId: supplier.id, avg: overallAvg });
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

  /* ── 加载/空状态 ── */

  if (loading) return <TableSkeleton rows={8} cols={6} />;
  if (!project) return (
    <div className="text-[13px] text-[oklch(0.62_0.008_264)] text-center py-20">
      暂无项目数据
    </div>
  );

  const { experts, suppliers } = project;

  return (
    <div>
      {/* ═══ 页面头部 ═══ */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1
            className="text-[28px] font-bold tracking-tight text-[oklch(0.18_0.012_265)]"
            style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}
          >
            评标管理端
          </h1>
          <p className="text-[14px] text-[oklch(0.55_0.01_264)] mt-1">
            专家组状态 · 评分概览 · 结果汇总
          </p>
        </div>
        <ProjectSelector value={projectId} onChange={setProjectId} />
      </div>

      {/* ═══ Section 1: 专家组状态卡片 ═══ */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2
            className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
            style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}
          >
            专家组状态
          </h2>
          <span className="text-[11px] text-[oklch(0.62_0.008_264)]">
            {experts.length} 位专家
          </span>
        </div>

        {experts.length === 0 ? (
          <div className="bg-[oklch(0.96_0.02_260)] border border-[oklch(0.88_0.04_258)] p-4 flex items-center gap-2">
            <AlertTriangle size={14} strokeWidth={1.5} className="text-[oklch(0.55_0.01_264)]" />
            <span className="text-[12px] text-[oklch(0.18_0.012_265)]">
              暂无专家数据，请先配置评标专家。
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-4">
            {experts.map(expert => (
              <div
                key={expert.id}
                className="flex-1 min-w-[240px] bg-white border border-[oklch(0.91_0.006_264)] p-4"
              >
                {/* 姓名 + 专业 */}
                <div className="flex items-center gap-2 mb-3">
                  <UserCircle size={14} strokeWidth={1.5} className="text-[oklch(0.42_0.14_260)] shrink-0" />
                  <span
                    className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight truncate"
                    style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}
                  >
                    {expert.expertName}
                  </span>
                  {expert.major && (
                    <span className="text-[11px] text-[oklch(0.62_0.008_264)] shrink-0">
                      {expert.major}
                    </span>
                  )}
                </div>

                {/* 状态徽章 */}
                <div className="flex flex-wrap gap-1.5 mb-3">
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5"
                    style={{
                      color: expert.signedIn
                        ? 'oklch(0.54 0.16 158)'
                        : 'oklch(0.62 0.008 264)',
                      backgroundColor: expert.signedIn
                        ? 'oklch(0.96 0.03 158)'
                        : 'oklch(0.97 0.004 264)',
                    }}
                  >
                    {expert.signedIn ? (
                      <CheckCircle size={10} strokeWidth={2} />
                    ) : (
                      <Clock size={10} strokeWidth={2} />
                    )}
                    {expert.signedIn ? '已签到' : '未签到'}
                  </span>
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5"
                    style={{
                      color: expert.avoidanceConfirmed
                        ? 'oklch(0.54 0.16 158)'
                        : 'oklch(0.64 0.16 82)',
                      backgroundColor: expert.avoidanceConfirmed
                        ? 'oklch(0.96 0.03 158)'
                        : 'oklch(0.96 0.04 85)',
                    }}
                  >
                    <ShieldCheck size={10} strokeWidth={2} />
                    {expert.avoidanceConfirmed ? '已回避' : '未回避'}
                  </span>
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5"
                    style={{
                      color: expert.reportConfirmed
                        ? 'oklch(0.54 0.16 158)'
                        : 'oklch(0.55 0.01 264)',
                      backgroundColor: expert.reportConfirmed
                        ? 'oklch(0.96 0.03 158)'
                        : 'oklch(0.97 0.004 264)',
                    }}
                  >
                    <FileCheck size={10} strokeWidth={2} />
                    {expert.reportConfirmed ? '报告已确认' : '报告未确认'}
                  </span>
                </div>

                {/* 进度条 */}
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex-1 h-1.5 bg-[oklch(0.94_0.004_264)]">
                    <div
                      className="h-full bg-[oklch(0.42_0.14_260)] transition-all"
                      style={{ width: `${expert.progress}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-mono font-semibold text-[oklch(0.42_0.14_260)]">
                    {expert.progress}%
                  </span>
                </div>

                {/* 总分 */}
                <div className="text-[12px] text-[oklch(0.55_0.01_264)]">
                  总分{' '}
                  <span className="font-mono font-bold text-[oklch(0.18_0.012_265)]">
                    {Number(expert.totalScore)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ═══ Section 2: 专家评分概览（只读，可展开）═══ */}
      {suppliers.length === 0 ? (
        <div className="bg-[oklch(0.96_0.02_260)] border border-[oklch(0.88_0.04_258)] p-4 mb-8 flex items-center gap-2">
          <AlertTriangle size={14} strokeWidth={1.5} className="text-[oklch(0.55_0.01_264)]" />
          <span className="text-[12px] text-[oklch(0.18_0.012_265)]">
            暂无供应商数据。
          </span>
        </div>
      ) : (
        <div className="bg-white border border-[oklch(0.91_0.006_264)] mb-8">
          <div className="px-5 py-4 border-b border-[oklch(0.91_0.006_264)]">
            <h2
              className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
              style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}
            >
              专家评分概览
            </h2>
          </div>
          {experts.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-[oklch(0.62_0.008_264)]">
              暂无专家数据
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
                    <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider whitespace-nowrap">
                      专家
                    </th>
                    {suppliers.map(s => (
                      <th
                        key={s.id}
                        className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider whitespace-nowrap"
                      >
                        <div className="text-[oklch(0.18_0.012_265)]">{s.supplierName}</div>
                        <div className="text-[10px] font-normal mt-0.5 text-[oklch(0.62_0.008_264)]">
                          {DECRYPT_LABEL[s.decryptStatus] || s.decryptStatus}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {experts.map(expert => {
                    const isExpanded = expandedExpert === expert.id;
                    const row = expertMatrix.get(expert.id);
                    const hasAnyScore = Array.from(row?.values() ?? []).some(
                      c => c.scoredCount > 0,
                    );

                    return (
                      <tr key={expert.id} className="border-b border-[oklch(0.94_0.004_264)]">
                        <td className="px-5 py-3">
                          <button
                            onClick={() =>
                              setExpandedExpert(isExpanded ? null : expert.id)
                            }
                            disabled={!hasAnyScore}
                            className={`flex items-center gap-1.5 text-left ${
                              hasAnyScore
                                ? 'cursor-pointer hover:text-[oklch(0.42_0.14_260)]'
                                : 'cursor-default'
                            } transition-colors`}
                          >
                            {hasAnyScore &&
                              (isExpanded ? (
                                <ChevronDown size={12} strokeWidth={1.5} className="text-[oklch(0.55_0.01_264)] shrink-0" />
                              ) : (
                                <ChevronRight size={12} strokeWidth={1.5} className="text-[oklch(0.55_0.01_264)] shrink-0" />
                              ))}
                            <span
                              className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
                              style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}
                            >
                              {expert.expertName}
                            </span>
                          </button>
                        </td>
                        {suppliers.map(s => {
                          const cell = row?.get(s.id);
                          if (!cell || cell.scoredCount === 0) {
                            return (
                              <td
                                key={s.id}
                                className="px-5 py-3 text-[12px] text-[oklch(0.62_0.008_264)]"
                              >
                                —
                              </td>
                            );
                          }
                          return (
                            <td key={s.id} className="px-5 py-3">
                              <span className="font-mono text-[oklch(0.18_0.012_265)]">
                                <span className="font-bold">
                                  {cell.totalScore.toFixed(1)}
                                </span>
                                <span className="text-[oklch(0.62_0.008_264)]">
                                  /{cell.maxScore}
                                </span>
                              </span>
                              <span className="text-[11px] text-[oklch(0.62_0.008_264)] ml-1">
                                ({cell.scoredCount})
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* 展开详情区 */}
              {expandedExpert && (
                <div className="border-t border-[oklch(0.91_0.006_264)]">
                  {(() => {
                    const expert = experts.find(e => e.id === expandedExpert);
                    if (!expert) return null;
                    const row = expertMatrix.get(expandedExpert);
                    if (!row) return null;

                    return (
                      <div className="p-5 bg-[oklch(0.98_0.005_264)]">
                        <div
                          className="text-[12px] font-semibold text-[oklch(0.42_0.14_260)] mb-3 tracking-tight"
                          style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}
                        >
                          {expert.expertName} 详细评分
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          {suppliers.map(supplier => {
                            const cell = row.get(supplier.id);
                            if (!cell || cell.scoredCount === 0) return null;
                            return (
                              <div
                                key={supplier.id}
                                className="bg-white border border-[oklch(0.91_0.006_264)] p-4"
                              >
                                <div className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] mb-2 tracking-tight">
                                  {supplier.supplierName}
                                </div>
                                {cell.items.map(item => (
                                  <div
                                    key={item.name}
                                    className="flex justify-between items-center text-[12px] py-1.5 border-b border-[oklch(0.94_0.004_264)] last:border-0"
                                  >
                                    <span className="text-[oklch(0.55_0.01_264)]">
                                      {item.name}
                                    </span>
                                    <span className="font-mono">
                                      <span className="font-bold text-[oklch(0.18_0.012_265)]">
                                        {item.score}
                                      </span>
                                      <span className="text-[oklch(0.62_0.008_264)]">
                                        /{item.maxScore}
                                      </span>
                                      {item.reason && (
                                        <span className="text-[oklch(0.55_0.01_264)] ml-1.5 text-[11px]">
                                          ({item.reason})
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══ Section 3: 供应商评分汇总（只读）═══ */}
      {suppliers.length === 0 ? null : (
        <div className="bg-white border border-[oklch(0.91_0.006_264)] mb-8">
          <div className="px-5 py-4 border-b border-[oklch(0.91_0.006_264)]">
            <h2
              className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
              style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}
            >
              供应商评分汇总
            </h2>
            <p className="text-[11px] text-[oklch(0.62_0.008_264)] mt-1">
              按评审类别汇总平均分，作为排名依据。
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
                  <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider whitespace-nowrap">
                    排名趋势
                  </th>
                  <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider whitespace-nowrap">
                    投标单位
                  </th>
                  {CATEGORY_ORDER.map(cat => (
                    <th
                      key={cat}
                      className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider whitespace-nowrap"
                    >
                      {CATEGORY_LABEL[cat] || cat}
                    </th>
                  ))}
                  <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider whitespace-nowrap">
                    总分(平均)
                  </th>
                </tr>
              </thead>
              <tbody>
                {suppliers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={2 + CATEGORY_ORDER.length + 1}
                      className="px-5 py-12 text-center text-[13px] text-[oklch(0.62_0.008_264)]"
                    >
                      暂无供应商数据
                    </td>
                  </tr>
                ) : (
                  suppliers.map(supplier => {
                    const catMap = categoryMatrix.get(supplier.id);
                    const rank = supplierRanks.get(supplier.id);

                    // 计算总分平均
                    let overallSum = 0;
                    let overallMax = 0;
                    if (catMap) {
                      for (const cat of CATEGORY_ORDER) {
                        const cell = catMap.get(cat);
                        if (cell && cell.count > 0) {
                          overallSum += (cell.sum / cell.count) * cell.max;
                          overallMax += cell.max;
                        }
                      }
                    }
                    const overallAvg =
                      overallMax > 0
                        ? ((overallSum / overallMax) * 100).toFixed(1)
                        : null;

                    return (
                      <tr
                        key={supplier.id}
                        className="border-b border-[oklch(0.94_0.004_264)] hover:bg-[oklch(0.992_0.003_264)] transition-colors"
                      >
                        <td className="px-5 py-3">
                          {rank != null ? (
                            <span className="font-mono font-bold text-[oklch(0.18_0.012_265)]">
                              #{rank}
                            </span>
                          ) : (
                            <span className="text-[12px] text-[oklch(0.62_0.008_264)]">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 font-semibold text-[oklch(0.18_0.012_265)] whitespace-nowrap">
                          {supplier.supplierName}
                        </td>
                        {CATEGORY_ORDER.map(cat => {
                          const cell = catMap?.get(cat);
                          const hasData = cell && cell.count > 0;
                          const avg = hasData
                            ? ((cell!.sum / cell!.count / cell!.max) * 100).toFixed(
                                1,
                              )
                            : null;
                          return (
                            <td key={cat} className="px-5 py-3">
                              {avg != null ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <span
                                    className="w-0.5 h-3 shrink-0"
                                    style={{
                                      backgroundColor: CATEGORY_COLOR[cat],
                                    }}
                                  />
                                  <span className="font-mono font-bold text-[oklch(0.18_0.012_265)]">
                                    {avg}
                                  </span>
                                </span>
                              ) : (
                                <span className="text-[12px] text-[oklch(0.62_0.008_264)]">
                                  —
                                </span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-5 py-3">
                          {overallAvg != null ? (
                            <span className="font-mono font-bold text-[oklch(0.42_0.14_260)]">
                              {overallAvg}
                            </span>
                          ) : (
                            <span className="text-[12px] text-[oklch(0.62_0.008_264)]">
                              —
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ Section 4: 评标结果生成 + 结果表格 ═══ */}
      <div className="bg-white border border-[oklch(0.91_0.006_264)]">
        <div className="px-5 py-4 border-b border-[oklch(0.91_0.006_264)]">
          <div className="flex items-center justify-between">
            <div>
              <h2
                className="text-[13px] font-semibold text-[oklch(0.18_0.012_265)] tracking-tight"
                style={{ fontFamily: "'Manrope', system-ui, sans-serif" }}
              >
                评标结果汇总
              </h2>
              <p className="text-[11px] text-[oklch(0.62_0.008_264)] mt-1">
                需所有专家确认评审报告后方可生成；按平均分排名，第一名推荐为中标候选人。
              </p>
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating || !allReportsConfirmed}
              className="px-4 py-2 bg-[oklch(0.42_0.14_260)] text-white text-[12px] font-semibold tracking-tight hover:bg-[oklch(0.50_0.16_258)] transition-colors disabled:opacity-50"
            >
              {generating ? '生成中…' : '生成评标结果'}
            </button>
          </div>

          {/* 未全部确认报告时的警告 */}
          {!allReportsConfirmed && experts.length > 0 && (
            <div className="mt-3 bg-[oklch(0.96_0.04_85)] border border-[oklch(0.88_0.06_82)] p-3 flex items-center gap-2">
              <AlertTriangle
                size={14}
                strokeWidth={1.5}
                className="text-[oklch(0.64_0.16_82)] shrink-0"
              />
              <span className="text-[12px] text-[oklch(0.18_0.012_265)]">
                仍有 {unconfirmedCount} 位专家未确认评审报告，需全部确认后方可生成评标结果。
              </span>
            </div>
          )}
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[oklch(0.91_0.006_264)] text-left text-[oklch(0.55_0.01_264)]">
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">
                排名
              </th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">
                投标单位
              </th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">
                总分
              </th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">
                平均分
              </th>
              <th className="px-5 py-3 font-medium text-[11px] uppercase tracking-wider">
                推荐
              </th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-5 py-12 text-center text-[13px] text-[oklch(0.62_0.008_264)]"
                >
                  暂未生成评标结果
                </td>
              </tr>
            ) : (
              results.map(r => (
                <tr
                  key={r.id}
                  className="border-b border-[oklch(0.94_0.004_264)]"
                >
                  <td className="px-5 py-3 font-mono font-bold text-[oklch(0.18_0.012_265)]">
                    {r.rank}
                  </td>
                  <td className="px-5 py-3 font-medium text-[oklch(0.18_0.012_265)]">
                    {r.supplierName}
                  </td>
                  <td className="px-5 py-3 font-mono text-[oklch(0.18_0.012_265)]">
                    {r.totalScore}
                  </td>
                  <td className="px-5 py-3 font-mono font-bold text-[oklch(0.42_0.14_260)]">
                    {r.averageScore}
                  </td>
                  <td className="px-5 py-3">
                    {r.recommended ? (
                      <span className="text-[11px] font-semibold px-2 py-0.5 tracking-wide text-[#11a874] bg-[#f0faf6]">
                        第一中标候选人
                      </span>
                    ) : (
                      <span className="text-[11px] text-[oklch(0.62_0.008_264)]">
                        —
                      </span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
