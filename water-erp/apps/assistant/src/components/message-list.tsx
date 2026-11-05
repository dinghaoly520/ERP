'use client';

import type { Message } from '@/lib/types';
import styles from './message-list.module.css';

export function MessageList({
  messages,
}: {
  messages: Message[];
}) {
  if (messages.length === 0) return null;

  return (
    <div className={styles.messageList}>
      {messages.map((msg) => (
        <div key={msg.id}>
          {msg.role === 'user' && (
            <div className={styles.userBubble}>
              <div className={styles.userContent}>{msg.content}</div>
            </div>
          )}

          {msg.role === 'assistant' && (
            <div className={styles.assistantBubble}>
              <div className={styles.assistantContent}>
                <div className={styles.assistantText}>{msg.content}</div>
              </div>
            </div>
          )}

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
