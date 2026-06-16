'use client';

import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { BASE_OPTION } from '@/lib/echarts-theme';

export function ChartRenderer({
  option,
  height = 280,
}: {
  option: Record<string, unknown>;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    try {
      if (!chartRef.current) {
        chartRef.current = echarts.init(containerRef.current);
      }
      // 合并主题基础配置（option 优先；tooltip 深度合并以保留白底卡片样式）
      const merged: Record<string, unknown> = { ...BASE_OPTION };
      for (const [k, v] of Object.entries(option)) {
        if (k === 'tooltip' && v && typeof v === 'object' && !Array.isArray(v)) {
          merged.tooltip = { ...BASE_OPTION.tooltip, ...v as Record<string, unknown> };
        } else {
          merged[k] = v;
        }
      }
      chartRef.current.setOption(merged, true);
      setError(false);
    } catch {
      setError(true);
    }
  }, [option]);

  // 自适应宽度 + 卸载清理
  useEffect(() => {
    const handleResize = () => chartRef.current?.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  if (error) {
    return (
      <div
        style={{
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 'var(--font-xs)',
        }}
      >
        图表加载失败
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
