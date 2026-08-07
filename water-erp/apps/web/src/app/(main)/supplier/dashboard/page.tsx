'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Building2, TrendingUp, Clock3, AlertTriangle, Activity, Star,
  Target, Layers, Lightbulb, ChevronDown, RefreshCw,
} from 'lucide-react';
import { getSupplierStats, getClassifications, getEvaluationStats, getQualificationAlerts, getRecentActivities, getFavorites, getEvaluationDimensionStats, getEnterpriseTypeDistribution } from '@/lib/api/supplier';
import { normalizeEnterpriseType } from '@/lib/utils/enterprise-type';
import type { SupplierStats, QualificationAlerts, ActivityItem, SupplierFavoriteRecord, DimensionStats } from '@/lib/api/supplier';
import type { SupplierClassification } from '@/lib/types';
import Link from 'next/link';

/* ─────────────── 供应结构分析（纯客户端规则推导，非 AI）─────────────── */
interface PortfolioInsight {
  type: 'warning' | 'info' | 'success';
  title: string;
  body: string;
  suggestion: string;
}

function deriveInsights(
  classifications: SupplierClassification[],
  stats: SupplierStats | null,
  evalStats: { levelCounts: { A: number; B: number; C: number; D: number; E: number }; excellentRatio: number; total: number } | null,
  alerts: QualificationAlerts | null,
): PortfolioInsight[] {
  const list: PortfolioInsight[] = [];
  if (!stats) return list;

  const total = stats.total || 0;
  const approved = stats.approved || 0;
  const pending = stats.pending || 0;
  const inactive = (stats.disabled || 0) + (stats.blacklist || 0);
  // 多分类场景下_sum可能超total（同一供应商归属多个分类），取min防溢出
  const classified = Math.min(
    classifications.reduce((s, c) => s + (c._count?.suppliers ?? 0), 0),
    total,
  );
  const sortedByCount = [...classifications].sort((a, b) => (b._count?.suppliers ?? 0) - (a._count?.suppliers ?? 0));

  /* ── 1. 资源池活力 ── */
  const approvedPct = total > 0 ? (approved / total) * 100 : 0;
  const inactivePct = total > 0 ? (inactive / total) * 100 : 0;
  if (approvedPct >= 70 && inactivePct <= 10) {
    list.push({
      type: 'success',
      title: `资源池活性良好（可用率 ${approvedPct.toFixed(0)}%，流失率 ${inactivePct.toFixed(0)}%）`,
      body: `${approved} 家在库供应商随时可参与项目选取，停用及黑名单仅 ${inactive} 家，占比处于健康区间。${pending > 10 ? `另有 ${pending} 家待审核可进一步补充。` : ''}`,
      suggestion: `继续保持当前审核与维护节奏。`,
    });
  } else if (inactivePct > 20) {
    list.push({
      type: 'warning',
      title: `非活跃供应商占比 ${inactivePct.toFixed(0)}%（${inactive} 家），资源池活性偏低`,
      body: `每 5 家入库供应商中有超过 1 家处于停用或黑名单状态，有效可调用的供应商仅为 ${approved} 家。${classified !== total ? `分类统计仅覆盖 ${classified} 家（${((classified/total)*100).toFixed(0)}%），${total - classified} 家尚未归入任何分类。` : ''}`,
      suggestion: `审核停用名单中可恢复资质的供应商；对长期停用的执行淘汰清理；加大新供应商准入招募。`,
    });
  } else {
    list.push({
      type: 'info',
      title: `可用 ${approved} 家，非活跃 ${inactive} 家（${inactivePct.toFixed(0)}%）`,
      body: `资源池规模 ${total} 家，已入库 ${approved} 家处于正常运营状态。${pending > 0 ? `${pending} 家新注册待审批——建议尽快处理避免积压。` : '无待审核积压。'}`,
      suggestion: `${pending > 10 ? `优先处理待审核队列。` : '可发起新供应商招募扩大资源池规模。'}`,
    });
  }

  /* ── 2. 评估覆盖率与质量 ── */
  if (evalStats && evalStats.total > 0) {
    const coveragePct = approved > 0 ? Math.min(100, (evalStats.total / approved) * 100) : 0;
    const aRate = ((evalStats.levelCounts.A / evalStats.total) * 100).toFixed(0);
    const abRate = (((evalStats.levelCounts.A + evalStats.levelCounts.B) / evalStats.total) * 100).toFixed(0);
    const deCount = (evalStats.levelCounts.D || 0) + (evalStats.levelCounts.E || 0);

    if (coveragePct < 25) {
      list.push({
        type: 'warning',
        title: `评估渗透率仅 ${coveragePct.toFixed(0)}%（${evalStats.total} 次 / ${approved} 家），存在大面积评估盲区`,
        body: `已入库供应商中仅 ${coveragePct.toFixed(0)}% 被评估过，剩余至少 ${Math.max(0, approved - evalStats.total)} 家（${(100 - coveragePct).toFixed(0)}%）的履约表现完全未知。选取供应商时无法基于历史数据筛选。`,
        suggestion: `对已入库但未评估的供应商启动首轮评价——优先覆盖已参与过项目的供应商，目标覆盖至少 60%。`,
      });
    } else if (evalStats.excellentRatio < 40) {
      list.push({
        type: 'warning',
        title: `优良率偏低 ${evalStats.excellentRatio.toFixed(1)}%，A 级 ${aRate}% / D+E 级 ${((deCount / evalStats.total) * 100).toFixed(0)}%`,
        body: `超过 ${((deCount) / evalStats.total * 100).toFixed(0)}% 评价集中在 D/E 区间（${deCount} 次），供应商整体履约质量有待提升。覆盖率 ${coveragePct.toFixed(0)}%。`,
        suggestion: `对新项目选取提高资质与履约权重；对 D/E 级供应商进行专项辅导或启动淘汰评估。`,
      });
    } else {
      list.push({
        type: 'success',
        title: `覆盖率 ${coveragePct.toFixed(0)}%，优良率 ${evalStats.excellentRatio.toFixed(1)}%，A 级占 ${aRate}%`,
        body: `${evalStats.total} 次评价中 A/B 级合计 ${evalStats.levelCounts.A + evalStats.levelCounts.B} 次（${abRate}%），整体履约质量较高。${deCount > 0 ? `${deCount} 次 D/E 级需单独关注。` : ''}`,
        suggestion: `继续保持评价频次与覆盖面，重点关注 D/E 级供应商的改进进展。`,
      });
    }
  } else {
    list.push({
      type: 'warning',
      title: `尚未发起任何供应商评价（${approved} 家在库供应商处于盲评状态）`,
      body: `供应商库已有 ${approved} 家入库供应商，但评估记录为 0。采购人员选取时仅能依据资质与企业类型做静态判断，风险较高。`,
      suggestion: `立即针对已参与项目的供应商启动首轮评价——优先覆盖参与过 2 个以上项目的供应商。`,
    });
  }

  /* ── 3. 分类结构 ── */
  if (classified > 0 && classifications.length >= 2) {
    const top = sortedByCount[0];
    const second = sortedByCount[1];
    const topPct = (top._count?.suppliers ?? 0) / classified * 100;
    const top2Pct = ((top._count?.suppliers ?? 0) + (second._count?.suppliers ?? 0)) / classified * 100;
    const thin = sortedByCount.filter(c => (c._count?.suppliers ?? 0) <= 1);

    if (topPct > 50) {
      list.push({
        type: 'warning',
        title: `分类「${top.name}」集中度 ${topPct.toFixed(0)}%（${top._count?.suppliers} 家），前 2 类占 ${top2Pct.toFixed(0)}%`,
        body: `该分类单独占据超过一半的供应商资源，需求波动将直接冲击供应链稳定。${thin.length ? `同时 ${thin.length} 个分类（${thin.map(c => c.name).join('、')}）仅 1 家或 0 家，属单一来源风险。` : ''}`,
        suggestion: `向 ${thin.length ? thin.map(c => c.name).join('、') : '薄弱分类'} 定向招募；将「${top.name}」占比目标降至 40% 以下。`,
      });
    } else if (top2Pct > 70) {
      list.push({
        type: 'info',
        title: `前 2 大分类（${top.name}、${second.name}）合计 ${top2Pct.toFixed(0)}%，供给偏集中`,
        body: `虽未出现单一过半的极端情况，但前二合计覆盖七成以上资源。${thin.length ? `${thin.length} 个分类仅 1 家或 0 家（${thin.map(c => c.name).join('、')}）。` : ''}`,
        suggestion: `在选取与准入中有意识地偏向占比低的分类；为每分类设定最低 3 家供给底线。`,
      });
    } else if (thin.length > 0) {
      list.push({
        type: 'info',
        title: `${thin.length} 个薄弱分类待补充（${thin.map(c => `${c.name}(${c._count?.suppliers ?? 0}家)`).join('、')}）`,
        body: `整体结构合理，但上述分类供应商数过少，选取时可选范围极为有限，一旦供应商无法履约则无替代。`,
        suggestion: `定向招募以上分类的供应商，每分类至少补充至 3 家，确保选取有冗余选项。`,
      });
    } else {
      list.push({
        type: 'success',
        title: `分类结构均衡（${classifications.length} 类，最高 ${topPct.toFixed(0)}%，均 ${(classified / classifications.length).toFixed(1)} 家/类）`,
        body: `各分类供应商数量分布合理，无过度集中的单点风险，也无严重薄弱分类。`,
        suggestion: `保持当前分类管理策略，定期复核各分类供应商活跃度与履约质量。`,
      });
    }
  }

  /* ── 4. 资质到期风险 ── */
  if (alerts) {
    const riskTotal = (alerts.expiredCount || 0) + (alerts.expiringCount || 0);
    const affectedPct = total > 0 ? ((alerts.affectedSupplierCount || 0) / total * 100).toFixed(0) : '0';
    if (riskTotal > 0) {
      if (alerts.expiredCount > 0) {
        list.push({
          type: 'warning',
          title: `${alerts.expiredCount} 项资质已过期，影响 ${alerts.affectedSupplierCount} 家供应商（${affectedPct}%）`,
          body: `过期资质直接导致供应商失去参与对应项目的资格。${alerts.expiringCount > 0 ? `另有 ${alerts.expiringCount} 项即将到期，若不更新将扩大影响面。` : ''}`,
          suggestion: `立即通知受影响供应商更新已过期资质；对即将到期资质提前 30 天启动续期。`,
        });
      } else {
        list.push({
          type: 'info',
          title: `${alerts.expiringCount} 项即将到期，涉及 ${alerts.affectedSupplierCount} 家供应商`,
          body: `虽无已过期资质，但即将到期项若未及时续期将导致供应商失去项目参与资格。`,
          suggestion: `主动通知这 ${alerts.affectedSupplierCount} 家供应商提前准备续期材料，避免到期被动停用。`,
        });
      }
    } else if (classified > 0) {
      list.push({
        type: 'success',
        title: `资质状态良好，无到期风险`,
        body: `当前 ${total} 家供应商的资质均在有效期内。`,
        suggestion: `定期（建议每两周）检查资质到期预警面板，尽早发现新增风险。`,
      });
    }
  }

  if (list.length === 0 && total > 0) {
    list.push({
      type: 'success',
      title: '各项指标正常，供应结构整体健康',
      body: `资源池规模 ${total} 家，已入库 ${approved} 家，暂无异常信号。`,
      suggestion: `继续保持当前管理节奏，定期查看总览关注变化趋势。`,
    });
  }

  return list;
}

