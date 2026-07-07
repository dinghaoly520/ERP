import { CalendarClock, Lightbulb, Sparkles, RefreshCw, History } from 'lucide-react';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';

export function WorkbenchPlanningPanel({
  dailyPlan, refreshingPlan, onSelectTimeBlock, onRefreshPlan, onShowHistory,
  showAiScheduling = true, isChairman = false,
}: {
  dailyPlan: WorkArrangementDailyPlan | null; refreshingPlan: boolean;
  onSelectTimeBlock: (taskIds: string[]) => void; onRefreshPlan: () => void; onShowHistory: () => void;
  showAiScheduling?: boolean; isChairman?: boolean;
}) {
  return (
    <section className="flex flex-col">
      {showAiScheduling && (<>
        <p className="text-sm font-semibold tracking-wide uppercase text-[color:var(--muted-foreground)]"><Sparkles size={14} className="inline-block mr-1.5" />AI 今日排程</p>
        <div className="text-[15px] leading-relaxed text-[color:var(--foreground)] mt-2">{dailyPlan?.overview}</div>

        <hr className="wb-section-rule" />

        <p className="text-sm font-semibold tracking-wide uppercase text-[color:var(--muted-foreground)]"><CalendarClock size={14} className="inline-block mr-1.5" />时间块建议</p>
        <div className="grid gap-3 xl:grid-cols-2 mt-3">
            {dailyPlan?.timeBlocks.length ? dailyPlan.timeBlocks.map((block, i) => (
              <button key={`tb-${i}-${block.label}`} type="button" onClick={() => onSelectTimeBlock(block.taskIds ?? [])} className="wb-timeblock-card">
                <div className="flex items-center justify-between gap-3"><span className="text-sm font-semibold text-[color:var(--foreground)]">{block.label}</span><span className="text-xs tabular-nums tracking-tight text-[color:var(--muted-foreground)]">{block.start} - {block.end}</span></div>
                <p className="mt-1.5 text-xs leading-relaxed text-[color:var(--muted-foreground)]">{block.focus}</p>
                <span className="block mt-2 text-[11px] font-medium text-[color:var(--accent)]">{block.taskIds?.length ?? 0} 项关联</span>
              </button>
            )) : <div className="neu-content-block text-sm text-[color:var(--muted-foreground)] xl:col-span-2" style={{ '--block-accent': 'var(--accent)' } as React.CSSProperties}>暂无时间块建议，可用于整理资料、补记录或完成复盘。</div>}
          </div>
      </>)}

      <div className={showAiScheduling ? 'mt-4' : ''}>
        <hr className="wb-section-rule" />
        {isChairman ? (<>
          <div className="mt-4 p-4 rounded-[16px] bg-[var(--accent-soft)]/15">
            <p className="text-sm font-semibold tracking-wide uppercase text-[color:var(--muted-foreground)]"><Lightbulb size={14} className="inline-block mr-1.5" />项目简报</p>
            <div className="mt-3">
            {dailyPlan?.completionAdvice ? (() => {
              const briefText = dailyPlan.completionAdvice;
              const sections: { title: string; body: string }[] = [];
              const firstBracket = briefText.indexOf('【');
              const preamble = firstBracket > 0 ? briefText.slice(0, firstBracket).trim() : '';
              if (firstBracket >= 0) {
                const parts = briefText.slice(firstBracket).split('【');
                for (const part of parts) {
                  const sepIdx = part.indexOf('】');
                  if (sepIdx > 0) { const t = part.slice(0, sepIdx).trim(); const c = part.slice(sepIdx + 1).trim(); if (t) sections.push({ title: t, body: c }); }
                }
              }
              return (<>
                {preamble && <p className="mt-3 text-sm leading-7 text-pretty text-[color:var(--foreground)]">{preamble}</p>}
                {sections.map((s, idx) => {
                  const items = s.body.match(/\d+\.「/g);
                  const subs = items && items.length > 1 ? s.body.split(/(?=\d+\.「)/).filter(Boolean).map(x => x.trim()) : [s.body];
                  return <div key={idx} className="mt-3"><h4 className="text-sm font-semibold text-[color:var(--foreground)]">【{s.title}】</h4>{subs.map((sub, si) => <p key={si} className="mt-1 text-justify text-sm leading-7 text-pretty text-[color:var(--foreground)]">{sub}</p>)}</div>;
                })}
              </>);
            })() : <div className="neu-icon-well rounded-[14px] mt-3 flex items-center justify-center px-3 py-4 text-sm text-[color:var(--muted-foreground)]">正在生成项目简报...</div>}
          </div>
          </div>
        </>) : dailyPlan?.completionAdvice ? (() => {
          const advText = dailyPlan.completionAdvice;
          if (!advText.includes('【')) return (
            <div className="mt-4 p-4 rounded-[16px] bg-[var(--accent-soft)]/15">
              <p className="text-sm font-semibold tracking-wide uppercase text-[color:var(--muted-foreground)]"><Lightbulb size={14} className="inline-block mr-1.5" />具体建议</p>
              <p className="mt-3 text-justify text-sm leading-7 text-pretty text-[color:var(--foreground)]">{advText}</p>
            </div>
          );
          return (
            <div className="mt-4 p-4 rounded-[16px] bg-[var(--accent-soft)]/15">
              <p className="text-sm font-semibold tracking-wide uppercase text-[color:var(--muted-foreground)]"><Lightbulb size={14} className="inline-block mr-1.5" />具体建议</p>
              {preamble && <p className="mt-3 text-sm leading-7 text-pretty text-[color:var(--foreground)]">{preamble}</p>}
              {sections.map((s, idx) => {
                const items = s.body.match(/\d+\.「/g);
                const subs = items && items.length > 1 ? s.body.split(/(?=\d+\.「)/).filter(Boolean).map(x => x.trim()) : [s.body];
                return <div key={idx} className="mt-3"><h4 className="text-sm font-semibold text-[color:var(--foreground)]">【{s.title}】</h4>{subs.map((sub, si) => <p key={si} className="mt-1 text-justify text-sm leading-7 text-pretty text-[color:var(--foreground)]">{sub}</p>)}</div>;
              })}
            </div>
          );
        })() : null}
      </div>
    </section>
  );
}
