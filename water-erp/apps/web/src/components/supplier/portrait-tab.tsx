'use client';

import { useEffect, useState, useCallback } from 'react';
import { getSupplierPortraitAnalysis } from '@/lib/api/supplier';
import type { SupplierPortraitAnalysis } from '@/lib/api/supplier';
import { Loader2, Brain, Sparkles, RefreshCw, AlertTriangle } from 'lucide-react';

export function PortraitTab({ supplierId }: { supplierId: string }) {
  const [data, setData] = useState<SupplierPortraitAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const fetchPortrait = useCallback((forceRefresh = false) => {
    const isFirstLoad = !data;
    if (isFirstLoad) setLoading(true);
    else setRefreshing(true);
    setError('');

    getSupplierPortraitAnalysis(supplierId, forceRefresh)
      .then(setData)
      .catch((e) => setError(e?.message || '分析失败'))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, [supplierId, data]);

  useEffect(() => {
    fetchPortrait();
  }, [supplierId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return (
    <div className="py-12 text-center">
      <Loader2 size={22} className="animate-spin mx-auto mb-3 text-[var(--accent)]" />
      <p className="text-sm text-[var(--muted-foreground)]">AI 正在分析供应商综合画像…</p>
    </div>
  );

  if (error) return (
    <div className="py-10 text-center">
      <AlertTriangle size={22} className="mx-auto mb-3 text-[var(--warning)] opacity-60" />
      <p className="text-sm text-[var(--danger)]">画像分析暂时不可用</p>
      <p className="text-xs text-[var(--muted-foreground)]/60 mt-1 mb-4">{error}</p>
      <button onClick={() => fetchPortrait(true)} className="neu-btn-xs">重试</button>
    </div>
  );

  if (!data) return <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">无法加载画像数据</p>;

  return (
    <div className="space-y-5">
      {/* ══ 标题栏 + 刷新按钮 ══ */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={15} className="text-[var(--accent)]" />
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
            供应商综合画像
          </h3>
          <Sparkles size={12} className="text-[var(--accent)]/50" />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-[var(--muted-foreground)]/50">
            {new Date(data.analyzedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
          </span>
          <button
            onClick={() => fetchPortrait(true)}
            disabled={refreshing}
            className="neu-btn-xs flex items-center gap-1"
          >
            <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? '刷新中…' : '刷新画像'}
          </button>
        </div>
      </div>

      {/* ══ 纯文本概述 ══ */}
      <div className="neu-card-static !rounded-2xl p-6">
        <p className="text-sm text-[var(--foreground)] leading-[1.85] whitespace-pre-line">
          {data.overview}
        </p>
      </div>

      {/* ══ 优势 ══ */}
      {data.strengths.length > 0 && (
        <div className="neu-card-static !rounded-2xl p-5">
          <p className="text-sm text-[var(--foreground)] leading-[1.85]">
            <span className="font-semibold text-[var(--success)]">优势：</span>
            {data.strengths.join('；')}。
          </p>
        </div>
      )}

      {/* ══ 风险与建议（同一卡片） ══ */}
      {data.risks.length > 0 && (
        <div className="neu-card-static !rounded-2xl p-5">
          <p className="text-sm text-[var(--foreground)] leading-[1.85]">
            <span className="font-semibold text-[var(--warning)]">需关注：</span>
            {data.risks.join('；')}。
          </p>
          {data.suggestions.length > 0 && (
            <p className="text-sm text-[var(--foreground)] leading-[1.85] mt-3 pt-3 border-t border-[var(--border)]">
              <span className="font-semibold text-[var(--accent)]">改进方向：</span>
              {data.suggestions.join('；')}。
            </p>
          )}
        </div>
      )}

      {/* ══ 适合项目类型 ══ */}
      {data.suitableFor.length > 0 && (
        <div className="neu-card-static !rounded-2xl p-5">
          <p className="text-sm text-[var(--foreground)] leading-[1.85]">
            <span className="font-semibold text-[var(--muted-foreground)]">适合参与的项目类型：</span>
            {data.suitableFor.join('、')}。
          </p>
        </div>
      )}

      {/* ══ 评价趋势 ══ */}
      <div className="neu-card-static !rounded-2xl p-5">
        <p className="text-sm text-[var(--foreground)] leading-[1.85]">
          <span className="font-semibold text-[var(--muted-foreground)]">评价趋势：</span>
          {data.historySummary || '暂无评价记录'}
        </p>
      </div>
    </div>
  );
}
