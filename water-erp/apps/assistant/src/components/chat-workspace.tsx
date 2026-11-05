'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { MessageList } from './message-list';
import { DataCanvas } from './data-canvas';
import { IndicatorBar } from './indicator-bar';
import type {
  Message,
  AssistantCard as AssistantCardType,
} from '@/lib/types';
import styles from './chat-workspace.module.css';
import GradientText from './GradientText';

export function ChatWorkspace({
  messages,
  onSend,
  isLoading,
  onBack,
  headerLeft = 260,
  dataMode,
  onDataModeChange,
}: {
  messages: Message[];
  onSend: (msg: string) => void;
  isLoading: boolean;
  onBack: () => void;
  headerLeft?: number;
  dataMode: boolean;
  onDataModeChange: (mode: boolean) => void;
}) {
  // Only render cards from the LAST assistant message — keeps the data canvas
  // focused on the current question, not a cumulative dump of all previous queries.
  const cards = useMemo(() => {
    const lastAssist = [...messages].reverse().find((m) => m.role === 'assistant');
    const cardMap = new Map<string, AssistantCardType>();
    if (lastAssist?.cards) {
      for (const c of lastAssist.cards as AssistantCardType[]) {
        const key = `${c.type}:${c.title || JSON.stringify(c)}`;
        if (!cardMap.has(key)) cardMap.set(key, c);
      }
    }
    return Array.from(cardMap.values());
  }, [messages]);

  const metricCount = cards.filter((c) => c.type === 'metric').length;
  const tableCount = cards.filter((c) => c.type === 'table').length;
  const chartCount = cards.filter((c) => c.type === 'chart').length;

  const messagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight });
  }, [messages, isLoading]);

  const topicLabel = useMemo(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    return lastUser?.content?.slice(0, 30) || '数据总览';
  }, [messages]);

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
    const textarea = document.querySelector(
      `.${styles.aiInput}`,
    ) as HTMLTextAreaElement;
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
      <div className={styles.main}>
        <header
          className={styles.header}
          style={{ left: `${headerLeft}px` }}
        >
          <button
            className={styles.headerTitle}
            onClick={onBack}
            type="button"
            title="返回首页"
          >
            <GradientText
              colors={[
                '#1a2332',
                '#2563EB',
                '#0891b2',
                '#18a56c',
                '#1a2332',
              ]}
              animationSpeed={8}
              direction="horizontal"
              yoyo={true}
            >
              蜀水云采 · 智慧水发
            </GradientText>
          </button>
        </header>

        {/* Messages — hidden in data mode；新消息/回答自动跟随滚动到底（2026-11-04 审查：
            与 :3005/:3011 行为对齐——此前新回答不滚动，用户需手动翻到底） */}
        <div
          ref={messagesRef}
          className={styles.messages}
          style={{ display: dataMode ? 'none' : undefined }}
        >
          <MessageList
            messages={messages}
          />
        </div>

        {dataMode && (
          <DataCanvas cards={cards} topicLabel={topicLabel} />
        )}

        {dataMode && cards.length === 0 && (
          <div style={{ flex: 1 }} />
        )}

        {/* IndicatorBar — card counts in chat mode, back hint in data mode */}
        <IndicatorBar
          metricCount={metricCount}
          tableCount={tableCount}
          chartCount={chartCount}
          onClick={() => onDataModeChange(dataMode ? false : true)}
          dataMode={dataMode}
        />

        <div className={styles.inputBar}>
          <div className={styles.inputWrapper}>
            <div className={styles.commandBox}>
              <textarea
                className={styles.aiInput}
                placeholder={
                  dataMode
                    ? '基于数据画布追问...'
                    : '输入问题 / 生成分析 / 操作业务...'
                }
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
    </div>
  );
}
