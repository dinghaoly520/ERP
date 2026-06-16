'use client';

import { BarChart3, MessageSquare } from 'lucide-react';
import styles from './indicator-bar.module.css';

export function IndicatorBar({
  metricCount,
  tableCount,
  chartCount,
  onClick,
  dataMode,
}: {
  metricCount: number;
  tableCount: number;
  chartCount: number;
  onClick: () => void;
  dataMode: boolean;
}) {
  const total = metricCount + tableCount + chartCount;

  // Data mode: always show "switch to chat" hint
  if (dataMode) {
    return (
      <div
        className={styles.bar}
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        aria-label="点击切换到对话模式"
      >
        <MessageSquare size={12} strokeWidth={1.8} />
        <span className={styles.indicator}>
          {total > 0 ? `共 ${total} 张数据卡片` : '暂无数据卡片'}
        </span>
        <span className={styles.hint}>点击切换到对话模式</span>
      </div>
    );
  }

  // Chat mode: show card count breakdown
  if (total === 0) return null;

  const parts: string[] = [];
  if (chartCount > 0) parts.push(`${chartCount} 张图表`);
  if (tableCount > 0) parts.push(`${tableCount} 张表格`);
  if (metricCount > 0) parts.push(`${metricCount} 张指标卡`);

  return (
    <div
      className={styles.bar}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`共 ${total} 张数据卡片，点击查看`}
    >
      <BarChart3 size={12} strokeWidth={1.8} />
      <span className={styles.indicator}>
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 && ' · '}
            <span className={styles.dot} />
            {p}
          </span>
        ))}
      </span>
      <span className={styles.hint}>点击切换到数据模式</span>
    </div>
  );
}
