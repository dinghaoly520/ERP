'use client';

import { useMemo, useState, useCallback } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { MessageList } from './message-list';
import { AnalysisCanvas } from './analysis-canvas';
import type { Message, AssistantCard as AssistantCardType, AssistantCitation } from '@/lib/types';
import styles from './chat-workspace.module.css';
import GradientText from './GradientText';

export function ChatWorkspace({
  messages,
  onSend,
  isLoading,
  onConfirmAction,
  onCancelAction,
  onBack,
  headerLeft = 260,
}: {
  messages: Message[];
  onSend: (msg: string) => void;
  isLoading: boolean;
  onConfirmAction: (id: string) => void;
  onCancelAction: (id: string) => void;
  onBack: () => void;
  headerLeft?: number;
}) {
  // Accumulate all cards/citations from the entire conversation, deduped by title
  const { cards, citations } = useMemo(() => {
    const cardMap = new Map<string, AssistantCardType>();
    const citationSet = new Set<string>();
    const allCitations: AssistantCitation[] = [];
    for (const msg of messages) {
      if (msg.role === 'assistant') {
        if (msg.cards) {
          for (const c of msg.cards as AssistantCardType[]) {
            const key = c.title || JSON.stringify(c);
            if (!cardMap.has(key)) cardMap.set(key, c);
          }
        }
        if (msg.citations) {
          for (const cit of msg.citations as AssistantCitation[]) {
            const key = `${cit.type}:${cit.title}`;
            if (!citationSet.has(key)) {
              citationSet.add(key);
              allCitations.push(cit);
            }
          }
        }
      }
    }
    return { cards: Array.from(cardMap.values()), citations: allCitations };
  }, [messages]);

  const hasCanvas = cards.length > 0 || citations.length > 0;
  const [canvasOpen, setCanvasOpen] = useState(true);
  const handleCanvasToggle = useCallback((open: boolean) => setCanvasOpen(open), []);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const val = (e.target as HTMLTextAreaElement).value.trim();
      if (val && !isLoading) {
        onSend(val);
        (e.target as HTMLTextAreaElement).value = '';
      }
    }
  };

  const handleSendClick = () => {
    const textarea = document.querySelector(`.${styles.aiInput}`) as HTMLTextAreaElement;
    if (textarea) {
      const val = textarea.value.trim();
      if (val && !isLoading) {
        onSend(val);
        textarea.value = '';
      }
    }
  };

  return (
    <div className={styles.workspace}>
      {/* Main chat area */}
      <div className={styles.main}>
        {/* Header */}
        <header className={styles.header} style={{ left: `${headerLeft}px` }}>
          <button
            className={styles.headerTitle}
            onClick={onBack}
            type="button"
            title="返回首页"
          >
            <GradientText
              colors={['#1a2332', '#2563EB', '#0891b2', '#18a56c', '#1a2332']}
              animationSpeed={8}
              direction="horizontal"
              yoyo={true}
            >
              智慧水发 · 蜀水云采
            </GradientText>
          </button>
        </header>

        {/* Messages */}
        <div className={styles.messages}>
          <MessageList
            messages={messages}
            onConfirmAction={onConfirmAction}
            onCancelAction={onCancelAction}
          />
        </div>

        {/* Input */}
        <div className={styles.inputBar}>
          <div className={styles.inputWrapper}>
            <div className={styles.commandBox}>
              <textarea
                className={styles.aiInput}
                placeholder="输入问题 / 生成分析 / 操作业务..."
                rows={1}
                onKeyDown={handleInputKeyDown}
                disabled={isLoading}
              />
              <button
                className={`${styles.sendBtn} ${isLoading ? '' : styles.active}`}
                onClick={handleSendClick}
                disabled={isLoading}
                type="button"
              >
                {isLoading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Analysis Canvas */}
      {hasCanvas && (
        <AnalysisCanvas
          cards={cards}
          citations={citations}
          onToggle={handleCanvasToggle}
        />
      )}
    </div>
  );
}
