'use client';

import type { Message } from '@/lib/types';
import styles from './message-list.module.css';
import { ShieldAlert, Check, X } from 'lucide-react';

const RISK_COLORS: Record<string, { text: string; bg: string }> = {
  low: { text: '#16a34a', bg: 'rgba(34,197,94,0.1)' },
  medium: { text: '#d97706', bg: 'rgba(245,158,11,0.1)' },
  high: { text: '#dc2626', bg: 'rgba(239,68,68,0.1)' },
};
const RISK_LABELS: Record<string, string> = { low: '低风险', medium: '中风险', high: '高风险' };

export function MessageList({
  messages,
  onConfirmAction,
  onCancelAction,
}: {
  messages: Message[];
  onConfirmAction: (id: string) => void;
  onCancelAction: (id: string) => void;
}) {
  if (messages.length === 0) return null;

  return (
    <div className={styles.messageList}>
      {messages.map((msg) => (
        <div key={msg.id}>
          {/* 用户消息 */}
          {msg.role === 'user' && (
            <div className={styles.userBubble}>
              <div className={styles.userContent}>{msg.content}</div>
            </div>
          )}

          {/* 助手消息 */}
          {msg.role === 'assistant' && (
            <div className={styles.assistantBubble}>
              <div className={styles.assistantContent}>
                {/* 文本 */}
                <div className={styles.assistantText}>{msg.content}</div>

                {/* 操作预案卡 */}
                {msg.pendingActions && msg.pendingActions.length > 0 && (
                  <div className={styles.cardsArea}>
                    {msg.pendingActions.map((pa) => {
                      const colors = RISK_COLORS[pa.riskLevel] || RISK_COLORS.low;
                      return (
                        <div key={pa.actionId} className={styles.actionCard}>
                          <div className={styles.actionHeader}>
                            <ShieldAlert size={16} style={{ color: colors.text }} />
                            <span className={styles.actionTitle}>{pa.summary}</span>
                            <span className={styles.riskBadge} style={{ background: colors.bg, color: colors.text }}>
                              {RISK_LABELS[pa.riskLevel] || pa.riskLevel}
                            </span>
                          </div>
                          <div className={styles.actionChanges}>
                            目标: {pa.targetType} {pa.targetId}
                            <br />操作: {pa.actionType}
                          </div>
                          <div className={styles.actionButtonRow}>
                            <button className={styles.confirmBtn} onClick={() => onConfirmAction(pa.actionId)}>
                              <Check size={14} /> 确认执行
                            </button>
                            <button className={styles.cancelBtn} onClick={() => onCancelAction(pa.actionId)}>
                              <X size={14} /> 取消
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 引用来源 */}
                {msg.citations && msg.citations.length > 0 && (
                  <div className={styles.citations}>
                    {msg.citations.map((cit, i) => (
                      <span key={i} className={styles.citationTag}>
                        [{cit.type}] {cit.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 时间戳 */}
          <div
            style={{
              textAlign: msg.role === 'user' ? 'right' : 'left',
              fontSize: '11px',
              color: 'var(--text-hint)',
              marginTop: '4px',
              paddingLeft: msg.role === 'assistant' ? '0' : '0',
            }}
          >
            {msg.timestamp}
          </div>
        </div>
      ))}
    </div>
  );
}
