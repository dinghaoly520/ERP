'use client';

import { Unlock, ClipboardCheck, ListChecks } from 'lucide-react';

export interface TabDef {
  key: 'open' | 'evaluate' | 'standard';
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  minStage: string[];
  stageHint: string;
}

export const TABS: TabDef[] = [
  {
    key: 'open',
    label: '开标大厅',
    icon: Unlock,
    minStage: ['OPENING', 'EVALUATING', 'ARCHIVED', 'ABORTED'],
    stageHint: '开标尚未开始。请等待项目在 :3005 确定开标。',
  },
  {
    key: 'evaluate',
    label: '评标管理',
    icon: ClipboardCheck,
    // 与开标大厅 tab 同口径启用：评标视图自身已对 OPENING 渲染只读骨架、对 ABORTED 渲染空态，
    // 故 tab 不再于这些阶段灰显（避免"灰色打不开"）。DOWNLOAD/SUBMIT 不可作为工作区入口，仍禁用。
    minStage: ['OPENING', 'EVALUATING', 'ARCHIVED', 'ABORTED'],
    stageHint: '评标尚未开始。当前阶段：{stage}。请等待 :3005 启动评标后查看（本页只读）。',
  },
  {
    key: 'standard',
    label: '评分标准',
    icon: ListChecks,
    minStage: ['DOWNLOAD', 'SUBMIT', 'OPENING', 'EVALUATING', 'ARCHIVED', 'ABORTED'],
    stageHint: '—',
  },
];

/** 默认 tab：EVALUATING 看评标；其余（含 ARCHIVED/ABORTED）回开标大厅 */
export function getDefaultTab(stage: string): TabDef['key'] {
  return stage === 'EVALUATING' ? 'evaluate' : 'open';
}

export function isTabAllowed(def: TabDef, stage: string): boolean {
  return def.minStage.includes(stage);
}

export default function ProjectTabs({ stage, current, onSwitch }: {
  stage: string;
  current: TabDef['key'];
  onSwitch: (key: TabDef['key']) => void;
}) {
  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-[12px] bg-[oklch(0.95_0.008_258)] p-1 shadow-[inset_2px_2px_5px_oklch(0.55_0.03_258_/_0.12),inset_-2px_-2px_5px_oklch(1_0_0_/_0.7)]">
      {TABS.map(def => {
        const allowed = isTabAllowed(def, stage);
        const active = current === def.key;
        return (
          <button
            key={def.key}
            type="button"
            disabled={!allowed}
            title={allowed ? '' : def.stageHint.replace('{stage}', stage)}
            onClick={() => onSwitch(def.key)}
            className={`flex items-center gap-1.5 rounded-[9px] px-4 py-1.5 text-[12px] font-bold transition-all disabled:opacity-40 ${
              active
                ? 'bg-[oklch(1_0_0)] text-[color:var(--accent-strong)] shadow-[2px_2px_5px_oklch(0.55_0.03_258_/_0.14),-1px_-1px_3px_oklch(1_0_0_/_0.9)]'
                : 'text-[color:var(--muted-foreground)]'
            }`}
          >
            <def.icon size={13} /> {def.label}
          </button>
        );
      })}
    </div>
  );
}
