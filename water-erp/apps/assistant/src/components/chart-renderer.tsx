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
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

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
        // 深度合并 tooltip，其余字段 option 优先
        const merged: Record<string, unknown> = {
          ...BASE_OPTION,
        };
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
        chartRef.current.setOption(merged, true);
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

  return (
    <div
      style={{
        width: '100%',
        height,
        position: 'relative',
        opacity: ready ? 1 : 0,
        transition: 'opacity 0.35s ease',
      }}
    >
      {/* 骨架占位：渲染期间显示光晕脉冲 */}
      {!ready && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(37,99,235,0.15), transparent)',
              animation: 'chartPulse 1.2s ease-in-out infinite',
            }}
          />
          <style>{`@keyframes chartPulse { 0%,100% { transform:scale(0.6);opacity:0.3; } 50% { transform:scale(1.4);opacity:1; } }`}</style>
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height }} />
    </div>
  );
}
