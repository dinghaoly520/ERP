'use client';

// 采购台账 AI 分析·第二步「综合分析报告」（2026-10-21 重设计）。
// 原版问题：四色平铺 KPI 卡 + 三张图（饼图只画已成交/待处理/异常三态且硬编码 314
// 周长，各态相加不等于总数、比例失真）+ AI 长文单列瀑布——报告「算的是哪些记录」
// 无从核对。
// 重设计要点：
//   ① KPI 改 hairline 分隔报表带 + 副注（覆盖条数/成交笔数/口径），monospace 数字；
//   ② 状态分布改全量四分组环图（含「其他」，比例自洽、中心总数）；
//   ③ AI 区：骨架屏加载态、编号条目、「AI 生成 · 仅供参考」标注；
//   ④ 可折叠「参与分析明细」表——核对数据范围，报告可回溯；
//   ⑤ 导出报告补统计区间/分布/明细，脱离界面仍自洽。

import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Activity,
  AlertCircle,
  Building2,
  ChevronDown,
  FileText,
  Lightbulb,
  List,
  Loader2,
  PieChart,
  Sparkles,
  Target,
} from 'lucide-react';
import { Modal } from '@/components/workbench';
import type { AiAnalysisResult, LedgerStatusGroup } from '@/components/procurements/ledger-analysis';
import { buildLedgerAnalysisSummary, LEDGER_GROUP_COLOR, LEDGER_GROUP_LABEL } from '@/components/procurements/ledger-analysis';
import type { ProcurementRoundItem } from '@/lib/types/procurement';
import { formatWan } from '@/lib/format';

const BLUE = 'rgba(96,139,239,1)';
const TEAL = 'rgba(92,181,150,1)';
const GOLD = 'rgba(234,188,110,1)';
const CORAL = 'rgba(230,129,102,1)';
const INDIGO = 'rgba(119,129,219,1)';
const HAIRLINE = 'oklch(0.6 0.04 258 / 0.14)';
const BAR_TRACK = 'rgba(200,215,235,0.25)';
const BAR_COLORS = [BLUE, TEAL, GOLD, INDIGO, CORAL];

const easeOutQuint: [number, number, number, number] = [0.22, 1, 0.36, 1];

function fadeIn(index: number, reducedMotion: boolean, baseDelay = 0.05) {
  if (reducedMotion) return { initial: {}, animate: {}, transition: { duration: 0 } };
  return {
    initial: { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, delay: index * baseDelay, ease: easeOutQuint },
  };
}

function KpiCell({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted-foreground)]">
        {label}
      </div>
      <div
        className="mt-1 truncate font-mono text-[1.3rem] font-bold tabular-nums"
        style={{ color }}
        title={value}
      >
        {value}
      </div>
      <div className="mt-0.5 truncate text-[10px] text-[color:var(--muted-foreground)]">{sub}</div>
    </div>
  );
}

function ChartCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="neu-card-static !rounded-[16px] p-4">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-[9px] border text-[color:var(--foreground)]" style={{ borderColor: HAIRLINE }}>
          {icon}
        </span>
        <h3 className="text-[0.88rem] font-semibold text-[color:var(--foreground)]">{title}</h3>
      </div>
      {children}
    </div>
  );
}

