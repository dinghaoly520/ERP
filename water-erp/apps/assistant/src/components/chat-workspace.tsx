'use client';

import { useMemo } from 'react';
import { PromptBox } from './prompt-box';
import { MessageList } from './message-list';
import { AnalysisCanvas } from './analysis-canvas';
import type { Message, AssistantCard as AssistantCardType, AssistantCitation } from '@/lib/types';

export function ChatWorkspace({
  messages,
  onSend,
  isLoading,
  onConfirmAction,
  onCancelAction,
}: {
  messages: Message[];
  onSend: (msg: string) => void;
  isLoading: boolean;
  onConfirmAction: (id: string) => void;
  onCancelAction: (id: string) => void;
}) {
  // Collect all cards and citations from the last assistant message
  const { cards, citations } = useMemo(() => {
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === 'assistant');
    return {
      cards: (lastAssistant?.cards as AssistantCardType[]) || [],
      citations: (lastAssistant?.citations as AssistantCitation[]) || [],
    };
  }, [messages]);

  const hasCanvas = cards.length > 0 || citations.length > 0;

  return (
    <div className="flex h-screen">
      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header
          className="flex items-center justify-between px-6 py-3 border-b flex-shrink-0"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-semibold"
              style={{ color: 'var(--color-text)' }}
            >
              水叮当智能助手
            </span>
            <span
              className="text-xs"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              SHUIDINGDANG AI
            </span>
          </div>
        </header>

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto px-6 py-4"
          style={{ background: 'var(--home-gradient)' }}
        >
          <MessageList
            messages={messages}
            onConfirmAction={onConfirmAction}
            onCancelAction={onCancelAction}
          />
        </div>

        {/* Input */}
        <div className="px-6 py-4 border-t flex-shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex justify-center">
            <PromptBox onSend={onSend} isLoading={isLoading} />
          </div>
        </div>
      </div>

      {/* Analysis Canvas */}
      {hasCanvas && <AnalysisCanvas cards={cards} citations={citations} />}
    </div>
  );
}
