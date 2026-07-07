'use client';

import { RefreshCw, History } from 'lucide-react';
import { WorkbenchPlanningPanel } from '@/components/work-arrangements/workbench-planning-panel';
import { ProjectBriefCard } from '@/components/work-arrangements/project-brief-card';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';

export function AiAssistPanel({ dailyPlan, refreshingPlan, isChairman, showProjectBrief, onSelectTimeBlock, onRefreshPlan, onShowHistory }: {
  dailyPlan: WorkArrangementDailyPlan|null; refreshingPlan: boolean; isChairman: boolean; showProjectBrief: boolean;
  onSelectTimeBlock:(ids:string[])=>void; onRefreshPlan:()=>void; onShowHistory:()=>void;
}) {
  return (
    <section className="wb-panel">
      <div className="wb-panel-header">
        <span className="text-[15px] font-bold text-[#18243a]">AI 辅助</span>
        {!isChairman ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={onRefreshPlan} disabled={refreshingPlan} className="neu-btn-xs"><RefreshCw size={12} className={refreshingPlan?'animate-spin':''}/><span className="hidden sm:inline">AI 安排</span></button>
            <button type="button" onClick={onShowHistory} className="neu-btn-xs"><History size={12}/><span className="hidden sm:inline">历史</span></button>
          </div>
        ) : null}
      </div>
      <div className="wb-panel-body">
        <WorkbenchPlanningPanel dailyPlan={dailyPlan} refreshingPlan={refreshingPlan} onSelectTimeBlock={onSelectTimeBlock} onRefreshPlan={onRefreshPlan} onShowHistory={onShowHistory} showAiScheduling={!isChairman} isChairman={isChairman}/>
        {!isChairman && showProjectBrief && dailyPlan ? <div className="mt-4"><ProjectBriefCard dailyPlan={dailyPlan}/></div> : null}
      </div>
    </section>
  );
}
