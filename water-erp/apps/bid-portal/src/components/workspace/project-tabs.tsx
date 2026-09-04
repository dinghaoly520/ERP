'use client';

import { Unlock, ClipboardCheck, ListChecks, Shield, Gavel, PenLine } from 'lucide-react';

export interface TabDef {
  key: 'open' | 'supervise' | 'evaluate' | 'standard' | 'quotes' | 'signing';
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  minStage: string[];
  stageHint: string;
  /** 仅谈判采购显示（roundMode=negotiation；sealed_auction 竞价采购为单轮唱标，无报价轮次流程） */
  requiresRoundMode?: boolean;
}

export const TABS: TabDef[] = [
  {
    key: 'open',
    label: '开标大厅',
    icon: Unlock,
    minStage: ['OPENING', 'EVALUATING', 'ARCHIVED', 'ABORTED'],
    stageHint: '开标尚未开始。请等待采购管理工作台确定开标。',
  },
  {
    key: 'evaluate',
    label: '评标管理',
    icon: ClipboardCheck,
    // 与开标大厅 tab 同口径启用：评标视图自身对 OPENING 渲染「启动评标」横幅、对 ABORTED 渲染空态
    // （分工 v3 后评标管理为 :3007 现场全操作），故 tab 不再于这些阶段灰显（避免"灰色打不开"）。
    // DOWNLOAD/SUBMIT 不可作为工作区入口，仍禁用。
    minStage: ['OPENING', 'EVALUATING', 'ARCHIVED', 'ABORTED'],
    stageHint: '评标尚未开始。当前阶段：{stage}。请等待采购管理工作台启动评标后进入评标管理。',
  },
  {
    key: 'standard',
    label: '评分标准',
    icon: ListChecks,
    minStage: ['OPENING', 'EVALUATING', 'ARCHIVED', 'ABORTED'],
    stageHint: '—',
  },
  {
    key: 'signing',
    label: '评标签字',
    icon: PenLine,
    // 入口条件：stage=EVALUATING 且已生成评标结果（tab 内容自身对未满足条件渲染引导空态；ARCHIVED 只读回看）
    minStage: ['EVALUATING', 'ARCHIVED'],
    stageHint: '评标结束后才能签字。当前阶段：{stage}。',
  },
  {
    key: 'quotes',
    label: '报价轮次',
    icon: Gavel,
    minStage: ['OPENING', 'EVALUATING', 'ARCHIVED', 'ABORTED'],
    stageHint: '—',
    requiresRoundMode: true,
  },
  {
    key: 'supervise',
    label: '监督视图',
    icon: Shield,
    // 置于最右：监督为旁路只读视图，主流程 tab 在前。
    // 与开标大厅同口径启用：监督视图随开标执行阶段提供只读留痕，DOWNLOAD/SUBMIT 不可作为入口仍禁用。
    minStage: ['OPENING', 'EVALUATING', 'ARCHIVED', 'ABORTED'],
    stageHint: '开标尚未开始，监督视图不可用。请等待采购管理工作台确定开标。',
  },
];

/** 默认 tab：EVALUATING 看评标；其余（含 ARCHIVED/ABORTED）回开标大厅 */
export function getDefaultTab(stage: string): TabDef['key'] {
  return stage === 'EVALUATING' ? 'evaluate' : 'open';
}

export function isTabAllowed(def: TabDef, stage: string, hasRoundMode?: boolean): boolean {
  if (!def.minStage.includes(stage)) return false;
  if (def.requiresRoundMode && !hasRoundMode) return false;
  return true;
}

export default function ProjectTabs({ stage, current, onSwitch, hasRoundMode }: {
  stage: string;
  current: TabDef['key'];
  onSwitch: (key: TabDef['key']) => void;
  hasRoundMode?: boolean;
}) {
  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-[12px] bg-[oklch(0.95_0.008_258)] p-1 shadow-[inset_2px_2px_5px_oklch(0.55_0.03_258_/_0.12),inset_-2px_-2px_5px_oklch(1_0_0_/_0.7)]">
      {TABS.map(def => {
        const allowed = isTabAllowed(def, stage, hasRoundMode);
        if (def.requiresRoundMode && !hasRoundMode) return null; // 非多轮项目不渲染 tab
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
