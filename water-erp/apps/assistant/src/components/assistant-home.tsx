'use client';

import { PromptBox } from './prompt-box';
import { QuickActions } from './quick-actions';

export function AssistantHome({
  onSend,
  isLoading,
}: {
  onSend: (msg: string) => void;
  isLoading?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen px-6"
      style={{ background: 'var(--home-gradient)' }}
    >
      {/* Brand */}
      <div className="mb-8 text-center">
        <div
          className="text-xs tracking-[0.25em] mb-3 uppercase"
          style={{ color: 'var(--accent-blue)' }}
        >
          SHUIDINGDANG AI
        </div>
        <h1
          className="text-[1.75rem] font-bold mb-2"
          style={{ color: 'var(--color-blue-950)' }}
        >
          董事长，今天想了解什么？
        </h1>
        <p
          className="text-sm"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          水叮当智能助手 — 全系统数据洞察、业务分析与协同操作
        </p>
      </div>

      {/* Search Box */}
      <PromptBox onSend={onSend} isLoading={isLoading} />

      {/* Quick Actions */}
      <div className="mt-10 w-full max-w-[680px]">
        <QuickActions onSend={onSend} />
      </div>
    </div>
  );
}
