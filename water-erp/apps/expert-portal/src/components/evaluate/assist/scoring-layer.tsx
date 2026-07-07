'use client';

import { AlertCircle, TrendingUp, Lightbulb, MessageSquare, Edit3 } from 'lucide-react';
import type { AssistData, AiScoreItem, BidScoreItem } from '@water-erp/shared';
import { CollapsibleSection } from './shared/collapsible-section';
import { SectionHeader } from './shared/section-header';
import { SwCard, type SwItem } from './shared/sw-card';
import { ScoreBreakdownBars, CATEGORY_LABEL } from './charts/score-breakdown-bars';

const TAG = { objectivePrice: '客观·公式', subjective: '主观·AI 建议', summary: 'AI 综合' };

// ── Tag ──

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[oklch(0.94_0.004_264)] text-[oklch(0.45_0.01_264)]">
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
        <Warn cls="amber">
          有 {low.length} 项评分置信度较低（&lt;60%），建议人工重点复核。
        </Warn>
      )}
      {unstable.length > 0 && (
        <Warn cls="orange">
          有 {unstable.length} 项评分多次采样差异大（AI 把握度低），请重点复核。
        </Warn>
      )}
    </>
  );
}

function Warn({ cls, children }: { cls: 'amber' | 'orange'; children: React.ReactNode }) {
  const c =
    cls === 'amber'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-orange-200 bg-orange-50 text-orange-700';
  return (
    <div className={`p-2.5 rounded-lg border ${c} text-[11px] flex items-start gap-1.5`}>
      <AlertCircle size={12} className="mt-px shrink-0" />
      {children}
    </div>
  );
}

// ── ClauseEvidence ──

function ClauseEvidence({ resp }: { resp: AssistData['requirementResponses'] }) {
  if (!resp || !resp.length) return null;
  const bad = resp
    .filter((r) => r.status === 'unmet' || r.status === 'partial' || r.status === 'not_found')
    .slice(0, 3);
  if (!bad.length) return null;
  return (
    <div className="rounded-lg border border-[oklch(0.91_0.006_264)] bg-[oklch(0.985_0.002_264)] p-2.5">
      <div className="text-[10px] font-semibold text-[oklch(0.45_0.01_264)] mb-1">条款响应佐证</div>
      {bad.map((r, i) => (
        <div key={i} className="text-[11px] text-[oklch(0.35_0.01_264)] truncate" title={r.excerpt}>
          · {r.excerpt || r.requirementId}
          {r.location ? `（第${r.location.page}页）` : ''}
        </div>
      ))}
    </div>
  );
}

// ── ExpertComparisonTable（含理由对照列）──

function ExpertComparisonTable({
  myScoredItems,
  scoreItems,
  expertScores,
  activeSupplier,
}: {
  myScoredItems: BidScoreItem[];
  scoreItems: AiScoreItem[];
  expertScores: Record<string, { score: number; reason: string }>;
  activeSupplier: string;
}) {
  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Edit3 size={14} strokeWidth={1.5} className="text-[var(--color-primary)]" />
        <h4 className="font-bold text-sm text-[var(--color-text)]">AI 建议 vs 您的评分</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--color-text-tertiary)] border-b border-[oklch(0.91_0.006_264)]">
              <th className="text-left pb-2 font-medium">评分项</th>
              <th className="text-right pb-2 font-medium">AI 建议</th>
              <th className="text-right pb-2 font-medium">您的评分</th>
              <th className="text-right pb-2 font-medium">偏差</th>
              <th className="text-left pb-2 font-medium">理由对照</th>
            </tr>
          </thead>
          <tbody>
            {myScoredItems.map((si) => {
              const aiItem = scoreItems.find((a) => a.scoreItemId === si.id);
              const myScore = expertScores[`${activeSupplier}:${si.id}`];
              const aiScore = aiItem ? Number(aiItem.score) : null;
              const diff = aiScore != null ? Number(myScore.score) - aiScore : null;
              return (
                <tr key={si.id} className="border-b border-[oklch(0.94_0.004_264)] last:border-0">
                  <td className="py-2 text-[var(--color-text-secondary)]">{si.name}</td>
                  <td className="py-2 text-right text-[var(--color-primary)] font-semibold">
                    {aiScore != null ? aiScore.toFixed(1) : '—'}
                  </td>
                  <td className="py-2 text-right font-bold text-[var(--color-text)]">
                    {Number(myScore.score).toFixed(1)}
                  </td>
                  <td
                    className={`py-2 text-right text-xs font-semibold ${
                      diff != null && Math.abs(diff) >= 2
                        ? 'text-[var(--color-danger)]'
                        : diff != null && Math.abs(diff) >= 1
                          ? 'text-[var(--color-warning)]'
                          : 'text-[var(--color-success)]'
                    }`}
                  >
                    {diff != null ? (diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)) : '—'}
                  </td>
                  <td className="py-2 text-[11px] text-[var(--color-text-tertiary)] max-w-[200px]">
                    <div className="truncate" title={aiItem?.reason}>
                      AI：{aiItem?.reason ?? '—'}
                    </div>
                    <div className="truncate" title={myScore?.reason}>
                      我：{myScore?.reason ?? '—'}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--color-text-tertiary)] mt-2">
        偏差 ≥2 分标红，≥1 分标黄，建议复核相应评分依据。
      </p>
    </div>
  );
}

