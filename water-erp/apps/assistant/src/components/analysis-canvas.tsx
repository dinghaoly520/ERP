'use client';

import { useState, useEffect, useRef } from 'react';
import { PanelRightOpen, PanelRightClose } from 'lucide-react';
import type { AssistantCard as AssistantCardType, AssistantCitation } from '@/lib/types';
import styles from './analysis-canvas.module.css';

export function AnalysisCanvas({
  cards,
  citations,
  onToggle,
}: {
  cards: AssistantCardType[];
  citations: AssistantCitation[];
  onToggle: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const prevCardCount = useRef(cards.length);
  const displayCards = cards.filter((c) => c.type !== 'actionPlan');

  useEffect(() => {
    onToggle(open);
  }, [open, onToggle]);

  // Auto-open when new cards arrive
  useEffect(() => {
    if (cards.length > prevCardCount.current) {
      setOpen(true);
    }
    prevCardCount.current = cards.length;
  }, [cards.length]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={styles.toggleBtn}
        type="button"
        aria-label="打开分析画布"
      >
        <PanelRightOpen size={18} />
      </button>
    );
  }

  return (
    <div className={styles.canvas}>
      {/* Header */}
      <div className={styles.canvasHeader}>
        <span className={styles.canvasTitle}>分析画布</span>
        <button
          onClick={() => setOpen(false)}
          className={styles.closeBtn}
          type="button"
          aria-label="关闭分析画布"
        >
          <PanelRightClose size={16} />
        </button>
      </div>

      {displayCards.length === 0 && citations.length === 0 && (
        <p className={styles.emptyHint}>暂无图表。问一个分析问题来生成数据卡片。</p>
      )}

      {/* Cards */}
      <div className={styles.cardList}>
        {displayCards.map((card, i) => {
          if (card.type === 'metric') {
            return (
              <div key={i} className={styles.metricCard}>
                <div className={styles.metricLabel}>{card.title}</div>
                <div className={styles.metricValue}>
                  {card.value}
                  {card.trend && (
                    <span
                      className={styles.metricTrend}
                      style={{
                        color: card.trend.startsWith('+') ? 'var(--success)' : 'var(--error)',
                      }}
                    >
                      {card.trend}
                    </span>
                  )}
                </div>
                {/* Shimmer border */}
                <div className={styles.cardShimmer} />
              </div>
            );
          }
          if (card.type === 'table') {
            return (
              <div key={i} className={styles.tableCard}>
                <div className={styles.tableHeader}>{card.title}</div>
                <div className={styles.tableBody}>
                  <table>
                    <thead>
                      <tr>
                        {card.columns.map((c: { key: string; label: string }) => (
                          <th key={c.key}>{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(card.rows as Array<Record<string, unknown>>).map((row, j) => (
                        <tr key={j}>
                          {card.columns.map((c: { key: string }) => (
                            <td key={c.key}>{String(row[c.key] ?? '-')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Shimmer border */}
                <div className={styles.cardShimmer} />
              </div>
            );
          }
          return null;
        })}
      </div>

      {/* Citations */}
      {citations.length > 0 && (
        <div className={styles.citationSection}>
          <div className={styles.citationTitle}>引用来源</div>
          <div className={styles.citationList}>
            {citations.map((cit, j) => (
              <span key={j} className={styles.citationTag}>
                [{cit.type}] {cit.title}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
