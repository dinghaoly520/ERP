'use client';

import { useState } from 'react';
import { AlertCircle, TrendingUp, Lightbulb, MessageSquare } from 'lucide-react';
import type { AssistData, AiScoreItem } from '@water-erp/shared';
import { CollapsibleSection } from './shared/collapsible-section';
import { SectionHeader } from './shared/section-header';
import { SwCard, type SwItem } from './shared/sw-card';
import { ScoreBreakdownBars, CATEGORY_LABEL } from './charts/score-breakdown-bars';

const TAG = { objectivePrice: '客观·公式', subjective: '主观·AI 建议', summary: 'AI 综合' };

// ── Tag ──

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="exp-pill" style={{ '--c': 'var(--muted-foreground)' } as React.CSSProperties}>
      {children}
    </span>
  );
}

// ── ConfidenceWarnings（仅 BUSINESS + TECHNICAL，不含 PRICE）──

function ConfidenceWarnings({ items }: { items: AiScoreItem[] }) {
  const low = items.filter((i) => i.confidence != null && i.confidence < 0.6);
  const unstable = items.filter((i) => i.unstable);
  return (
    <>
      {low.length > 0 && (
        <Warn>
          有 {low.length} 项评分置信度较低（&lt;60%），建议人工重点复核。
        </Warn>
      )}
      {unstable.length > 0 && (
        <Warn>
          有 {unstable.length} 项评分多次采样差异大（AI 把握度低），请重点复核。
        </Warn>
      )}
    </>
  );
}

function Warn({ children }: { children: React.ReactNode }) {
  return (
    <div className="exp-alert exp-alert--warn flex items-start gap-1.5 !text-[11px]">
      <AlertCircle size={12} className="mt-px shrink-0" />
      {children}
    </div>
  );
}

// ── ClauseEvidence ──

const EVIDENCE_PREVIEW = 3;

function ClauseEvidence({ resp }: { resp: AssistData['requirementResponses'] }) {
  const [showAll, setShowAll] = useState(false);
  if (!resp || !resp.length) return null;
  const bad = resp.filter((r) => r.status === 'unmet' || r.status === 'partial' || r.status === 'not_found');
  if (!bad.length) return null;
  const shown = showAll ? bad : bad.slice(0, EVIDENCE_PREVIEW);
  return (
    <div className="neu-card-static !rounded-[12px] p-2.5">
      <div className="mb-1 text-[10px] font-semibold text-[var(--muted-foreground)]">条款响应佐证</div>
      {shown.map((r, i) => (
        <div key={i} className="truncate text-[11px] text-[var(--foreground)]" title={r.excerpt}>
          · {r.excerpt || '（条款原文未提取，请核对招标文件）'}
          {r.location ? `（第${r.location.page}页）` : ''}
        </div>
      ))}
      {bad.length > EVIDENCE_PREVIEW && (
        <button onClick={() => setShowAll(v => !v)} className="mt-1 text-[11px] text-[var(--accent-strong)] hover:underline">
          {showAll ? '收起' : `展开全部 ${bad.length} 项`}
        </button>
      )}
    </div>
  );
}

// ── Summary ──

function Summary({ assistData }: { assistData: AssistData }) {
  const obs = assistData.keyObservations ?? [];
  const s = (assistData.strengths as SwItem[] | null) ?? [];
  const w = (assistData.weaknesses as SwItem[] | null) ?? [];
  return (
    <div className="neu-card-static space-y-3 p-4">
      <Tag>{TAG.summary}</Tag>
      {obs.length > 0 && (
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-[var(--accent-strong)]">
            <Lightbulb size={13} /> 关键观察
          </div>
          <ol className="space-y-1">
            {obs.map((o, i) => (
              <li key={i} className="flex gap-1.5 text-xs">
                <span className="font-bold">{i + 1}.</span>
                {o}
              </li>
            ))}
          </ol>
        </div>
      )}
      {s.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-sm font-bold">
            <TrendingUp size={13} className="text-[var(--success)]" />
            正向依据（{s.length}）
          </div>
          <div className="space-y-1.5">
            {s.map((x, i) => (
              <SwCard key={i} item={x} type="strength" />
            ))}
          </div>
        </div>
      )}
      {w.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-sm font-bold">
            <AlertCircle size={13} className="text-[var(--warning)]" />
            需关注事项（{w.length}）
          </div>
          <div className="space-y-1.5">
            {w.map((x, i) => (
              <SwCard key={i} item={x} type="weakness" />
            ))}
          </div>
        </div>
      )}
      {assistData.overallComment && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-sm font-bold">
            <MessageSquare size={13} />
            AI 分析评语
          </div>
          <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
            {assistData.overallComment}
          </p>
        </div>
      )}
    </div>
  );
}

// ── ScoringLayer ──

export function ScoringLayer({
  assistData,
}: {
  assistData: AssistData;
}) {
  const items = assistData.scoreItems ?? [];
  const price = items.filter((i) => i.category === 'PRICE');
  const subjective = items.filter((i) => i.category === 'BUSINESS' || i.category === 'TECHNICAL');

  return (
    <section className="space-y-4">
      <SectionHeader number={3} title="打分" />

      {/* ③a 客观·价格 */}
      {price.length > 0 && (
        <div className="neu-card-static p-4">
          <Tag>{TAG.objectivePrice}</Tag>
          <div className="mt-2">
            <ScoreBreakdownBars scoreItems={price} flat reasonLines={2} />
          </div>
          {/* 不显 confidence/unstable（客观公式项） */}
        </div>
      )}

      {/* ③b 主观·商务/技术（默认展开） */}
      {subjective.length > 0 && (
        <div className="neu-card-static space-y-3 p-4">
          <Tag>{TAG.subjective}</Tag>
          {/* 单项 confidence/unstable 警告（仅 BUSINESS+TECHNICAL，不含 PRICE） */}
          <ConfidenceWarnings items={subjective} />
          {/* 按 category 默认展开折叠组 */}
          {['BUSINESS', 'TECHNICAL'].map((cat) => {
            const sub = subjective.filter((i) => i.category === cat);
            if (!sub.length) return null;
            return (
              <CollapsibleSection
                key={cat}
                defaultOpen
                title={CATEGORY_LABEL[cat] ?? cat}
                accent={cat === 'BUSINESS' ? 'var(--warning)' : 'var(--success)'}
                summary={
                  <ScoreBreakdownBars scoreItems={sub} flat reasonLines={2} expandable />
                }
              />
            );
          })}
          {/* 条款佐证（技术/商务 requirementResponses） */}
          <ClauseEvidence
            resp={(assistData.requirementResponses ?? []).filter(
              (r) => r.category === 'technical' || r.category === 'commercial',
            )}
          />
        </div>
      )}

      {/* ③c 综合 */}
      <Summary assistData={assistData} />
    </section>
  );
}