const toneMap: Record<PortfolioInsight['type'], { color: string; bar: string }> = {
  warning: { color: 'var(--warning)', bar: 'var(--warning)' },
  info: { color: 'var(--accent)', bar: 'var(--accent)' },
  success: { color: 'var(--success)', bar: 'var(--success)' },
};

/* ─────────────── 评价等级 + 五维等级分布 + 企业类型 ─────────────── */
const DIM_META: [keyof Omit<DimensionStats, 'total'>, string][] = [
  ['completeness', '资料完整性'],
  ['responsiveness', '响应及时性'],
  ['cooperation', '配合协作'],
  ['compliance', '合规守信'],
  ['comprehensive', '综合评价'],
];
const GRADES = ['A', 'B', 'C', 'D', 'E'] as const;
const GRADE_COLORS: Record<string, string> = { A: 'var(--success)', B: 'var(--accent)', C: 'var(--warning)', D: '#ca8a04', E: 'var(--danger)' };

function EvalColumn({
  evalStats,
  dimStats,
  enterpriseTypeCounts,
}: {
  evalStats: { levelCounts: { A: number; B: number; C: number; D: number; E: number }; excellentRatio: number; total: number };
  dimStats: DimensionStats | null;
  enterpriseTypeCounts: Record<string, number>;
}) {
  const colors: Record<string, string> = { A: 'var(--success)', B: 'var(--accent)', C: 'var(--warning)', D: '#ca8a04', E: 'var(--danger)' };
  const total = evalStats.levelCounts.A + evalStats.levelCounts.B + evalStats.levelCounts.C + evalStats.levelCounts.D + (evalStats.levelCounts.E || 0) || 1;
  let acc = 0;
  const stops = (['A', 'B', 'C', 'D', 'E'] as const)
    .map(l => { const c = evalStats.levelCounts[l]; if (!c) return null; const s = (acc / total) * 360; acc += c; return `${colors[l]} ${s.toFixed(1)}deg ${(acc / total * 360).toFixed(1)}deg`; })
    .filter(Boolean).join(', ');

  const hasTypes = Object.keys(enterpriseTypeCounts).length > 0;
  const typeSorted = Object.entries(enterpriseTypeCounts).sort((a, b) => b[1] - a[1]);
  const typeMax = Math.max(1, ...Object.values(enterpriseTypeCounts));

  return (
    <div className="flex-1 flex flex-col gap-2.5 min-h-0">
      {/* Donut + legend */}
      <div className="flex items-center gap-4 flex-shrink-0">
        <div className="relative flex-shrink-0" style={{ width: 88, height: 88 }}>
          <div className="w-full h-full rounded-full" style={{ background: `conic-gradient(${stops || 'var(--muted)'})` }} />
          <div className="absolute inset-[14px] rounded-full bg-[var(--background)] flex items-center justify-center shadow-[inset_0_1px_3px_oklch(0.55_0.03_258/0.1)]">
            <div className="text-center">
              <div className="text-sm font-black tabular-nums text-[var(--foreground)] leading-none">{evalStats.excellentRatio.toFixed(0)}%</div>
              <div className="text-[8px] text-[var(--muted-foreground)] mt-0.5">优良率</div>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1 text-[10px]">
          {(['A', 'B', 'C', 'D', 'E'] as const).map(l => (
            <div key={l} className="flex items-center gap-1.5">
              <span className="inline-flex h-3 w-3 items-center justify-center rounded-sm text-[7px] font-extrabold text-white flex-shrink-0" style={{ backgroundColor: colors[l] }}>{l}</span>
              <span className="w-7 tabular-nums font-semibold text-[var(--foreground)]">{evalStats.levelCounts[l]}</span>
              <span className="tabular-nums text-[var(--muted-foreground)]/70">{((evalStats.levelCounts[l] / total) * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-[var(--muted-foreground)] flex-shrink-0 leading-snug">
        {evalStats.excellentRatio >= 60 ? '整体优秀，供应质量可靠' : evalStats.excellentRatio >= 40 ? '整体良好，个别供应商需关注' : evalStats.excellentRatio >= 20 ? '等级偏低，建议加强评价频次' : '优良率偏低，须启动重点治理'} · {evalStats.total} 次评价
      </p>

      {/* Five-dimension grade distribution mini bars */}
      {dimStats && dimStats.total > 0 && (
        <div className="flex flex-col gap-1">
          {DIM_META.map(([key, label]) => {
            const grades = dimStats[key] as Record<string, number>;
            const dimTotal = Object.values(grades).reduce((a, b) => a + b, 0) || 1;
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-[var(--muted-foreground)] w-[68px] flex-shrink-0 truncate">{label}</span>
                <div className="flex-1 h-3 rounded-full bg-[var(--muted)]/25 overflow-hidden flex gap-px">
                  {(['A', 'B', 'C', 'D', 'E'] as const).map(g => {
                    const count = grades[g] || 0;
                    const pct = (count / dimTotal) * 100;
                    return pct > 0 ? (
                      <div key={g} className="h-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: GRADE_COLORS[g], opacity: 0.55 }} title={`${g}级: ${count}`} />
                    ) : null;
                  })}
                </div>
                <span className="text-[9px] tabular-nums font-semibold text-[var(--muted-foreground)] w-8 text-right flex-shrink-0">{dimTotal}次</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Enterprise type distribution */}
      {hasTypes && (
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]/50">企业类型</span>
          {typeSorted.map(([t, count]) => (
            <div key={t} className="flex items-center gap-2">
              <span className="text-[10px] font-medium text-[var(--foreground)] w-[68px] flex-shrink-0 truncate">{t}</span>
              <div className="flex-1 h-2.5 rounded-full bg-[var(--muted)]/25 overflow-hidden">
                <div className="h-full rounded-full bg-[var(--accent)]/45 transition-all duration-700" style={{ width: `${(count / typeMax) * 100}%` }} />
              </div>
              <span className="text-[10px] tabular-nums font-semibold text-[var(--muted-foreground)] w-8 text-right flex-shrink-0">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────── 主页面 ─────────────── */
export default function SupplierDashboardPage() {
  const [stats, setStats] = useState<SupplierStats | null>(null);
  const [classifications, setClassifications] = useState<SupplierClassification[]>([]);
  const [evalStats, setEvalStats] = useState<{ levelCounts: { A: number; B: number; C: number; D: number; E: number }; excellentRatio: number; total: number } | null>(null);
  const [dimStats, setDimStats] = useState<DimensionStats | null>(null);
  const [enterpriseTypeCounts, setEnterpriseTypeCounts] = useState<Record<string, number>>({});
  const [alerts, setAlerts] = useState<QualificationAlerts | null>(null);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [favorites, setFavorites] = useState<SupplierFavoriteRecord[]>([]);
  const [insightsExpanded, setInsightsExpanded] = useState(true);
  const [loadError, setLoadError] = useState(false); // B13：任一面板加载失败即提示，避免静默空面板

  const loadDashboard = useCallback(() => {
    setLoadError(false);
    const fail = () => setLoadError(true);
    getSupplierStats().then(setStats).catch(fail);
    getClassifications().then(setClassifications).catch(fail);
    getEvaluationStats().then(setEvalStats).catch(fail);
    getEvaluationDimensionStats().then(setDimStats).catch(fail);
    getQualificationAlerts().then(setAlerts).catch(fail);
    getRecentActivities().then(setActivities).catch(fail);
    getFavorites().then(setFavorites).catch(fail);
    // P0-14：改后端 groupBy 聚合，不再拉 1000 条客户端计数（>1000 家偏少 + 首页开销大）。
    getEnterpriseTypeDistribution()
      .then(({ counts }) => {
        const norm: Record<string, number> = {};
        for (const [k, v] of Object.entries(counts)) { const t = normalizeEnterpriseType(k); norm[t] = (norm[t] || 0) + v; }
        setEnterpriseTypeCounts(norm);
      })
      .catch(fail);
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const insights = useMemo(() => deriveInsights(classifications, stats, evalStats, alerts), [classifications, stats, evalStats, alerts]);
  const actionLabels: Record<string, string> = {
    SUPPLIER_APPROVED: '审核通过', SUPPLIER_REJECTED: '审核不通过', SUPPLIER_RETURNED: '退回补正',
    SUPPLIER_DISABLED: '停用', SUPPLIER_BLACKLIST: '拉黑', SUPPLIER_ELIMINATED: '淘汰',
    SUPPLIER_RESTORED: '恢复正常', SUPPLIER_RESUBMITTED: '重新提交', SUPPLIER_REACTIVATED: '重新激活',
    SUPPLIER_CHANGE_APPROVED: '变更审批通过', SUPPLIER_CHANGE_REJECTED: '变更驳回',
    SUPPLIER_CONVERTED_REGULAR: '转正式供应商', SUPPLIER_EVALUATION_CREATED: '履约评价',
    SUPPLIER_TAGS_UPDATED: '业务标签更新', SUPPLIER_TAGS_BACKFILL: '业务标签回填',
  };
  const maxCatCount = Math.max(1, ...classifications.map(c => c._count?.suppliers ?? 0));

  return (
    <div className="flex flex-col gap-4">
      {/* ══════ Page Hero ══════ */}
      <div className="page-hero">
        <div className="page-hero__row">
          <div className="page-hero__left">
            <div className="page-hero__icon"><Building2 size={17} /></div>
            <div>
              <div className="page-hero__title">供应商总览</div>
              <div className="page-hero__sub">资源池全景 · 供应结构分析</div>
            </div>
          </div>
          <div className="page-hero__right">
            <Link href="/supplier/repository" className="neu-btn-soft">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
              返回供应商库
            </Link>
          </div>
        </div>
        <div style={{ borderTop: "1px solid oklch(0.6 0.04 258 / 0.16)", paddingTop: "1rem" }}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 items-stretch">
          {[
            ['供应商总数', stats?.total ?? '—', '全量入库'],
            ['已入库',     stats?.approved ?? '—', '正常运营'],
            ['待审核',     stats?.pending ?? '—', '新注册申请'],
            ['停用/黑名单', stats ? (stats.disabled ?? 0) + (stats.blacklist ?? 0) : '—', '状态冻结'],
          ].map(([l, v, sub]) => (
            <div key={l} className="kpi-card group flex h-full flex-col gap-1.5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-foreground)] leading-none">{l}</span>
              <span className="text-[1.55rem] font-black tracking-[-0.04em] leading-none tabular-nums text-[var(--foreground)]">{v}</span>
              <span className="text-[10px] font-medium text-[var(--muted-foreground)] leading-tight">{sub}</span>
            </div>
          ))}
        </div>
        </div>
      </div>

      {/* B13 错误态：部分面板加载失败时提示+重试，避免静默空面板 */}
      {loadError && (
        <div className="neu-card-static !rounded-2xl p-4 flex items-center gap-3" style={{ background: 'color-mix(in oklch, var(--danger) 8%, transparent)' }}>
          <AlertTriangle size={16} className="text-[var(--danger)] shrink-0" />
          <span className="text-sm text-[var(--foreground)] flex-1">部分数据加载失败，当前展示可能不完整</span>
          <button onClick={loadDashboard} className="neu-btn-xs gap-1"><RefreshCw size={12} />重试</button>
        </div>
      )}

      {/* ══════ 待处理指引 ══════ */}
      {((stats && (stats.pending > 0 || (stats.disabled ?? 0) + (stats.blacklist ?? 0) > 0)) || (alerts && (alerts.expiredCount > 0 || alerts.expiringCount > 0))) && (
        <div className="flex flex-wrap gap-2">
          {stats && stats.pending > 0 && (
            <Link href="/supplier/approval" className="kpi-card group flex items-center gap-3 p-3 rounded-xl flex-1 min-w-[180px]">
              <div className="neu-icon-well flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]">
                <Clock3 size={15} className="text-[var(--warning)]" />
              </div>
              <div>
                <div className="text-xs font-bold text-[var(--foreground)]">待审核</div>
                <div className="text-[1.35rem] font-black tabular-nums text-[var(--warning)] leading-none">{stats.pending}</div>
                <div className="text-[9px] text-[var(--muted-foreground)]">前往审批 →</div>
              </div>
            </Link>
          )}
          {alerts && alerts.expiredCount > 0 && (
            <Link href="/supplier/qualification-alerts" className="kpi-card group flex items-center gap-3 p-3 rounded-xl flex-1 min-w-[180px]">
              <div className="neu-icon-well flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]">
                <AlertTriangle size={15} className="text-[var(--danger)]" />
              </div>
              <div>
                <div className="text-xs font-bold text-[var(--foreground)]">资质过期</div>
                <div className="text-[1.35rem] font-black tabular-nums text-[var(--danger)] leading-none">{alerts.expiredCount}</div>
                <div className="text-[9px] text-[var(--muted-foreground)]">前往预警 →</div>
              </div>
            </Link>
          )}
          {alerts && alerts.expiringCount > 0 && (
            <Link href="/supplier/qualification-alerts" className="kpi-card group flex items-center gap-3 p-3 rounded-xl flex-1 min-w-[180px]">
              <div className="neu-icon-well flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]">
                <Clock3 size={15} className="text-[var(--warning)]" />
              </div>
              <div>
                <div className="text-xs font-bold text-[var(--foreground)]">即将到期</div>
                <div className="text-[1.35rem] font-black tabular-nums text-[var(--warning)] leading-none">{alerts.expiringCount}</div>
                <div className="text-[9px] text-[var(--muted-foreground)]">前往预警 →</div>
              </div>
            </Link>
          )}
        </div>
      )}

      {/* ══════ 资质预警 ══════ */}
      {alerts && (alerts.expiredCount > 0 || alerts.expiringCount > 0) && (
        <div className="neu-table-card p-4">
          <div className="flex flex-wrap gap-3 items-center">
            <AlertTriangle size={13} className="text-[var(--warning)]" />
            {alerts.expiredCount > 0 && <span className="rounded-lg bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-3 py-1.5 text-xs font-semibold text-[var(--danger)]">已过期 {alerts.expiredCount} 项</span>}
            {alerts.expiringCount > 0 && <span className="rounded-lg bg-[color-mix(in_oklch,var(--warning)_10%,transparent)] px-3 py-1.5 text-xs font-semibold text-[var(--warning)]">即将过期 {alerts.expiringCount} 项</span>}
            <span className="text-xs text-[var(--muted-foreground)]">影响 {alerts.affectedSupplierCount} 家</span>
            <Link href="/supplier/qualification-alerts" className="neu-btn-xs is-warning ml-auto">查看详情</Link>
          </div>
        </div>
      )}

      {/* ══════ 三列中间区域 ══════ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* 列 1 | 分类分布 */}
        <div className="neu-table-card p-5 flex flex-col">
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-4 flex-shrink-0 flex items-center gap-2">
            <Layers size={13} />分类分布
          </h3>
          {classifications.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] py-8 text-center flex-1 flex items-center justify-center">暂无分类数据</p>
          ) : (
            <div className="space-y-3 flex-1 min-h-0 overflow-y-auto">
              {classifications.map(c => {
                const count = c._count?.suppliers ?? 0;
                const pct = maxCatCount > 0 ? (count / maxCatCount) * 100 : 0;
                return (
                  <div key={c.id} className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-[var(--foreground)] w-20 truncate" title={c.name}>{c.name}</span>
                    <div className="flex-1 h-5 rounded-md bg-[var(--muted)]/30 overflow-hidden">
                      <div className="h-full rounded-md bg-[var(--accent)]/50 transition-all duration-700" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-[var(--muted-foreground)] w-10 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 列 2 | 评价 + 五维 + 类型 */}
        <div className="neu-table-card p-5 flex flex-col">
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-4 flex-shrink-0 flex items-center gap-2">
            <TrendingUp size={13} />评价与构成
          </h3>
          {!evalStats || evalStats.total === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] py-8 text-center flex-1 flex items-center justify-center">暂无评价数据</p>
          ) : (
            <EvalColumn evalStats={evalStats} dimStats={dimStats} enterpriseTypeCounts={enterpriseTypeCounts} />
          )}
        </div>

        {/* 列 3 | 供应结构分析（规则推导，非 AI——如实标注，避免误导） */}
        <div className="neu-table-card p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4 flex-shrink-0">
            <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] flex items-center gap-2">
              <Lightbulb size={13} />供应结构分析
              <span className="normal-case tracking-normal text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--muted)]/40 text-[var(--muted-foreground)]">规则推导</span>
            </h3>
            <button onClick={() => setInsightsExpanded(v => !v)} className="neu-btn-xs text-[var(--muted-foreground)]">
              <ChevronDown size={12} className={`transition-transform ${insightsExpanded ? '' : 'rotate-[-90deg]'}`} />
            </button>
          </div>

          {insights.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] py-6 text-center flex-1 flex items-center justify-center">正在分析供应结构…</p>
          ) : !insightsExpanded ? (
            <p className="text-xs text-[var(--muted-foreground)]/50 text-center py-4 flex-1 flex items-center justify-center">已折叠 {insights.length} 条洞察</p>
          ) : (
            <div className="space-y-2 flex-1 min-h-0 overflow-y-auto">
              {insights.map((item, i) => {
                const tone = toneMap[item.type];
                return (
                  <div key={i} className="rounded-lg px-2.5 py-2" style={{ backgroundColor: `color-mix(in oklch, ${tone.color} 6%, transparent)` }}>
                    <div className="flex items-start gap-1.5 mb-0.5">
                      <span className="mt-[3px] flex-shrink-0" style={{ color: tone.color }}>
                        <Target size={13} />
                      </span>
                      <span className="text-xs font-bold text-[var(--foreground)] leading-snug">{item.title}</span>
                    </div>
                    <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed ml-[19px]">{item.body}</p>
                    <p className="text-[11px] leading-relaxed ml-[19px] mt-0.5">
                      <span className="font-semibold text-[var(--foreground)]">→ </span>
                      <span className="text-[var(--muted-foreground)]">{item.suggestion}</span>
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ══════ 底部两列 ══════ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="neu-table-card p-5 flex flex-col">
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-4 flex-shrink-0 flex items-center gap-2"><Activity size={13} />近期动态</h3>
          {activities.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] py-4 text-center flex-1 flex items-center justify-center">暂无动态</p>
          ) : (
            <div className="space-y-2 flex-1 min-h-0 overflow-y-auto">
              {activities.map(a => (
                <div key={a.id} className="flex items-start gap-3 neu-card-static !rounded-xl !p-3">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/10 text-[10px] font-extrabold text-[var(--accent)]">
                    {actionLabels[a.action]?.[0] || a.action[0]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-[var(--foreground)] truncate">{actionLabels[a.action] || a.action}</div>
                    <div className="text-[10px] text-[var(--muted-foreground)]/70 mt-0.5">{a.actorName} · {new Date(a.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                    {a.details?.name && <div className="text-[11px] text-[var(--muted-foreground)] italic mt-0.5">{a.details.name}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="neu-table-card p-5 flex flex-col">
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-4 flex-shrink-0 flex items-center gap-2"><Star size={13} />我的关注</h3>
          {favorites.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] py-4 text-center flex-1 flex items-center justify-center">暂无关注供应商，在供应商库中点击 ⭐ 即可关注</p>
          ) : (
            <div className="space-y-2 flex-1 min-h-0 overflow-y-auto">
              {favorites.map(f => (
                <Link key={f.id} href={`/supplier/${f.supplierId}`} className="flex items-center gap-3 neu-card-static !rounded-xl !p-3 hover:ring-1 hover:ring-[var(--accent)]/20 transition">
                  <Star size={13} fill="var(--warning)" stroke="var(--warning)" className="flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-[var(--foreground)] truncate">{f.supplier.name}</div>
                    <div className="text-[10px] text-[var(--muted-foreground)]/70 mt-0.5">{normalizeEnterpriseType(f.supplier.enterpriseType)} · {f.supplier.classification?.name || '未分类'}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
