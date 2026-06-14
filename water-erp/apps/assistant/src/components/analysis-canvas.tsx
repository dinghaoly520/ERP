'use client';

import { useState } from 'react';
import { PanelRightOpen, PanelRightClose } from 'lucide-react';
import { AssistantCard } from './assistant-card';
import type { AssistantCard as AssistantCardType, AssistantCitation } from '@/lib/types';

export function AnalysisCanvas({
  cards,
  citations,
}: {
  cards: AssistantCardType[];
  citations: AssistantCitation[];
}) {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed right-4 top-4 p-2 rounded-lg border cursor-pointer z-10"
        style={{
          borderColor: 'var(--color-border)',
          background: 'var(--color-surface)',
        }}
      >
        <PanelRightOpen size={18} />
      </button>
    );
  }

  const displayCards = cards.filter((c) => c.type !== 'actionPlan');

  return (
    <div
      className="w-80 border-l h-screen overflow-y-auto p-4 space-y-4 flex-shrink-0"
      style={{
        borderColor: 'var(--color-border)',
        background: 'rgba(255,255,255,0.6)',
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="text-sm font-semibold"
          style={{ color: 'var(--color-text)' }}
        >
          分析画布
        </span>
        <button
          onClick={() => setOpen(false)}
          className="p-1 rounded cursor-pointer"
        >
          <PanelRightClose size={16} />
        </button>
      </div>

      {displayCards.length === 0 && citations.length === 0 && (
        <p
          className="text-xs"
          style={{ color: 'var(--color-text-tertiary)' }}
        >
          暂无图表。问一个分析问题来生成数据卡片。
        </p>
      )}

      {displayCards.map((card, i) => (
        <AssistantCard key={i} card={card} />
      ))}

      {citations.length > 0 && (
        <div>
          <div
            className="text-xs font-semibold mb-2"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            引用来源
          </div>
          {citations.map((cit, i) => (
            <div
              key={i}
              className="text-xs py-1"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              [{cit.type}] {cit.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
