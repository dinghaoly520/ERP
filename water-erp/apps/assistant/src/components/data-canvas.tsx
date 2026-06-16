'use client';

import { BarChart3 } from 'lucide-react';
import type { AssistantCard as AssistantCardType } from '@/lib/types';
import { ChartRenderer } from './chart-renderer';
import styles from './data-canvas.module.css';

export function DataCanvas({
  cards,
  topicLabel,
}: {
  cards: AssistantCardType[];
  topicLabel: string;
}) {
  const displayCards = cards.filter((c) => c.type !== 'actionPlan' && c.type !== 'metric');

  if (displayCards.length === 0) {
    return (
      <div className={styles.canvas}>
        <div className={styles.canvasHeader}>
          <span className={styles.topicDot} />
          <span className={styles.topicLabel}>当前话题：{topicLabel}</span>
        </div>
        <div className={styles.empty}>
          <BarChart3 className={styles.emptyIcon} strokeWidth={1.2} />
          <p className={styles.emptyText}>
            暂无数据卡片。在对话中提出分析问题（如"帮我看看当前的招标情况"），AI 会生成数据卡片和图表。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.canvas}>
      <div className={styles.canvasHeader}>
        <span className={styles.topicDot} />
        <span className={styles.topicLabel}>实时数据 · {topicLabel}</span>
      </div>

      <div className={styles.cardStack}>
        {displayCards.map((card, i) => {
          // Staggered entrance: 80ms delay per card
          const staggerDelay = `${i * 0.08}s`;

          if (card.type === 'table') {
            const numericKeys = new Set(
              card.columns
                .filter((c) => /count|value|budget|num|数量|数值|人数|预算/i.test(c.key))
                .map((c) => c.key),
            );
            return (
              <div
                key={`table-${i}`}
                className={`${styles.tableCard} ${styles.cardEnter}`}
                style={{ animationDelay: staggerDelay }}
              >
                <div className={styles.tableHeader}>{card.title}</div>
                <div className={styles.tableBody}>
                  <table>
                    <thead>
                      <tr>
                        {card.columns.map((c) => (
                          <th
                            key={c.key}
                            data-numeric={numericKeys.has(c.key) ? 'true' : 'false'}
                          >
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(card.rows as Array<Record<string, unknown>>).map((row, j) => (
                        <tr key={j}>
                          {card.columns.map((c) => (
                            <td
                              key={c.key}
                              data-numeric={numericKeys.has(c.key) ? 'true' : 'false'}
                            >
                              {String(row[c.key] ?? '-')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          }

          if (card.type === 'chart') {
            return (
              <div
                key={`chart-${i}`}
                className={`${styles.chartCard} ${styles.cardEnter}`}
                style={{ animationDelay: staggerDelay }}
              >
                {card.title && (
                  <div className={styles.chartTitle}>{card.title}</div>
                )}
                <div className={styles.chartBody}>
                  <ChartRenderer
                    option={card.option}
                    height={card.chartType === 'pie' ? 280 : 300}
                  />
                </div>
                {card.caption && (
                  <div className={styles.chartCaption}>{card.caption}</div>
                )}
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