/** 状态环图：四分组全量覆盖（含「其他」），中心显示总数 */
function StatusDonut({
  segments,
  total,
}: {
  segments: Array<{ label: string; color: string; count: number }>;
  total: number;
}) {
  const R = 50;
  const C = 2 * Math.PI * R;
  // 无变异推导弧段：frac + 前缀和 offset（React Compiler lint 禁 render 期重赋值）
  const arcs = segments
    .map((g) => ({ ...g, frac: total > 0 ? g.count / total : 0 }))
    .map((g, i, arr) => ({ ...g, offset: arr.slice(0, i).reduce((s, x) => s + x.frac, 0) }));
  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0">
        <svg width="128" height="128" viewBox="0 0 120 120" role="img" aria-label="状态分布环图">
          <circle cx="60" cy="60" r={R} fill="none" stroke={BAR_TRACK} strokeWidth="18" />
          {arcs.map((a) => {
            const dash = a.frac * C;
            return (
              <circle
                key={a.label}
                cx="60"
                cy="60"
                r={R}
                fill="none"
                stroke={a.color}
                strokeWidth="18"
                strokeDasharray={`${dash} ${C - dash}`}
                strokeDashoffset={-a.offset * C}
                transform="rotate(-90 60 60)"
              >
                <title>{`${a.label} ${a.count} 条`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-mono text-[1.3rem] font-bold tabular-nums text-[color:var(--foreground)]">{total}</span>
          <span className="text-[9px] uppercase tracking-[0.12em] text-[color:var(--muted-foreground)]">条记录</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {segments.map((g) => {
          const pct = total > 0 ? Math.round((g.count / total) * 100) : 0;
          return (
            <div key={g.label} className="flex items-center gap-2 text-[11px]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
              <span className="text-[color:var(--foreground)]">{g.label}</span>
              <span className="ml-auto font-mono font-bold tabular-nums" style={{ color: g.color }}>
                {g.count}
              </span>
              <span className="w-9 text-right font-mono tabular-nums text-[color:var(--muted-foreground)]">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BarRow({
  label,
  count,
  total,
  color,
  index,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
  index: number;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const pctLabel = total > 0 ? Math.round(pct) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-[96px] shrink-0 truncate text-[11px] text-[color:var(--foreground)]" title={label}>
        {label}
      </span>
      <div className="h-[14px] min-w-0 flex-1 overflow-hidden rounded-[4px]" style={{ backgroundColor: BAR_TRACK }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, delay: index * 0.06, ease: easeOutQuint }}
          className="h-full rounded-[4px]"
          style={{ backgroundColor: color, minWidth: pct > 0 ? 4 : 0 }}
        />
      </div>
      <span className="w-11 shrink-0 text-right font-mono text-[11px] font-bold tabular-nums" style={{ color }}>
        {count}
      </span>
      <span className="w-9 shrink-0 text-right font-mono text-[10px] tabular-nums text-[color:var(--muted-foreground)]">
        {pctLabel}%
      </span>
    </div>
  );
}

function AiListSection({
  icon,
  title,
  color,
  bg,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  color: string;
  bg: string;
  items: string[];
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-[12px] p-3.5" style={{ backgroundColor: bg }}>
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px]"
          style={{ color, backgroundColor: 'oklch(1 0 0 / 0.6)' }}
        >
          {icon}
        </span>
        <span className="text-[11px] font-bold tracking-[0.06em]" style={{ color }}>
          {title}
        </span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-[color:var(--muted-foreground)]">
          {items.length} 项
        </span>
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="mt-[2px] shrink-0 font-mono text-[10px] font-bold tabular-nums" style={{ color }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="text-[0.82rem] leading-[1.65] text-[color:var(--foreground)]">{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnalysisResultModal({
  keyword,
  items,
  aiResult,
  onClose,
}: {
  keyword: string;
  items: ProcurementRoundItem[];
  aiResult: AiAnalysisResult | null;
  onClose: () => void;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const [showDetail, setShowDetail] = useState(false);
  const generatedAt = useState(() => new Date().toLocaleString('zh-CN'))[0];

  const summary = useMemo(() => buildLedgerAnalysisSummary(items), [items]);

  const statusSegments = useMemo(() => {
    const groups: Array<{ label: string; color: string; count: number }> = [];
    (Object.keys(LEDGER_GROUP_LABEL) as LedgerStatusGroup[]).forEach((g) => {
      const count =
        g === 'awarded' ? summary.awardedCount
        : g === 'pending' ? summary.pendingCount
        : g === 'abnormal' ? summary.abnormalCount
        : summary.otherCount;
      if (count > 0) groups.push({ label: LEDGER_GROUP_LABEL[g], color: LEDGER_GROUP_COLOR[g], count });
    });
    return groups;
  }, [summary]);

  const methodEntries = useMemo(
    () => Object.entries(summary.methodCounts).sort((a, b) => b[1] - a[1]),
    [summary],
  );
  const deptEntries = useMemo(
    () => Object.entries(summary.deptCounts).sort((a, b) => b[1] - a[1]),
    [summary],
  );

  const savingsColor = summary.savings < 0 ? CORAL : GOLD;

  const exportReport = () => {
    if (!aiResult) return;
    const lines = [
      '采购台账 AI 综合分析报告',
      `关键词：${keyword || '（空）'} · 纳入 ${summary.totalCount} 条`,
      summary.periodStart ? `统计区间：${summary.periodStart} ~ ${summary.periodEnd}` : null,
      `生成时间：${generatedAt}`,
      '',
      '── 核心指标 ──',
      `预算总额：${formatWan(summary.totalBudget, { digits: 2 })}（覆盖 ${summary.totalCount} 条）`,
      `成交总额：${formatWan(summary.totalAward, { digits: 2 })}（已成交 ${summary.awardedCount} 笔）`,
      `节约资金：${formatWan(summary.savings, { digits: 2 })}（节资率 ${summary.savingsRate}%）`,
      '',
      '── 状态分布 ──',
      ...statusSegments.map(
        (g) => `${g.label}：${g.count} 条（${summary.totalCount > 0 ? Math.round((g.count / summary.totalCount) * 100) : 0}%）`,
      ),
      '',
      '── 采购方式 ──',
      ...methodEntries.map(([m, c]) => `${m}：${c} 条`),
      '',
      '── 部门分布 ──',
      ...deptEntries.map(([d, c]) => `${d}：${c} 条`),
      '',
      '── AI 分析 ──',
      `[综述] ${aiResult.overview}`,
      ...aiResult.highlights.map((t, i) => `[亮点] ${i + 1}. ${t}`),
      ...aiResult.concerns.map((t, i) => `[关注] ${i + 1}. ${t}`),
      ...aiResult.suggestions.map((t, i) => `[建议] ${i + 1}. ${t}`),
      '',
      '── 参与明细 ──',
      ...items.map(
        (i, idx) =>
          `${idx + 1}. ${i.projectName} | ${i.procurementMethod} | ${i.departmentName || '未填部门'} | 预算 ${formatWan(
            i.controlAmount ?? i.budgetAmount,
            { digits: 2 },
          )} | 成交 ${formatWan(i.awardAmount, { digits: 2 })} | ${i.resultStatusLabel}`,
      ),
    ].filter((l): l is string => l !== null);
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `采购分析报告_${keyword || '全部'}_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="2xl"
      title={
        <span className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-[rgba(96,139,239,0.25)] bg-[rgba(96,139,239,0.1)] text-[rgba(96,139,239,1)]">
            <Sparkles size={20} strokeWidth={1.9} />
          </span>
          AI 综合分析报告
        </span>
      }
      description={
        <>
          关键词「{keyword || '（空）'}」 · {items.length} 条记录
          {summary.periodStart ? ` · ${summary.periodStart} ~ ${summary.periodEnd}` : ''} · 生成于 {generatedAt}
        </>
      }
      footer={
        <div className="flex flex-1 flex-wrap items-center justify-between gap-3">
          <div className="text-[11px] text-[color:var(--muted-foreground)]">
            数据范围：<span className="font-mono tabular-nums">{items.length}</span> 条 ·「{keyword || '（空）'}」
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={exportReport}
              disabled={!aiResult}
              className="neu-btn-primary is-success !h-9 !text-[13px] disabled:opacity-50"
            >
              <FileText size={14} />
              导出报告
            </button>
            <button onClick={onClose} className="neu-btn-soft !h-9 !text-[13px]">
              关闭
            </button>
          </div>
        </div>
      }
    >
      {/* KPI 报表带：hairline 分隔 + 副注口径 */}
      <motion.div
        {...fadeIn(0, reducedMotion)}
        className="grid grid-cols-2 divide-x rounded-[14px] border bg-[linear-gradient(145deg,rgba(247,250,255,0.86),rgba(255,255,255,0.72))] lg:grid-cols-4"
        style={{ borderColor: HAIRLINE }}
      >
        <KpiCell
          label="预算总额"
          value={formatWan(summary.totalBudget, { digits: 2 })}
          sub={`覆盖 ${summary.totalCount} 条记录`}
          color={BLUE}
        />
        <KpiCell
          label="成交总额"
          value={formatWan(summary.totalAward, { digits: 2 })}
          sub={`已成交 ${summary.awardedCount} 笔`}
          color={TEAL}
        />
        <KpiCell
          label="节约资金"
          value={formatWan(summary.savings, { digits: 2 })}
          sub={summary.savings < 0 ? '成交超出预算' : '预算 − 成交'}
          color={savingsColor}
        />
        <KpiCell label="节资率" value={`${summary.savingsRate}%`} sub="节约 ÷ 预算总额" color={INDIGO} />
      </motion.div>

      {/* 分布图：状态环图 + 采购方式 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <motion.div {...fadeIn(1, reducedMotion)}>
          <ChartCard icon={<PieChart size={14} style={{ color: BLUE }} />} title="状态分布">
            <StatusDonut segments={statusSegments} total={summary.totalCount} />
          </ChartCard>
        </motion.div>
        <motion.div {...fadeIn(2, reducedMotion)}>
          <ChartCard icon={<Activity size={14} style={{ color: TEAL }} />} title="采购方式">
            <div className="space-y-2.5">
              {methodEntries.map(([method, count], i) => (
                <BarRow
                  key={method}
                  label={method}
                  count={count}
                  total={summary.totalCount}
                  color={BAR_COLORS[i % BAR_COLORS.length]}
                  index={i}
                />
              ))}
            </div>
          </ChartCard>
        </motion.div>
      </div>

      {/* 部门分布：条目多时收敛为 chips，避免长条图拉爆高度 */}
      <motion.div {...fadeIn(3, reducedMotion)}>
        <ChartCard icon={<Building2 size={14} style={{ color: INDIGO }} />} title="部门分布">
          {deptEntries.length <= 8 ? (
            <div className="space-y-2.5">
              {deptEntries.map(([dept, count], i) => (
                <BarRow key={dept} label={dept} count={count} total={summary.totalCount} color={INDIGO} index={i} />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {deptEntries.map(([dept, count]) => (
                <span
                  key={dept}
                  className="rounded-full border px-2.5 py-1 text-[11px]"
                  style={{ borderColor: HAIRLINE, color: 'var(--foreground)' }}
                >
                  {dept}{' '}
                  <span className="font-mono font-bold tabular-nums text-[rgba(119,129,219,1)]">{count}</span>
                </span>
              ))}
            </div>
          )}
        </ChartCard>
      </motion.div>

      {/* AI 分析区：骨架屏加载态 + 编号条目 + 参考标注 */}
      <motion.div
        {...fadeIn(4, reducedMotion)}
        className="rounded-[16px] border border-[rgba(96,139,239,0.25)] bg-[linear-gradient(135deg,rgba(96,139,239,0.05),rgba(92,181,150,0.03))] p-5"
      >
        <div className="mb-4 flex items-center gap-2">
          <Sparkles size={17} style={{ color: BLUE }} />
          <h3 className="text-[0.95rem] font-bold text-[rgba(96,139,239,1)]">AI 智能分析</h3>
          <span
            className="ml-auto rounded-full border px-2 py-0.5 text-[10px] text-[color:var(--muted-foreground)]"
            style={{ borderColor: HAIRLINE }}
          >
            AI 生成 · 仅供参考
          </span>
        </div>

        {aiResult ? (
          <div className="space-y-3">
            <div className="rounded-[12px] border-l-[3px] border-l-[rgba(96,139,239,0.7)] bg-[oklch(1_0_0/0.4)] p-3.5">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
                综合概述
              </div>
              <p className="text-[0.85rem] leading-[1.75] text-[color:var(--foreground)]">{aiResult.overview}</p>
            </div>

            <AiListSection
              icon={<Target size={13} />}
              title="核心亮点"
              color={TEAL}
              bg="rgba(92,181,150,0.07)"
              items={aiResult.highlights}
            />
            <AiListSection
              icon={<AlertCircle size={13} />}
              title="待关注项"
              color={CORAL}
              bg="rgba(230,129,102,0.07)"
              items={aiResult.concerns}
            />
            <AiListSection
              icon={<Lightbulb size={13} />}
              title="建议方向"
              color={GOLD}
              bg="rgba(234,188,110,0.08)"
              items={aiResult.suggestions}
            />
          </div>
        ) : (
          <div className="rounded-[12px] bg-[oklch(1_0_0/0.4)] p-3.5">
            <div className="flex items-center gap-2 text-[11px] text-[color:var(--muted-foreground)]">
              <Loader2 size={13} className="animate-spin" />
              AI 正在分析 {items.length} 条记录，统计图已就绪…
            </div>
            <div className="mt-3 animate-pulse space-y-2">
              <div className="h-3.5 w-11/12 rounded bg-[rgba(96,139,239,0.10)]" />
              <div className="h-3.5 w-4/5 rounded bg-[rgba(96,139,239,0.10)]" />
              <div className="h-3.5 w-2/3 rounded bg-[rgba(96,139,239,0.08)]" />
            </div>
          </div>
        )}
      </motion.div>

      {/* 参与分析明细：核对报告的数据范围（默认折叠） */}
      <motion.div
        {...fadeIn(5, reducedMotion)}
        className="overflow-hidden rounded-[16px] border"
        style={{ borderColor: HAIRLINE }}
      >
        <button
          onClick={() => setShowDetail((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-[oklch(1_0_0/0.5)]"
          aria-expanded={showDetail}
        >
          <span className="flex items-center gap-2 text-[0.85rem] font-semibold text-[color:var(--foreground)]">
            <List size={15} className="text-[color:var(--muted-foreground)]" />
            参与分析明细
            <span className="font-mono text-[11px] font-normal tabular-nums text-[color:var(--muted-foreground)]">
              {items.length} 条
            </span>
          </span>
          <ChevronDown
            size={15}
            className={`text-[color:var(--muted-foreground)] transition-transform ${showDetail ? 'rotate-180' : ''}`}
          />
        </button>
        {showDetail && (
          <div className="max-h-[260px] overflow-auto border-t" style={{ borderColor: HAIRLINE }}>
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="sticky top-0 bg-[var(--background)] text-[10px] uppercase tracking-[0.06em] text-[color:var(--muted-foreground)]">
                  <th className="px-3 py-2 text-left font-semibold">#</th>
                  <th className="px-3 py-2 text-left font-semibold">项目名称</th>
                  <th className="px-3 py-2 text-left font-semibold">采购方式</th>
                  <th className="px-3 py-2 text-left font-semibold">部门</th>
                  <th className="px-3 py-2 text-right font-semibold">预算</th>
                  <th className="px-3 py-2 text-right font-semibold">成交</th>
                  <th className="px-3 py-2 text-left font-semibold">状态</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i, idx) => (
                  <tr key={i.id} className="border-t" style={{ borderColor: HAIRLINE }}>
                    <td className="px-3 py-2 font-mono text-[10px] tabular-nums text-[color:var(--muted-foreground)]">
                      {String(idx + 1).padStart(2, '0')}
                    </td>
                    <td className="max-w-[240px] truncate px-3 py-2 text-[11.5px] text-[color:var(--foreground)]" title={i.projectName}>
                      {i.projectName}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-[11px] text-[color:var(--muted-foreground)]">
                      {i.procurementMethod}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-[11px] text-[color:var(--muted-foreground)]">
                      {i.departmentName || '未填部门'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-[11px] tabular-nums">
                      {formatWan(i.controlAmount ?? i.budgetAmount, { digits: 2 })}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-[11px] tabular-nums text-[rgba(92,181,150,1)]">
                      {formatWan(i.awardAmount, { digits: 2 })}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-[11px] text-[color:var(--muted-foreground)]">
                      {i.resultStatusLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </Modal>
  );
}
