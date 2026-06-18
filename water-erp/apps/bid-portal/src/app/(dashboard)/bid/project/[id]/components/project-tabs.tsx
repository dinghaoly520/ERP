'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useBidProjectContext } from '@/contexts/bid-project-context';
import { STAGE_LABEL } from '@water-erp/shared';
import { Unlock, ListChecks, Shield, ClipboardCheck, MessageSquare, AlertCircle } from 'lucide-react';

interface TabDef {
  key: string;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  minStage: string[]; // 允许的阶段列表
  stageHint: string;  // 阶段不满足时的提示语
}

const TABS: TabDef[] = [
  {
    key: 'open',
    label: '开标大厅',
    icon: Unlock,
    minStage: ['OPENING', 'EVALUATING', 'ARCHIVED'],
    stageHint: '开标尚未开始。请等待项目进入开标阶段。',
  },
  {
    key: 'standard',
    label: '评分标准',
    icon: ListChecks,
    minStage: ['OPENING', 'EVALUATING', 'ARCHIVED'],
    stageHint: '评分标准尚未开放。请等待项目进入开标阶段。',
  },
  {
    key: 'supervise',
    label: '监督端',
    icon: Shield,
    minStage: ['OPENING', 'EVALUATING', 'ARCHIVED'],
    stageHint: '监督功能尚未开放。请等待项目进入开标阶段。',
  },
  {
    key: 'evaluate',
    label: '评标端',
    icon: ClipboardCheck,
    minStage: ['EVALUATING', 'ARCHIVED'],
    stageHint: '评标尚未开始。当前项目阶段：{stage}。请等待开标完成后进入评标阶段。',
  },
  {
    key: 'clarify',
    label: '澄清答疑',
    icon: MessageSquare,
    minStage: ['OPENING', 'EVALUATING', 'ARCHIVED'],
    stageHint: '澄清答疑尚未开放。请等待项目进入开标阶段。',
  },
];

/** 根据项目阶段返回默认 tab key */
export function getDefaultTab(stage: string): string {
  switch (stage) {
    case 'EVALUATING': return 'evaluate';
    case 'ARCHIVED': return 'open'; // 归档后默认看开标记录
    default: return 'open';
  }
}

export default function ProjectTabs() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { project } = useBidProjectContext();

  const currentTab = searchParams.get('tab') || (project ? getDefaultTab(project.stage) : 'open');

  const switchTab = (key: string) => {
    // 使用 replace 而非 push，避免堆积历史
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', key);
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const isStageAllowed = (def: TabDef) => {
    if (!project) return true;
    return def.minStage.includes(project.stage);
  };

  const currentDef = TABS.find(t => t.key === currentTab);

  return (
    <div>
      {/* Tab 导航栏 */}
      <div className="flex items-center gap-1 border-b border-[#edf2f7] overflow-x-auto -mx-1 px-1">
        {TABS.map(tab => {
          const active = currentTab === tab.key;
          const allowed = isStageAllowed(tab);
          return (
            <button
              key={tab.key}
              onClick={() => allowed && switchTab(tab.key)}
              disabled={!allowed && !active}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold whitespace-nowrap rounded-t-xl border-b-2 transition-all flex-shrink-0 ${
                active
                  ? 'border-[#064ea2] text-[#064ea2] bg-white'
                  : allowed
                  ? 'border-transparent text-[#5a6d8a] hover:text-[#18243a] hover:bg-[#f8fafc]'
                  : 'border-transparent text-[#cbd5e1] cursor-not-allowed'
              }`}
            >
              <tab.icon size={14} strokeWidth={1.5} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab 内容 */}
      <div className="pt-4">
        {currentDef && !isStageAllowed(currentDef) ? (
          /* 阶段不满足 - 引导提示 */
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#f8fafc] border border-[#edf2f7] flex items-center justify-center mb-4">
              <AlertCircle size={24} strokeWidth={1.5} className="text-[#94a3b8]" />
            </div>
            <p className="text-sm font-semibold text-[#5a6d8a] max-w-sm">
              {currentDef.stageHint.replace('{stage}', project ? (STAGE_LABEL[project.stage] || project.stage) : '未知')}
            </p>
          </div>
        ) : (
          /* 正常渲染 Tab 内容 — 由 page.tsx 根据 currentTab 条件渲染 */
          <div id="tab-content" />
        )}
      </div>
    </div>
  );
}