// ── Summary ──

function Summary({ assistData }: { assistData: AssistData }) {
  const obs = assistData.keyObservations ?? [];
  const s = (assistData.strengths as SwItem[] | null) ?? [];
  const w = (assistData.weaknesses as SwItem[] | null) ?? [];
  return (
    <div className="glass-card rounded-xl p-4 space-y-3">
      <Tag>{TAG.summary}</Tag>
      {obs.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5 text-sm font-bold text-[var(--color-primary)]">
            <Lightbulb size={13} /> 关键观察
          </div>
          <ol className="space-y-1">
            {obs.map((o, i) => (
              <li key={i} className="text-xs flex gap-1.5">
                <span className="font-bold">{i + 1}.</span>
                {o}
              </li>
            ))}
          </ol>
        </div>
      )}
      {s.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-1 text-sm font-bold">
            <TrendingUp size={13} className="text-emerald-500" />
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
          <div className="flex items-center gap-1.5 mb-1 text-sm font-bold">
            <AlertCircle size={13} className="text-amber-500" />
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
          <div className="flex items-center gap-1.5 mb-1 text-sm font-bold">
            <MessageSquare size={13} />
            AI 分析评语
          </div>
          <p className="text-xs leading-relaxed text-[var(--color-text-secondary)]">
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
  expertScores,
  activeSupplier,
  projectScoreItems,
}: {
  assistData: AssistData;
  expertScores: Record<string, { score: number; reason: string }>;
  activeSupplier: string;
  projectScoreItems: BidScoreItem[];
}) {
  const items = assistData.scoreItems ?? [];
  const price = items.filter((i) => i.category === 'PRICE');
  const subjective = items.filter((i) => i.category === 'BUSINESS' || i.category === 'TECHNICAL');

  // 专家已打分项（用于偏差表门控）
  const myScoredItems = projectScoreItems.filter((si) => {
    const key = `${activeSupplier}:${si.id}`;
    return expertScores[key] && !['QUALIFICATION', 'RESPONSIVE', 'PRICE'].includes(si.category);
  });
  const hasComparison = !!(activeSupplier && subjective.length > 0 && myScoredItems.length > 0);

  return (
    <section className="space-y-4">
      <SectionHeader number={3} title="打分" />

      {/* ③a 客观·价格 */}
      {price.length > 0 && (
        <div className="glass-card rounded-xl p-4">
          <Tag>{TAG.objectivePrice}</Tag>
          <div className="mt-2">
            <ScoreBreakdownBars scoreItems={price} flat reasonLines={2} />
          </div>
          {/* 不显 confidence/unstable（客观公式项） */}
        </div>
      )}

      {/* ③b 主观·商务/技术（默认展开） */}
      {subjective.length > 0 && (
        <div className="glass-card rounded-xl p-4 space-y-3">
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
                accent={cat === 'BUSINESS' ? '#f5a623' : '#11a874'}
                summary={
                  <ScoreBreakdownBars scoreItems={sub} flat reasonLines={2} />
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
          {/* AI vs 专家偏差表（回看才出现） */}
          {hasComparison && (
            <ExpertComparisonTable
              myScoredItems={myScoredItems}
              scoreItems={subjective}
              expertScores={expertScores}
              activeSupplier={activeSupplier}
            />
          )}
        </div>
      )}

      {/* ③c 综合 */}
      <Summary assistData={assistData} />
    </section>
  );
}
