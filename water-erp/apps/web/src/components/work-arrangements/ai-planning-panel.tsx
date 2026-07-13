'use client';

import {
  Sparkles,
  RefreshCw,
  History,
  Lightbulb,
  CalendarClock,
} from 'lucide-react';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';
import { ProjectBriefCard } from '@/components/work-arrangements/project-brief-card';

/** Normalize a time-slot string into clean HH:MM display. */
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
        <p className="text-sm font-semibold tracking-wide uppercase text-[color:var(--muted-foreground)]">
          <Sparkles size={14} className="mr-1.5 inline-block" />
          AI 辅助
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onRefreshPlan}
            disabled={refreshingPlan}
            className="neu-btn-xs"
          >
            <RefreshCw
              size={12}
              className={refreshingPlan ? 'animate-spin' : ''}
            />
            <span className="hidden sm:inline">AI 安排</span>
          </button>
          <button
            type="button"
            onClick={onShowHistory}
            className="neu-btn-xs"
          >
            <History size={12} />
            <span className="hidden sm:inline">历史</span>
          </button>
        </div>
      </div>


      {refreshingPlan ? (
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="neu-icon-well flex h-10 w-10 items-center justify-center rounded-xl">
            <Sparkles
              size={18}
              className="animate-pulse text-[color:var(--accent)]"
            />
          </div>
          <span className="text-center text-sm text-[color:var(--muted-foreground)]">
            正在分析你的待办事项...
          </span>
        </div>
      ) : (
        <>
          {/* Section 1: AI 今日排程概览 */}
          {dailyPlan?.overview ? (
            <>
              <p className="mt-3 text-sm font-semibold tracking-wide uppercase text-[color:var(--muted-foreground)]">
                <Sparkles size={14} className="mr-1.5 inline-block" />
                AI 今日排程
              </p>
              <p className="mt-2 text-[15px] leading-relaxed text-[color:var(--foreground)]">
                {dailyPlan.overview}
              </p>
            </>
          ) : null}

          {/* Section 2: 时间块建议 */}
          {dailyPlan?.timeBlocks && dailyPlan.timeBlocks.length > 0 ? (
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
          ) : dailyPlan ? (
            <>
              <hr className="wb-section-rule" />
              <div
                className="neu-content-block text-sm text-[color:var(--muted-foreground)] xl:col-span-2"
                style={{ '--block-accent': 'var(--accent)' } as React.CSSProperties}
              >
                暂无时间块建议，可用于整理资料、补记录或完成复盘。
              </div>
            </>
          ) : null}

          {/* Section 3: 具体建议 */}
          {dailyPlan?.completionAdvice ? (
            (() => {
              const advText = dailyPlan.completionAdvice;
              const firstBracket = advText.indexOf('【');
              const preamble =
                firstBracket > 0 ? advText.slice(0, firstBracket).trim() : '';

              if (!advText.includes('【')) {
                return (
                  <>
                    <hr className="wb-section-rule" />
                    <div className="mt-4 rounded-[16px] bg-[var(--accent-soft)]/15 p-4">
                      <p className="text-sm font-semibold tracking-wide uppercase text-[color:var(--muted-foreground)]">
                        <Lightbulb size={14} className="mr-1.5 inline-block" />
                        具体建议
                      </p>
                      <p className="mt-3 text-justify text-sm leading-7 text-pretty text-[color:var(--foreground)]">
                        {advText}
                      </p>
                    </div>
                  </>
                );
              }

              const sections: { title: string; body: string }[] = [];
              const parts = advText.slice(firstBracket).split('【');
              for (const part of parts) {
                const sepIdx = part.indexOf('】');
                if (sepIdx > 0) {
                  const t = part.slice(0, sepIdx).trim();
                  const c = part.slice(sepIdx + 1).trim();
                  if (t) sections.push({ title: t, body: c });
                }
              }

              return (
                <>
                  <hr className="wb-section-rule" />
                  <div className="mt-4 rounded-[16px] bg-[var(--accent-soft)]/15 p-4">
                    <p className="text-sm font-semibold tracking-wide uppercase text-[color:var(--muted-foreground)]">
                      <Lightbulb size={14} className="mr-1.5 inline-block" />
                      具体建议
                    </p>
                    {preamble && (
                      <p className="mt-3 text-sm leading-7 text-pretty text-[color:var(--foreground)]">
                        {preamble}
                      </p>
                    )}
                    {sections.map((s, idx) => {
                      const items = s.body.match(/\d+\.「/g);
                      const subs =
                        items && items.length > 1
                          ? s.body
                              .split(/(?=\d+\.「)/)
                              .filter(Boolean)
                              .map((x) => x.trim())
                          : [s.body];
                      return (
                        <div key={idx} className="mt-3">
                          <h4 className="text-sm font-semibold text-[color:var(--foreground)]">
                            【{s.title}】
                          </h4>
                          {subs.map((sub, si) => (
                            <p
                              key={si}
                              className="mt-1 text-justify text-sm leading-7 text-pretty text-[color:var(--foreground)]"
                            >
                              {sub}
                            </p>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()
          ) : null}

          {/* Section 4: 项目简报 */}
          {showProjectBrief && dailyPlan ? (
            <div className="mt-4">
              <ProjectBriefCard dailyPlan={dailyPlan} />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
