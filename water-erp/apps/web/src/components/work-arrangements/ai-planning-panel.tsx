'use client';

import {
  Sparkles,
  RefreshCw,
  CalendarClock,
  AlertTriangle,
  Target,
  Lightbulb,
} from 'lucide-react';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';

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
  onRefreshPlan: () => void;
  onSelectTimeBlock: (taskIds: string[]) => void;
  /** 当前是否有进行中的任务（待处理/进行中/受阻）；无任务时隐藏"风险提醒" */
  hasActiveTasks?: boolean;
}


export function AiPlanningPanel({
  dailyPlan,
  refreshingPlan,
  onRefreshPlan,
  onSelectTimeBlock,
  hasActiveTasks = true,
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
        </div>
      </div>

      {refreshingPlan ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <div className="neu-icon-well flex h-10 w-10 items-center justify-center rounded-xl">
            <Sparkles size={18} className="animate-pulse text-[color:var(--accent)]" />
          </div>
          <span className="text-center text-sm text-[color:var(--muted-foreground)]">
            正在综合任务和通知，规划今日最优排程...
          </span>
        </div>
      ) : dailyPlan ? (
        <>
          {/* Section 1: AI 今日排程（概览文本） */}
          <div className="mt-4 space-y-3">
            {/* 概览文本 */}
            <div className="rounded-[16px] bg-[var(--accent-soft)]/6 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-[color:var(--accent)]">
                <Sparkles size={13} />
                AI 今日排程
              </p>
              <p className="mt-2.5 text-[14px] leading-relaxed text-[color:var(--foreground)]">
                {dailyPlan.overview}
              </p>
            </div>

            {/* 重点事项卡片 */}
            {dailyPlan.focusItems && dailyPlan.focusItems.length > 0 && (
              <div className="space-y-2">
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

            {/* 风险提醒 — 无进行中任务时不显示（此时无风险可言） */}
            {hasActiveTasks && dailyPlan.riskSummary && (
              <div className="rounded-[12px] border border-[rgba(245,166,35,0.2)] bg-[rgba(245,166,35,0.04)] px-3.5 py-2.5">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[#d97706]">
                  <AlertTriangle size={11} />
                  风险提醒
                </p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-[#92400e]">
                  {dailyPlan.riskSummary}
                </p>
                {dailyPlan.riskAlerts && dailyPlan.riskAlerts.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {dailyPlan.riskAlerts.slice(0, 3).map((alert: any, idx) => (
                      <div key={idx} className="flex items-start gap-1.5 text-[11px] text-[#92400e]">
                        <span className="mt-0.5 h-1 w-1 flex-shrink-0 rounded-full bg-[#f5a623]" />
                        {typeof alert === 'string' ? alert : alert.title || alert.description || JSON.stringify(alert)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section 2: 时间线排程 */}
          {dailyPlan.timeBlocks && dailyPlan.timeBlocks.length > 0 ? (
            <>
              <hr className="wb-section-rule" />
              <p className="text-sm font-semibold tracking-wide uppercase text-[color:var(--muted-foreground)]">
                <CalendarClock size={14} className="mr-1.5 inline-block" />
                时间线排程
              </p>

              <div className="mt-3">
                <div className="relative pl-7">
                  {/* 竖线 */}
                  <div
                    className="absolute bottom-0 left-[11px] top-1.5 w-px"
                    style={{
                      background:
                        'linear-gradient(180deg, var(--accent) 0%, var(--accent-soft) 100%)',
                    }}
                  />

                  <div className="flex flex-col gap-4">
                    {dailyPlan.timeBlocks.map((block, i) => {
                      const start = formatTimeSlot(block.start);
                      const end = formatTimeSlot(block.end);
                      const taskCount = block.taskIds?.length ?? 0;
                      return (
                        <button
                          key={`tb-${i}-${block.label}`}
                          type="button"
                          onClick={() => onSelectTimeBlock(block.taskIds ?? [])}
                          className="relative text-left"
                        >
                          {/* 时间节点 */}
                          <div className="absolute -left-[21px] top-1 flex flex-col items-center">
                            <div
                              className={`h-[9px] w-[9px] rounded-full border-2 ${
                                i === 0
                                  ? 'border-[color:var(--accent)] bg-[color:var(--accent)]'
                                  : 'border-[color:var(--accent)] bg-white'
                              }`}
                            />
                          </div>

                          {/* 时间标签 */}
                          <div className="mb-2 flex items-center gap-2">
                            <span className="rounded-full bg-[rgba(96,139,239,0.12)] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[color:var(--accent)]">
                              {start}
                            </span>
                            <span className="text-[11px] text-[color:var(--muted-foreground)]">
                              —
                            </span>
                            <span className="rounded-full bg-[rgba(96,139,239,0.08)] px-2 py-0.5 text-[11px] font-bold tabular-nums text-[color:var(--accent)]">
                              {end}
                            </span>
                          </div>

                          {/* 内容卡片 */}
                          <div className="rounded-[14px] bg-[var(--accent-soft)]/8 p-3.5 transition hover:bg-[var(--accent-soft)]/14">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[13px] font-bold text-[#18243a]">
                                {block.label}
                              </span>
                              {taskCount > 0 && (
                                <span className="flex-shrink-0 rounded-md bg-[rgba(96,139,239,0.12)] px-2 py-0.5 text-[10px] font-bold tabular-nums text-[color:var(--accent)]">
                                  {taskCount} 项任务
                                </span>
                              )}
                            </div>
                            <p className="mt-1.5 text-[12px] leading-relaxed text-[#5a6d8a]">
                              {block.focus}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <hr className="wb-section-rule" />
              <div
                className="neu-content-block py-4 text-center text-sm text-[color:var(--muted-foreground)]"
                style={{ '--block-accent': 'var(--accent)' } as React.CSSProperties}
              >
                暂无时间块建议，点击「AI 安排」生成排程
              </div>
            </>
          )}
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
