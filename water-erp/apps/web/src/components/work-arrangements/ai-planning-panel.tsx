'use client';

import {
  Sparkles,
  RefreshCw,
  History,
  CalendarClock,
  AlertTriangle,
  Target,
  Lightbulb,
} from 'lucide-react';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';
import { ProjectBriefCard } from '@/components/work-arrangements/project-brief-card';

function formatTimeSlot(raw: string): string {
  if (!raw) return '--:--';
  const trimmed = raw.trim();
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) return trimmed.slice(0, 5);
  const isoMatch = trimmed.match(/T(\d{2}):(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}:${isoMatch[2]}`;
  return trimmed;
}

interface AiPlanningPanelProps {
  dailyPlan: WorkArrangementDailyPlan | null;
  refreshingPlan: boolean;
  showProjectBrief?: boolean;
  onRefreshPlan: () => void;
  onSelectTimeBlock: (taskIds: string[]) => void;
  onShowHistory: () => void;
}

export function AiPlanningPanel({
  dailyPlan,
  refreshingPlan,
  showProjectBrief = false,
  onRefreshPlan,
  onSelectTimeBlock,
  onShowHistory,
}: AiPlanningPanelProps) {
  return (
    <section className="flex flex-col">
      {/* 标题行 */}
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-bold text-[#18243a]">AI 辅助</p>
        <div className="flex items-center gap-1.5">
          <button
            type="button" onClick={onRefreshPlan} disabled={refreshingPlan}
            className="neu-btn-xs"
          >
            <RefreshCw size={12} className={refreshingPlan ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">AI 安排</span>
          </button>
          <button type="button" onClick={onShowHistory} className="neu-btn-xs">
            <History size={12} />
            <span className="hidden sm:inline">历史</span>
          </button>
        </div>
      </div>

      {refreshingPlan ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="neu-icon-well flex h-10 w-10 items-center justify-center rounded-xl">
            <Sparkles size={18} className="animate-pulse text-[color:var(--accent)]" />
          </div>
          <span className="text-center text-sm text-[color:var(--muted-foreground)]">
            正在分析你的待办事项...
          </span>
        </div>
      ) : dailyPlan ? (
        <>
          {/* ───────────────────────────────────────────── */}
          {/* Section 1: AI 今日排程（丰富版）              */}
          {/* ───────────────────────────────────────────── */}

          {/* 概览文本 */}
          <div className="mt-4 rounded-[16px] bg-[var(--accent-soft)]/8 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-[color:var(--accent)]">
              <Sparkles size={13} />
              AI 今日排程
            </p>
            <p className="mt-2.5 text-[14px] leading-relaxed text-[color:var(--foreground)]">
              {dailyPlan.overview}
            </p>

            {/* 统计数据条 */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {dailyPlan.focusItems && dailyPlan.focusItems.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(96,139,239,0.1)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--accent)]">
                  <Target size={10} />
                  {dailyPlan.focusItems.length} 个重点事项
                </span>
              )}
              {dailyPlan.riskAlerts && dailyPlan.riskAlerts.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(245,166,35,0.1)] px-2.5 py-1 text-[11px] font-semibold text-[#d97706]">
                  <AlertTriangle size={10} />
                  {dailyPlan.riskAlerts.length} 个风险提醒
                </span>
              )}
            </div>
          </div>

          {/* 重点事项卡片 */}
          {dailyPlan.focusItems && dailyPlan.focusItems.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--accent)]">
                <Target size={12} />
                重点事项
              </p>
              {dailyPlan.focusItems.map((item, idx) => (
                <div
                  key={item.id || idx}
                  className="neu-surface-subtle flex items-start gap-3 rounded-[12px] px-3.5 py-2.5"
                >
                  <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[rgba(96,139,239,0.15)] text-[10px] font-bold tabular-nums text-[color:var(--accent)]">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold leading-snug text-[#18243a]">
                      {item.title}
                    </p>
                    {item.reason && (
                      <p className="mt-0.5 text-[11px] leading-relaxed text-[#5a6d8a]">
                        {item.reason}
                      </p>
                    )}
                  </div>
                  <span className="mt-0.5 flex-shrink-0 rounded-md bg-[rgba(96,139,239,0.08)] px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[color:var(--accent)]">
                    P{item.priorityRank || idx + 1}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 风险提醒 */}
          {dailyPlan.riskSummary && (
            <div className="mt-3 rounded-[12px] border border-[rgba(245,166,35,0.2)] bg-[rgba(245,166,35,0.04)] px-3.5 py-2.5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[#d97706]">
                <AlertTriangle size={11} />
                风险提醒
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[#92400e]">
                {dailyPlan.riskSummary}
              </p>
              {dailyPlan.riskAlerts && dailyPlan.riskAlerts.length > 0 && (
                <div className="mt-2 space-y-1">
                  {dailyPlan.riskAlerts.slice(0, 3).map((alert, idx) => (
                    <div key={idx} className="flex items-start gap-1.5 text-[11px] text-[#92400e]">
                      <span className="mt-0.5 h-1 w-1 flex-shrink-0 rounded-full bg-[#f5a623]" />
                      {alert}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ───────────────────────────────────────────── */}
          {/* Section 2: 时间块建议                         */}
          {/* ───────────────────────────────────────────── */}
          {dailyPlan.timeBlocks && dailyPlan.timeBlocks.length > 0 ? (
            <>
              <hr className="wb-section-rule" />
              <p className="text-sm font-semibold tracking-wide uppercase text-[color:var(--muted-foreground)]">
                <CalendarClock size={14} className="mr-1.5 inline-block" />
                时间块建议
              </p>
              <div className="mt-3 grid gap-3 xl:grid-cols-2">
                {dailyPlan.timeBlocks.map((block, i) => (
                  <button
                    key={`tb-${i}-${block.label}`}
                    type="button"
                    onClick={() => onSelectTimeBlock(block.taskIds ?? [])}
                    className="wb-timeblock-card"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-[color:var(--foreground)]">
                        {block.label}
                      </span>
                      <span className="text-xs tabular-nums tracking-tight text-[color:var(--muted-foreground)]">
                        {formatTimeSlot(block.start)} – {formatTimeSlot(block.end)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                      {block.focus}
                    </p>
                    <span className="mt-2 block text-[11px] font-medium text-[color:var(--accent)]">
                      {block.taskIds?.length ?? 0} 项关联
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <hr className="wb-section-rule" />
              <div
                className="neu-content-block text-sm text-[color:var(--muted-foreground)]"
                style={{ '--block-accent': 'var(--accent)' } as React.CSSProperties}
              >
                暂无时间块建议，可用于整理资料、补记录或完成复盘。
              </div>
            </>
          )}

          {/* ───────────────────────────────────────────── */}
          {/* Section 3: 项目简报                           */}
          {/* ───────────────────────────────────────────── */}
          {showProjectBrief && dailyPlan ? (
            <div className="mt-4">
              <ProjectBriefCard dailyPlan={dailyPlan} />
            </div>
          ) : null}
        </>
      ) : (
        <div className="py-8 text-center text-sm text-[color:var(--muted-foreground)]">
          <Lightbulb size={20} className="mx-auto mb-2 opacity-30" />
          点击「AI 安排」让 AI 分析任务和通知，生成今日排程
        </div>
      )}
    </section>
  );
}
