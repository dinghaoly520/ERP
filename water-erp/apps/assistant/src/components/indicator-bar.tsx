'use client';

import { BarChart3 } from 'lucide-react';
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
  if (total === 0) return null;

  const parts: string[] = [];
  if (chartCount > 0) parts.push(`${chartCount} 张图表`);
  if (tableCount > 0) parts.push(`${tableCount} 张表格`);
  if (metricCount > 0) parts.push(`${metricCount} 张指标`);

  return (
    <div
      className={styles.bar}
      onClick={dataMode ? undefined : onClick}
      role={dataMode ? 'status' : 'button'}
      tabIndex={dataMode ? undefined : 0}
      aria-label={dataMode ? `共 ${total} 张数据卡片` : `共 ${total} 张数据卡片，点击查看`}
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
      {!dataMode && <span className={styles.hint}>点击切换到数据模式</span>}
    </div>
  );
}
