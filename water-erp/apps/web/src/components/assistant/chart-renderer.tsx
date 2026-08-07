'use client';

import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { BASE_OPTION } from './echarts-theme';

export function ChartRenderer({
  option,
  height = 280,
}: {
  option: Record<string, unknown>;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const focusedRef = useRef(false);

  // 图表点击聚焦交互：点击元素高亮，其余淡化；再点恢复
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const handleClick = (params: { dataIndex?: number; seriesIndex?: number; name?: string }) => {
      if (params.dataIndex === undefined) return;
      if (focusedRef.current) {
        chart.dispatchAction({ type: 'restore' });
        focusedRef.current = false;
      } else {
        const opt = chart.getOption() as Record<string, unknown>;
        const seriesList = (opt.series as unknown[]) || [];
        for (let si = 0; si < seriesList.length; si++) {
          const dataLen = ((seriesList[si] as Record<string, unknown>)?.data as unknown[])?.length || 0;
          for (let di = 0; di < dataLen; di++) {
            if (si === params.seriesIndex && di === params.dataIndex) continue;
            chart.dispatchAction({ type: 'downplay', seriesIndex: si, dataIndex: di });
          }
        }
        chart.dispatchAction({ type: 'highlight', seriesIndex: params.seriesIndex, dataIndex: params.dataIndex });
        focusedRef.current = true;
      }
    };

    chart.on('click', handleClick);
    return () => {
      chart.off('click', handleClick);
    };
  }, [ready]);

  useEffect(() => {
    if (!containerRef.current) return;
    setReady(false);

    const timer = requestAnimationFrame(() => {
      try {
        if (!chartRef.current) {
          chartRef.current = echarts.init(containerRef.current!, undefined, {
            devicePixelRatio: window.devicePixelRatio || 1,
          });
        }
        const merged: Record<string, unknown> = { ...BASE_OPTION };
        for (const [k, v] of Object.entries(option)) {
          if (k === 'tooltip' && v && typeof v === 'object' && !Array.isArray(v)) {
            merged.tooltip = {
              ...(BASE_OPTION.tooltip as Record<string, unknown>),
              ...(v as Record<string, unknown>),
            };
          } else {
            merged[k] = v;
          }
        }
        chartRef.current.setOption(
          {
            ...merged,
            series: ((merged.series as unknown[]) || []).map((s: any) => ({
              ...s,
              emphasis: s.emphasis || { scale: true },
              select: { disabled: true },
              ...(!s.type?.includes('line') && {
                itemStyle: { ...(s.itemStyle || {}), opacity: 1 },
              }),
            })),
            stateAnimation: { duration: 250, easing: 'cubicOut' },
          } as any,
          true,
        );
        chartRef.current.dispatchAction({ type: 'restore' });
        focusedRef.current = false;
        setReady(true);
        setError(false);
      } catch {
        setError(true);
        setReady(true);
      }
    });

    return () => cancelAnimationFrame(timer);
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
      <div className="asst-chart-error">
        图表加载失败
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height, position: 'relative', opacity: ready ? 1 : 0, transition: 'opacity 0.35s ease' }}>
      {!ready && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(37,99,235,0.15), transparent)',
            animation: 'chartPulse 1.2s ease-in-out infinite',
          }} />
          <style>{`@keyframes chartPulse { 0%,100% { transform:scale(0.6);opacity:0.3; } 50% { transform:scale(1.4);opacity:1; } }`}</style>
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height }} />
    </div>
  );
}
