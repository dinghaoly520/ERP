'use client';

import { ArrowLeft, Maximize2, Download, BarChart3 } from 'lucide-react';
import type { AssistantCard as AssistantCardType } from '@/lib/types';
import styles from './data-canvas.module.css';

export function DataCanvas({
  cards,
  topicLabel,
  onBack,
  onChartClick,
  onChartDownload,
  onAskFollowUp,
}: {
  cards: AssistantCardType[];
  topicLabel: string;
  onBack: () => void;
  onChartClick: (imageUrl: string) => void;
  onChartDownload: (imageUrl: string) => void;
  onAskFollowUp: (question: string) => void;
}) {
  const displayCards = cards.filter((c) => c.type !== 'actionPlan');

  if (displayCards.length === 0) {
    return (
      <div className={styles.canvas}>
        <div className={styles.canvasHeader}>
          <button className={styles.backBtn} onClick={onBack} type="button">
            <ArrowLeft size={14} strokeWidth={1.8} />
            返回对话
          </button>
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
        <button className={styles.backBtn} onClick={onBack} type="button">
          <ArrowLeft size={14} strokeWidth={1.8} />
          返回对话
        </button>
        <span className={styles.topicLabel}>当前话题：{topicLabel}</span>
      </div>

      <div className={styles.cardGrid}>
        {displayCards.map((card, i) => {
          if (card.type === 'metric') {
            return (
              <div key={`metric-${i}`} className={styles.metricCard}>
                <div className={styles.metricLabel}>{card.title}</div>
                <div className={styles.metricValue}>
                  {card.value}
                  {card.trend && (
                    <span
                      className={styles.metricTrend}
                      style={{
                        color: card.trend.startsWith('+')
                          ? 'var(--success)'
                          : card.trend.startsWith('-')
                            ? 'var(--error)'
                            : 'var(--text-muted)',
                      }}
                    >
                      {card.trend}
                    </span>
                  )}
                </div>
                <div className={styles.cardShimmer} />
              </div>
            );
          }

          if (card.type === 'table') {
            return (
              <div key={`table-${i}`} className={styles.tableCard}>
                <div className={styles.tableHeader}>{card.title}</div>
                <div className={styles.tableBody}>
                  <table>
                    <thead>
                      <tr>
                        {card.columns.map((c) => (
                          <th key={c.key}>{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(card.rows as Array<Record<string, unknown>>).map((row, j) => (
                        <tr key={j}>
                          {card.columns.map((c) => (
                            <td key={c.key}>{String(row[c.key] ?? '-')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles.cardShimmer} />
              </div>
            );
          }

          if (card.type === 'chart') {
            return (
              <div key={`chart-${i}`}>
                {card.title && (
                  <div className={styles.chartTitle}>{card.title}</div>
                )}
                <div
                  className={styles.chartCard}
                  onClick={() => onChartClick(card.imageUrl)}
                >
                  <img
                    src={card.imageUrl}
                    alt={card.title || '数据图表'}
                    className={styles.chartImage}
                    loading="lazy"
                  />
                  <div className={styles.chartOverlay}>
                    <button
                      className={styles.chartToolBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        onChartClick(card.imageUrl);
                      }}
                      type="button"
                      title="放大查看"
                    >
                      <Maximize2 size={18} strokeWidth={1.5} />
                    </button>
                    <button
                      className={styles.chartToolBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        onChartDownload(card.imageUrl);
                      }}
                      type="button"
                      title="下载图表"
                    >
                      <Download size={18} strokeWidth={1.5} />
                    </button>
                  </div>
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
