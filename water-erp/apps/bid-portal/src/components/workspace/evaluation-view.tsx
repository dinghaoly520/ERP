'use client';

/**
 * 只读评标管理视图——:3007 项目工作区「评标管理」tab（Phase 2 · T16）。
 * 移植自 apps/web/src/components/projects/bid-confirm/evaluation-block.tsx
 * （:3005 开评标指挥中心评标区块，源文件 684 行）：进度四联、专家状态卡、
 * 专家×供应商评分矩阵（偏差 >20% 标异常）、供应商汇总排名（官方结果 /
 * 实时均分参考）、偏差异常清单。
 *
 * 只读裁剪（总则：所有流程流转归 :3005，本端零操作按钮）：
 * - 删除：启动评标横幅 + handleStartEvaluation（源 L219-230 / L292-313）；
 * - 删除：「生成评标结果」按钮 + 3 步向导模态 + handleGenerate（源 L232-246 / L272-276 / L570-681）；
 * - 删除：催促专家按钮及 busy 操作态（源文件移植到 :3005 时已剥离 nudge*，本次确认无残留）；
 * - 改动：进度第四联源为「可生成结果」（服务生成向导），本端改为「得分异常数」。
 *
 * 实时性：评标在场事件（expert:presence / expert:presence:aggregate / stage 变更）
 * 驱动项目上下文 refetch（专家签到/评分进度回流）+ 官方结果重拉。
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronRight, ClipboardCheck,
  FileCheck, ShieldCheck, Star, Trophy, UserCheck, X,
} from 'lucide-react';
import { listEvaluationResults, type EvaluationResultRow } from '@/lib/api/bid';
import type { BidProjectDetail, ScoreCategory } from '@/lib/types';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import { useBidWebSocket } from '@/hooks/use-bid-websocket';

/** 通过性类别（满分 0，只记通过/不通过） */
const PASS_FAIL_CATEGORIES: ScoreCategory[] = ['QUALIFICATION', 'RESPONSIVE'];
const ANOMALY_THRESHOLD = 20; // 偏差 >20% 标异常

/** 评标前置阶段中文标签（阶段闸门空态展示用） */
const PRE_EVAL_STAGE_LABEL: Record<string, string> = { DOWNLOAD: '文件下载', SUBMIT: '投标提交' };

type ExpertInfo = BidProjectDetail['experts'][number];
type SupplierInfo = BidProjectDetail['suppliers'][number];

/** 后端 BidEvaluationResult 另含 disqualified / averageScore（T8 EvaluationResultRow 仅声明子集）；本地交叉补齐 */
type OfficialResultRow = EvaluationResultRow & { disqualified?: boolean };

/* ── 聚合工具（源 evaluation-block.tsx L40-83 原样移植）── */

interface ExpertSupplierCell {
  totalScore: number;
  maxScore: number;
  scoredCount: number;
  items: { name: string; category: ScoreCategory; score: number; maxScore: number; passed?: boolean | null; reason?: string | null }[];
}
type ExpertSupplierMatrix = Map<string, Map<string, ExpertSupplierCell>>;

function buildExpertSupplierMatrix(detail: BidProjectDetail): ExpertSupplierMatrix {
  const itemMap = new Map(detail.scoreItems.map(si => [si.id, si]));
  const matrix: ExpertSupplierMatrix = new Map();
  for (const expert of detail.experts) {
    const row: Map<string, ExpertSupplierCell> = new Map();
    for (const supplier of detail.suppliers) {
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
        name: item.name, category: item.category, score, maxScore: Number(item.maxScore),
        passed: record.passed, reason: record.reason,
      });
    }
    matrix.set(expert.id, row);
  }
  return matrix;
}

/** 各专家对同一供应商的百分制得分（用于偏差检测与实时均分） */
function supplierPercentScores(detail: BidProjectDetail, matrix: ExpertSupplierMatrix, supplierId: string): number[] {
  const scores: number[] = [];
  for (const expert of detail.experts) {
    const cell = matrix.get(expert.id)?.get(supplierId);
    if (cell && cell.maxScore > 0) scores.push((cell.totalScore / cell.maxScore) * 100);
  }
  return scores;
}

