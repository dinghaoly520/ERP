'use client';

import { useMemo, useState, useCallback } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { MessageList } from './message-list';
import { DataCanvas } from './data-canvas';
import { IndicatorBar } from './indicator-bar';
import { ChartLightbox } from './chart-lightbox';
import type {
  Message,
  AssistantCard as AssistantCardType,
  AssistantCitation,
} from '@/lib/types';
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
  dataMode,
  onDataModeChange,
}: {
  messages: Message[];
  onSend: (msg: string) => void;
  isLoading: boolean;
  onConfirmAction: (id: string) => void;
  onCancelAction: (id: string) => void;
  onBack: () => void;
  headerLeft?: number;
  dataMode: boolean;
  onDataModeChange: (mode: boolean) => void;
}) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Accumulate all cards from the entire conversation
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

  const metricCount = cards.filter((c) => c.type === 'metric').length;
  const tableCount = cards.filter((c) => c.type === 'table').length;
  const chartCount = cards.filter((c) => c.type === 'chart').length;

  // Topic label: use the last user message
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

  const handleChartDownload = useCallback((imageUrl: string) => {
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = `chart-${Date.now()}.png`;
    a.click();
  }, []);

  const handleAskFollowUp = useCallback(
    (question: string) => {
      onDataModeChange(false);
      onSend(question);
    },
    [onSend, onDataModeChange],
  );

  return (
    <div className={styles.workspace}>
      <div className={styles.main}>
        {/* Header */}
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
              智慧水发 · 蜀水云采
            </GradientText>
          </button>
        </header>

        {/* Messages — hidden in data mode */}
        <div
          className={styles.messages}
          style={{ display: dataMode ? 'none' : undefined }}
        >
          <MessageList
            messages={messages}
            onConfirmAction={onConfirmAction}
            onCancelAction={onCancelAction}
          />
        </div>

        {/* DataCanvas — shown in data mode */}
        {dataMode && (
          <DataCanvas
            cards={cards}
            topicLabel={topicLabel}
            onBack={() => onDataModeChange(false)}
            onChartClick={setLightboxUrl}
            onChartDownload={handleChartDownload}
            onAskFollowUp={handleAskFollowUp}
          />
        )}

        {/* Spacer when messages empty in data mode */}
        {dataMode && cards.length === 0 && (
          <div style={{ flex: 1 }} />
        )}

        {/* IndicatorBar */}
        <IndicatorBar
          metricCount={metricCount}
          tableCount={tableCount}
          chartCount={chartCount}
          onClick={() => onDataModeChange(true)}
          dataMode={dataMode}
        />

        {/* Input */}
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

      {/* ChartLightbox */}
      <ChartLightbox
        imageUrl={lightboxUrl}
        onClose={() => setLightboxUrl(null)}
      />
    </div>
  );
}
