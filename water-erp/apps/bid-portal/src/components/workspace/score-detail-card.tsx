'use client';

/**
 * #147：评分明细与汇总卡（:3007 评标管理 tab）——供应商 × 评分项聚合矩阵，
 * 移植自 :3005 归档详情 ScoreSnapshotSection（#121 口径，跨门户自包含副本）：
 * 通过性项走表决口径（通过 n/m，非数值合计）、数值项全体专家合计；尾行「专家合计」
 * 与官方评标结果总分勾稽（结果未生成时对照行不渲染）。
 *
 * 评标期匿名化兼容：按 supplier×item 聚合、不展示专家身份；专家计数取记录 expertId
 * 去重（由外层专家行注入）。仅取正选未婉拒专家的记录（与评分矩阵口径一致，候补不参与评分）。
 */

import { useMemo } from 'react';
import { ClipboardList } from 'lucide-react';
import type { BidProjectDetail } from '@/lib/types';
import type { BidEvaluationResultInfo } from '@/lib/api/evaluation';
import { EXPERT_ROLE } from '@water-erp/shared';
import type { ScoreCategory } from '@/lib/api/evaluation';

const PASS_FAIL_CATEGORIES: ScoreCategory[] = ['QUALIFICATION', 'RESPONSIVE'];

type Props = {
  project: BidProjectDetail;
  results: BidEvaluationResultInfo[];
};

export function ScoreDetailCard({ project, results }: Props) {
  const pkg = useMemo(() => {
    const defs = (project.scoreItems ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category as ScoreCategory,
      maxScore: Number(i.maxScore),
    }));
    const regularExperts = (project.experts ?? []).filter(
      (e) => e.expertRole === EXPERT_ROLE.REGULAR && e.invitationStatus !== 'declined',
    );
    const records = regularExperts.flatMap((e) =>
      (e.scoreRecords ?? []).map((r) => ({ ...r, expertId: e.id })),
    );
    if (defs.length === 0 || records.length === 0) return null;
    return { defs, records };
  }, [project]);

  if (!pkg) return null;

  const { defs, records } = pkg;
  // 供应商列序：官方结果名次序在前，其余按记录首现顺序（镜像 #121）
  const resultBySupplier = new Map(results.map((r) => [r.supplierId, r]));
  const suppliers = [
    ...results.map((r) => r.supplierId),
    ...[...new Set(records.map((r) => r.supplierId))].filter((id) => !resultBySupplier.has(id)),
  ];
  const supplierName = new Map([
    ...results.map((r) => [r.supplierId, r.supplierName] as const),
    ...(project.suppliers ?? []).map((s) => [s.id, s.supplierName] as const),
  ]);
  const supLabel = (id: string) => supplierName.get(id) ?? `供应商 ${id.slice(-6)}`;

  const pfItemIds = new Set(defs.filter((d) => PASS_FAIL_CATEGORIES.includes(d.category)).map((d) => d.id));
  // 供应商 × 评分项 聚合（各专家合计；通过性项另计表决票——专家未投票的 null 不计入分母）
  const cell = new Map<string, { sum: number; n: number; votes?: number; pass?: number }>();
  for (const r of records) {
    const key = `${r.supplierId}|${r.scoreItemId}`;
    const c = cell.get(key) ?? { sum: 0, n: 0 };
    c.sum += Number(r.score) || 0;
    c.n += 1;
    if (pfItemIds.has(r.scoreItemId) && (r.passed === true || r.passed === false)) {
      c.votes = (c.votes ?? 0) + 1;
      c.pass = (c.pass ?? 0) + (r.passed ? 1 : 0);
    }
    cell.set(key, c);
  }
  const expertCount = new Set(records.map((r) => r.expertId)).size;

  return (
    <div className="rounded-[14px] border border-[oklch(0.6_0.04_258/0.14)]">
      <div className="flex items-center justify-between border-b border-[oklch(0.6_0.04_258/0.1)] bg-[oklch(0.975_0.012_258/0.5)] px-3.5 py-2.5">
        <span className="flex items-center gap-1.5 text-[11px] font-bold text-[var(--foreground)]">
          <ClipboardList size={12} strokeWidth={1.75} className="text-[var(--accent-strong)]" />
          评分明细与汇总
        </span>
        <span className="text-[10px] text-[var(--muted-foreground)]">
          评分项 {defs.length} 项 · 评分记录 {records.length} 条 · 专家 {expertCount} 人
          {results.length > 0 ? '' : ' · 结果未生成（实时记录）'}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="neu-table is-dense w-full min-w-[560px]">
          <thead>
            <tr>
              <th className="!text-left">评分项</th>
              {suppliers.map((id) => (
                <th key={id} className="max-w-[130px] truncate !text-right" title={supLabel(id)}>{supLabel(id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {defs.map((d) => {
              const isPf = pfItemIds.has(d.id);
              return (
                <tr key={d.id}>
                  <td className="!text-left font-medium text-[var(--foreground)]">
                    {d.name}
                    {!isPf && <span className="ml-1.5 font-mono text-[10px] text-[var(--muted-foreground)]">/{d.maxScore}</span>}
                  </td>
                  {suppliers.map((sid) => {
                    const c = cell.get(`${sid}|${d.id}`);
                    return (
                      <td key={sid} className="!text-right font-mono tabular-nums" title={
                        isPf
                          ? c?.votes ? `${c.votes} 位专家表决 · 通过 ${c.pass ?? 0}` : undefined
                          : c ? `${c.n} 位专家合计` : undefined
                      }>
                        {isPf ? (
                          c?.votes ? (
                            <span className={c.pass === c.votes ? 'text-[var(--success)]' : c.pass === 0 ? 'text-[var(--danger)]' : ''}>
                              通过 {c.pass ?? 0}/{c.votes}
                            </span>
                          ) : c ? '未表决' : '—'
                        ) : (
                          c ? c.sum.toFixed(2) : '—'
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr>
              <td className="!text-left font-semibold text-[var(--foreground)]">专家合计</td>
              {suppliers.map((sid) => {
                const total = [...cell.entries()]
                  .filter(([k]) => k.startsWith(`${sid}|`))
                  .reduce((acc, [, c]) => acc + c.sum, 0);
                return (
                  <td key={sid} className="!text-right font-mono font-semibold tabular-nums text-[var(--foreground)]">{total.toFixed(2)}</td>
                );
              })}
            </tr>
            {results.length > 0 && (
              <tr>
                <td className="!text-left text-[var(--muted-foreground)]">评标结果总分（对照）</td>
                {suppliers.map((sid) => {
                  const r = resultBySupplier.get(sid);
                  return (
                    <td key={sid} className="!text-right font-mono tabular-nums text-[var(--muted-foreground)]">
                      {r ? Number(r.totalScore).toFixed(2) : '—'}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
        <div className="border-t border-[oklch(0.6_0.04_258/0.08)] px-3.5 py-2 text-[10px] text-[var(--muted-foreground)]">
          矩阵为各评分项正选专家合计分；{results.length > 0 ? '末两行应一致（勾稽校验）' : '官方结果生成后将附总分对照（勾稽校验）'}
        </div>
      </div>
    </div>
  );
}