/* ── 迷你环形进度 / 进度磁贴（源 L86-115 原样移植）── */

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

export default function EvaluationView({ projectId, onRefresh }: { projectId: string; onRefresh: () => void }) {
  const { project } = useBidProjectContext();
  const [results, setResults] = useState<OfficialResultRow[]>([]);
  const [expandedExperts, setExpandedExperts] = useState<Set<string>>(new Set());
  const [expandedCell, setExpandedCell] = useState<string | null>(null); // `${expertId}:${supplierId}`

  const loadResults = useCallback(() => {
    listEvaluationResults(projectId).then(setResults).catch(() => {});
  }, [projectId]);

  // 仅按项目挂载拉取（project 每次 socket 刷新都换引用，放入依赖会导致任何无关事件都重拉评标结果）
  useEffect(() => { loadResults(); }, [loadResults]);

  // 评标在场事件 → 刷新项目上下文（专家签到/评分进度实时回流）+ 结果重拉
  useBidWebSocket(projectId, {
    onExpertPresence: () => { onRefresh(); },
    onExpertPresenceAggregate: () => { onRefresh(); },
    onStageChange: () => { onRefresh(); loadResults(); },
  });

  /* ── 派生数据（源 L141-216）── */
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

  if (!project) return null;
  const { stage, experts, suppliers, scoreItems } = project;

  // 阶段闸门（源 L170）：开标前阶段无评标数据——源返回 null，tab 化改空态卡
  if (stage !== 'OPENING' && stage !== 'EVALUATING' && stage !== 'ARCHIVED') {
    return (
      <section className="neu-card-static px-5 py-10 text-center text-xs leading-5 text-[var(--muted-foreground)]">
        项目处于「{PRE_EVAL_STAGE_LABEL[stage] ?? stage}」阶段，尚未进入评标——在线开标启动后评标数据将实时回流至本视图
      </section>
    );
  }

  const signedIn = experts.filter(e => e.signedIn).length;
  const reportsDone = experts.filter(e => e.reportConfirmed).length;

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
  const anomalies: { expert: ExpertInfo; supplier: SupplierInfo; pct: number; avg: number }[] = [];
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

  const isCellAnomaly = (expertId: string, supplierId: string): boolean => {
    const cell = matrix.get(expertId)?.get(supplierId);
    if (!cell || cell.maxScore <= 0) return false;
    const avg = supplierAvg.get(supplierId) ?? 0;
    return avg > 0 && Math.abs((cell.totalScore / cell.maxScore) * 100 - avg) > ANOMALY_THRESHOLD;
  };

  return (
    <div className="space-y-4">
      {/* ── 头部（源 L257-271；「生成评标结果」按钮已删）── */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
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
        <span className="text-[10px] text-[var(--muted-foreground)]">只读视图 · 评标流转操作在采购管理工作台（:3005）进行</span>
      </div>

      {/* ── 进度四联（源 L315-337；第四联源为「可生成结果」，本端改「得分异常数」）── */}
      <section className="neu-card-static px-4 py-3.5">
        <div className="flex flex-wrap gap-2.5">
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
            label="得分异常数" value={`${anomalies.length}`}
            sub={anomalies.length === 0 ? '无偏差超限评分' : `偏差 >${ANOMALY_THRESHOLD}% 待重点复核`}
            pct={anomalies.length === 0 ? 100 : 0}
            color={anomalies.length === 0 ? 'var(--success)' : 'var(--danger)'}
          />
        </div>
      </section>

      {/* ── 专家状态卡（源 L340-431 原样；催促按钮源已无残留）── */}
      <section className="neu-card-static overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
          <span className="text-[11px] font-bold text-[var(--foreground)]">专家状态</span>
          <span className="text-[10px] text-[var(--muted-foreground)]">点击展开查看各供应商评分明细</span>
        </div>
        {experts.length === 0 ? (
          <div className="px-3.5 py-6 text-center text-xs text-[var(--muted-foreground)]">
            尚未抽取专家{stage !== 'ARCHIVED' && '——请在专家管理中心完成抽取'}
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
      </section>

      {/* ── 专家×供应商评分矩阵（源 L433-518 原样；外壳换 neu-card-static）── */}
      {experts.length > 0 && suppliers.length > 0 && (
        <section className="neu-card-static overflow-hidden">
          <div className="overflow-x-auto">
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
                      <td className="px-3.5 py-2 font-medium text-[var(--foreground)]">{expert.expertName}</td>
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
                                onClick={() => setExpandedCell(prev => (prev === key ? null : key))}
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
                                {expert.expertName} → {supplier?.supplierName} · {cell.totalScore.toFixed(1)}/{cell.maxScore}（{cell.scoredCount}/{scoreItems.length} 项）
                              </span>
                              <button type="button" onClick={() => setExpandedCell(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X size={11} /></button>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              {cell.items.map((it: ExpertSupplierCell['items'][number]) => (
                                <span key={it.name} className="text-[10px] text-[var(--muted-foreground)]" title={it.reason ?? undefined}>
                                  {it.name}{' '}
                                  <b style={{ color: it.passed === false ? 'var(--danger)' : 'var(--foreground)' }}>
                                    {PASS_FAIL_CATEGORIES.includes(it.category) ? (it.passed === false ? '不通过' : '通过') : `${it.score}/${it.maxScore}`}
                                  </b>
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })()}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {anomalies.length > 0 && (
            <div className="flex items-start gap-1.5 px-3.5 py-2 text-[10px]" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.1)', background: 'color-mix(in oklch, var(--danger) 5%, transparent)', color: 'var(--danger)' }}>
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span>{anomalies.length} 处评分偏差超过 {ANOMALY_THRESHOLD}%（与全体均分相比），生成结果前请重点复核。</span>
            </div>
          )}
        </section>
      )}

      {/* ── 供应商汇总与排名（源 L520-567 原样；「生成评标结果」入口已删）── */}
      <section className="neu-card-static overflow-hidden">
        <div className="flex items-center justify-between px-3.5 py-2.5" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.1)', background: 'oklch(0.975 0.012 258 / 0.5)' }}>
          <span className="text-[11px] font-bold text-[var(--foreground)]">供应商排名</span>
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {results.length > 0 ? '官方评标结果（去极值 · 废标置后）' : '实时均分参考（未生成官方结果）'}
          </span>
        </div>
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
                  <span className="font-mono text-xs font-bold tabular-nums text-[var(--accent-strong)]">
                    {official ? Number(official.totalScore).toFixed(2) : avg.toFixed(1)}
                    <span className="ml-1 text-[9px] font-normal text-[var(--muted-foreground)]">{official ? '官方总分' : '均分参考'}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── 偏差异常清单（明细行源自向导 step1 L630-641，向导删除后独立为只读卡）── */}
      {anomalies.length > 0 && (
        <section className="neu-card-static overflow-hidden">
          <div className="flex flex-wrap items-center gap-1.5 px-4 py-3" style={{ borderBottom: '1px solid oklch(0.6 0.04 258 / 0.14)' }}>
            <AlertTriangle size={12} className="shrink-0 text-[var(--danger)]" />
            <span className="text-[11px] font-bold text-[var(--foreground)]">评分偏差异常</span>
            <span className="text-[10px] text-[var(--muted-foreground)]">与全体均分偏差超过 {ANOMALY_THRESHOLD}%，结果生成前请重点复核（生成在 :3005 进行）</span>
          </div>
          <div className="space-y-1.5 px-4 py-3">
            {anomalies.map((a, i) => (
              <div key={i} className="flex items-center gap-2 rounded-[10px] px-3 py-2" style={{ background: 'color-mix(in oklch, var(--danger) 7%, transparent)' }}>
                <AlertTriangle size={12} className="shrink-0 text-[var(--danger)]" />
                <span className="flex-1 text-[11px]">
                  <b>{a.expert.expertName}</b> 对 <b>{a.supplier.supplierName}</b> 打分
                  <b className="mx-1 tabular-nums" style={{ color: 'var(--danger)' }}>{a.pct.toFixed(1)}%</b>
                  （全体均分 <b className="tabular-nums">{a.avg.toFixed(1)}%</b>）
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
