'use client';

import type { Message } from '@/lib/types';
import { AssistantCard } from './assistant-card';

export function MessageList({
  messages,
  onConfirmAction,
  onCancelAction,
}: {
  messages: Message[];
  onConfirmAction: (id: string) => void;
  onCancelAction: (id: string) => void;
}) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
        >
          <div
            className={`max-w-[75%] ${
              msg.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            {/* User message bubble */}
            {msg.role === 'user' && (
              <div
                className="rounded-2xl rounded-br-md px-4 py-2.5 text-sm"
                style={{
                  background: 'oklch(0.42_0.14_260)',
                  color: '#fff',
                }}
              >
                {msg.content}
              </div>
            )}

            {/* Assistant message */}
            {msg.role === 'assistant' && (
              <div className="space-y-3">
                <div
                  className="text-sm leading-relaxed"
                  style={{ color: 'var(--color-text)' }}
                >
                  {msg.content}
                </div>

                {/* Cards */}
                {msg.cards && msg.cards.length > 0 && (
                  <div className="space-y-3">
                    {msg.cards
                      .filter((c) => c.type !== 'actionPlan')
                      .map((card, i) => (
                        <AssistantCard key={i} card={card} />
                      ))}
                  </div>
                )}

                {/* Pending Actions */}
                {msg.pendingActions && msg.pendingActions.length > 0 && (
                  <div className="space-y-3">
                    {msg.pendingActions.map((pa) => (
                      <AssistantCard
                        key={pa.actionId}
                        card={{
                          type: 'actionPlan',
                          title: pa.summary,
                          riskLevel: pa.riskLevel,
                          actionId: pa.actionId,
                          changes: [],
                        }}
                        onConfirm={onConfirmAction}
                        onCancel={onCancelAction}
                      />
                    ))}
                  </div>
                )}

                {/* Citations */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className="pt-2">
                    <div
                      className="text-xs mb-1"
                      style={{ color: 'var(--color-text-tertiary)' }}
                    >
                      引用来源：
                    </div>
                    {msg.citations.map((cit, i) => (
                      <span
                        key={i}
                        className="inline-block text-xs mr-3"
                        style={{ color: 'var(--color-text-tertiary)' }}
                      >
                        [{cit.type}] {cit.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Timestamp */}
            <div
              className="text-xs mt-1"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              {msg.timestamp}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
