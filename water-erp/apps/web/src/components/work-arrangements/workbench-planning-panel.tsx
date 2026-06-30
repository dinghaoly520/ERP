import {
  CalendarClock,
  Lightbulb,
  Sparkles,
  RefreshCw,
  History,
} from 'lucide-react';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';

export function WorkbenchPlanningPanel({
  dailyPlan,
  refreshingPlan,
  onSelectTimeBlock,
  onRefreshPlan,
  onShowHistory,
  showAiScheduling = true,
  isChairman = false,
}: {
  dailyPlan: WorkArrangementDailyPlan | null;
  refreshingPlan: boolean;
  onSelectTimeBlock: (taskIds: string[]) => void;
  onRefreshPlan: () => void;
  onShowHistory: () => void;
  showAiScheduling?: boolean;
  isChairman?: boolean;
}) {
  return (
    <section className="panel-surface panel-lens rounded-[24px] p-4">
      {showAiScheduling && (
        <>
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-[color:var(--accent)]">
                  <Sparkles size={13} aria-hidden="true" />
                  AI 今日排程
                </div>
                <div className="mt-3 text-base leading-7 text-pretty text-[color:var(--foreground)]">
                  {dailyPlan?.overview}
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onRefreshPlan}
                  disabled={refreshingPlan}
                  aria-label="刷新 AI 安排"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-violet-100 hover:text-violet-700 disabled:opacity-50"
                >
                  <RefreshCw size={12} className={refreshingPlan ? 'animate-spin' : ''} />
                  <span className="hidden sm:inline">AI 安排</span>
                </button>
                <button
                  type="button"
                  onClick={onShowHistory}
                  aria-label="查看历史记录"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-amber-100 hover:text-amber-700"
                >
                  <History size={12} />
                  <span className="hidden sm:inline">历史</span>
                </button>
              </div>
            </div>
          </div>

          {/* 时间块建议 */}
          <div className="mt-4 grid min-h-0 content-start gap-4 overflow-y-auto pr-1">
            <div className="rounded-[22px] border border-white/60 bg-white p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--foreground)]">
                <CalendarClock size={16} aria-hidden="true" />
                时间块建议
              </div>
              <div className="mt-3 grid gap-3 xl:grid-cols-2">
                {dailyPlan?.timeBlocks.length ? (
                  dailyPlan.timeBlocks.map((block) => (
                    <button
                      key={`${block.start}-${block.end}`}
                      type="button"
                      onClick={() => onSelectTimeBlock(block.taskIds)}
                      aria-label={`选择时间块：${block.label}`}
                      className="block w-full rounded-[18px] bg-white px-3 py-3 text-left transition hover:bg-gray-50"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-[color:var(--foreground)]">{block.label}</div>
                        <div className="text-xs tabular-nums text-[color:var(--muted-foreground)]">{block.start} - {block.end}</div>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-pretty text-[color:var(--muted-foreground)]">{block.focus}</p>
                      <div className="mt-2 text-xs text-[color:var(--accent)]">关联任务 {block.taskIds.length} 条</div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-[18px] bg-gray-50 px-3 py-3 text-sm text-[color:var(--muted-foreground)] xl:col-span-2">
                    暂无时间块建议，可用于整理资料、补记录或完成复盘。
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <div className={showAiScheduling ? 'mt-4' : ''}>
        {/* 董事长：卡片始终渲染（加载期间也有标题和占位文字） */}
        {isChairman ? (
          <>
            <div className="flex items-center gap-2 text-sm font-semibold text-[color:var(--foreground)]">
              <Lightbulb size={16} aria-hidden="true" />
              项目简报
            </div>
            <div className="mt-3 rounded-[22px] border border-amber-100/60 bg-gradient-to-br from-amber-50/50 to-white p-4">
            {dailyPlan?.completionAdvice ? (() => {
              const text = dailyPlan.completionAdvice;
              const sections: { title: string; body: string }[] = [];
              const firstBracket = text.indexOf('【');
              const preamble = firstBracket > 0 ? text.slice(0, firstBracket).trim() : '';

              if (firstBracket >= 0) {
                const parts = text.slice(firstBracket).split('【');
                for (const part of parts) {
                  const sepIdx = part.indexOf('】');
                  if (sepIdx > 0) {
                    const title = part.slice(0, sepIdx).trim();
                    const content = part.slice(sepIdx + 1).trim();
                    if (title) sections.push({ title, body: content });
                  }
                }
              }

              return (
                <>
                  {preamble && (
                    <p className="mt-3 text-sm leading-7 text-pretty text-[color:var(--foreground)]">
                      {preamble}
                    </p>
                  )}
                  {sections.map((section, index) => {
                    const body = section.body;
                    const items = body.match(/\d+\.「/g);
                    const subParagraphs = items && items.length > 1
                      ? body.split(/(?=\d+\.「)/).filter(Boolean).map(s => s.trim())
                      : [body];

                    return (
                      <div key={index} className="mt-3">
                        <h4 className="text-sm font-semibold text-amber-800">
                          【{section.title}】
                        </h4>
                        {subParagraphs.map((sub, si) => (
                          <p key={si} className="mt-1 text-justify text-sm leading-7 text-pretty text-[color:var(--foreground)]">
                            {sub}
                          </p>
                        ))}
                      </div>
                    );
                  })}
                </>
              );
            })() : (
              <p className="mt-3 text-sm text-[color:var(--muted-foreground)]">
                正在生成项目简报...
              </p>
            )}
          </div>
          </>
        ) : (
          /* 普通员工/管理员：有内容才渲染 */
          dailyPlan?.completionAdvice && (() => {
            const text = dailyPlan.completionAdvice;

            // 无【】标记 → 纯文本段落
            if (!text.includes('【')) {
              return (
                <div className="rounded-[22px] border border-amber-100/60 bg-gradient-to-br from-amber-50/50 to-white p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-amber-700">
                    <Lightbulb size={16} aria-hidden="true" />
                    具体建议
                  </div>
                  <p className="mt-3 text-justify text-sm leading-7 text-pretty text-[color:var(--foreground)]">
                    {text}
                  </p>
                </div>
              );
            }

            // 有【】标记 → 分段渲染
            const sections: { title: string; body: string }[] = [];
            const firstBracket = text.indexOf('【');
            const preamble = firstBracket > 0 ? text.slice(0, firstBracket).trim() : '';

            if (firstBracket >= 0) {
              const parts = text.slice(firstBracket).split('【');
              for (const part of parts) {
                const sepIdx = part.indexOf('】');
                if (sepIdx > 0) {
                  const title = part.slice(0, sepIdx).trim();
                  const content = part.slice(sepIdx + 1).trim();
                  if (title) sections.push({ title, body: content });
                }
              }
            }

            return (
              <div className="rounded-[22px] border border-amber-100/60 bg-gradient-to-br from-amber-50/50 to-white p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-amber-700">
                  <Lightbulb size={16} aria-hidden="true" />
                  具体建议
                </div>

                {preamble && (
                  <p className="mt-3 text-sm leading-7 text-pretty text-[color:var(--foreground)]">
                    {preamble}
                  </p>
                )}

                {sections.map((section, index) => {
                  const body = section.body;
                  const items = body.match(/\d+\.「/g);
                  const subParagraphs = items && items.length > 1
                    ? body.split(/(?=\d+\.「)/).filter(Boolean).map(s => s.trim())
                    : [body];

                  return (
                    <div key={index} className="mt-3">
                      <h4 className="text-sm font-semibold text-amber-800">
                        【{section.title}】
                      </h4>
                      {subParagraphs.map((sub, si) => (
                        <p key={si} className="mt-1 text-justify text-sm leading-7 text-pretty text-[color:var(--foreground)]">
                          {sub}
                        </p>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })()
        )}
      </div>
    </section>
  );
}