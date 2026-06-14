'use client';

import { useMemo, useEffect, useRef } from 'react';
import { Send, Loader2, PanelRightOpen } from 'lucide-react';
import { MessageList } from './message-list';
import { AnalysisCanvas } from './analysis-canvas';
import type { Message, AssistantCard as AssistantCardType, AssistantCitation } from '@/lib/types';
import styles from './chat-workspace.module.css';

function useMouseSpotlight() {
  const layerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const targetRef = useRef({ x: 0.5, y: 0.5 });
  const currentRef = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      targetRef.current = {
        x: e.clientX / window.innerWidth,
        y: e.clientY / window.innerHeight,
      };
    };

    const animate = () => {
      const t = targetRef.current;
      const c = currentRef.current;
      c.x += (t.x - c.x) * 0.08;
      c.y += (t.y - c.y) * 0.08;

      const el = layerRef.current;
      if (el) {
        el.style.setProperty('--spotlight-x', `${c.x * 100}%`);
        el.style.setProperty('--spotlight-y', `${c.y * 100}%`);
      }
      rafRef.current = requestAnimationFrame(animate);
    };

    window.addEventListener('mousemove', handleMove, { passive: true });
    rafRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('mousemove', handleMove);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return layerRef;
}

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
  const spotlightRef = useMouseSpotlight();

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
      {/* 鼠标跟随光影 */}
      <div ref={spotlightRef} className={styles.spotlightLayer} />

      {/* Main chat area */}
      <div className={styles.main}>
        {/* Header */}
        <header className={styles.header}>
          <span className={styles.headerTitle}>
            水叮当智能助手
            <span className={styles.headerBadge}>SHUIDINGDANG AI</span>
          </span>
          {hasCanvas ? null : (
            <button className={styles.canvasToggle}>
              <PanelRightOpen size={16} />
            </button>
          )}
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
      {hasCanvas && <AnalysisCanvas cards={cards} citations={citations} />}
    </div>
  );
}
