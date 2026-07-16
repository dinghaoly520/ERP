'use client';

import { useEffect, useState } from 'react';
import { getSupplierPortraitAnalysis } from '@/lib/api/supplier';
import type { SupplierPortraitAnalysis, PortraitInsight } from '@/lib/api/supplier';
import { Loader2, Brain, Sparkles, ShieldCheck, Award, FolderKanban, CheckCircle2, TrendingUp, TrendingDown, Minus, AlertTriangle, Lightbulb, Target } from 'lucide-react';

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  ShieldCheck, Award, FolderKanban, CheckCircle2, TrendingUp, TrendingDown, Minus, AlertTriangle, Lightbulb,
};

const TONE_COLORS: Record<string, string> = {
  success: 'var(--success)',
  warning: 'var(--warning)',
  accent: 'var(--accent)',
  danger: 'var(--danger)',
};

export function PortraitTab({ supplierId }: { supplierId: string }) {
  const [data, setData] = useState<SupplierPortraitAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getSupplierPortraitAnalysis(supplierId)
      .then(setData)
      .catch((e) => setError(e?.message || '分析失败'))
      .finally(() => setLoading(false));
  }, [supplierId]);

  if (loading) return (
    <div className="py-10 text-center text-sm text-[var(--muted-foreground)]">
      <Brain size={22} className="mx-auto mb-3 text-[var(--accent)] anima te-pulse" />
      <p>AI 正在分析供应商综合画像…</p>
      <p className="text-xs text-[var(--muted-foreground)]/60 mt-1">基于资质、评价、项目参与等多维度数据</p>
    </div>
  );

  if (error) return (
    <div className="py-10 text-center text-sm text-[var(--danger)]">
      <AlertTriangle size={22} className="mx-auto mb-3 opacity-50" />
      <p>画像分析暂时不可用</p>
      <p className="text-xs text-[var(--muted-foreground)]/60 mt-1">{error}</p>
    </div>
  );

  if (!data) return <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">无法加载画像数据</p>;

  return (
    <div className="space-y-5">
      {/* ══ 综合评价 ══ */}
      <div className="neu-card-static !rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Brain size={15} className="text-[var(--accent)]" />
          <h3 className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">AI 综合评价</h3>
          <Sparkles size={12} className="text-[var(--accent)]/50" />
        </div>
        <p className="text-sm text-[var(--foreground)] leading-relaxed">{data.overview}</p>
      </div>

      {/* ══ 关键指标卡片 ══ */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {data.metrics.map((m: PortraitInsight) => {
          const IconComp = ICON_MAP[m.icon] || CheckCircle2;
          const tone = TONE_COLORS[m.tone] || 'var(--accent)';
          return (
            <div key={m.label} className="neu-card-static !rounded-2xl p-4 text-center">
              <div className="neu-icon-well flex h-9 w-9 mx-auto items-center justify-center rounded-[10px] mb-2">
                <IconComp size={15} style={{ color: tone }} />
              </div>
              <div className="text-[11px] text-[var(--muted-foreground)] mb-0.5">{m.label}</div>
              <div className="text-lg font-extrabold tabular-nums text-[var(--foreground)]">{m.value}</div>
              <div className="text-[10px] text-[var(--muted-foreground)]/60 mt-0.5">{m.interpretation}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ══ 优势 / 风险 / 建议 ══ */}
        <div className="space-y-4">
          <SectionCard icon={<TrendingUp size={13} className="text-[var(--success)]" />} title="优势" tone="var(--success)">
            <ul className="space-y-1.5">
              {data.strengths.length === 0 ? <li className="text-xs text-[var(--muted-foreground)]">暂无显著优势</li> : data.strengths.map((s, i) => (
                <li key={i} className="text-xs text-[var(--muted-foreground)] flex items-start gap-1.5">
                  <span className="mt-1 h-1 w-1 rounded-full flex-shrink-0 bg-[var(--success)]" />{s}
                </li>
              ))}
            </ul>
          </SectionCard>

          {data.suitableFor.length > 0 && (
            <SectionCard icon={<Target size={13} className="text-[var(--accent)]" />} title="适合项目类型" tone="var(--accent)">
              <div className="flex flex-wrap gap-1.5">
                {data.suitableFor.map((s, i) => (
                  <span key={i} className="rounded-md bg-[var(--accent)]/10 px-2 py-1 text-[10px] font-semibold text-[var(--accent)]">{s}</span>
                ))}
              </div>
            </SectionCard>
          )}
        </div>

        <div className="space-y-4">
          <SectionCard icon={<AlertTriangle size={13} className="text-[var(--warning)]" />} title="风险点" tone="var(--warning)">
            <ul className="space-y-1.5">
              {data.risks.length === 0 ? <li className="text-xs text-[var(--muted-foreground)]">当前无显著风险项</li> : data.risks.map((r, i) => (
                <li key={i} className="text-xs text-[var(--muted-foreground)] flex items-start gap-1.5">
                  <span className="mt-1 h-1 w-1 rounded-full flex-shrink-0 bg-[var(--warning)]" />{r}
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard icon={<Lightbulb size={13} className="text-[var(--accent)]" />} title="改进建议" tone="var(--accent)">
            <ul className="space-y-1.5">
              {data.suggestions.length === 0 ? <li className="text-xs text-[var(--muted-foreground)]">暂无改进建议</li> : data.suggestions.map((s, i) => (
                <li key={i} className="text-xs text-[var(--muted-foreground)] flex items-start gap-1.5">
                  <span className="mt-1 h-1 w-1 rounded-full flex-shrink-0 bg-[var(--accent)]" />{s}
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      </div>

      {/* ══ 历史趋势 ══ */}
      <div className="neu-card-static !rounded-2xl p-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">评价趋势</h4>
        <p className="text-xs text-[var(--muted-foreground)] leading-relaxed">{data.historySummary || '暂无评价记录'}</p>
      </div>
    </div>
  );
}

function SectionCard({ icon, title, children, tone }: { icon: React.ReactNode; title: string; children: React.ReactNode; tone: string }) {
  return (
    <div className="neu-card-static !rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h4 className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: tone }}>{title}</h4>
      </div>
      {children}
    </div>
  );
}
