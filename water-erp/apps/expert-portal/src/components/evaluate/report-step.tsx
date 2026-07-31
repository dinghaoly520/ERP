'use client';

import { Check, AlertTriangle, BarChart3, Gavel } from 'lucide-react';
import type { EvaluationReport } from '@/lib/types';
import { CATEGORY_LABEL, CATEGORY_COLOR, isPassFailCategory } from '@water-erp/shared';

interface ReportStepProps {
  report: EvaluationReport | null;
  busy: boolean;
  onConfirmReport: () => void;
  // C2: 组长末签
  isLead?: boolean;
  leaderCoSigned?: boolean;
  allMembersConfirmed?: boolean;
  onLeaderCoSign?: () => void;
  // C3: 动议/投票
  motions?: Array<{ id: string; type: string; title: string; status: string; result?: string | null; votes?: Array<{ vote: string }> }>;
}

export function ReportStep({ report, busy, onConfirmReport, isLead, leaderCoSigned, allMembersConfirmed, onLeaderCoSign, motions }: ReportStepProps) {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--foreground)]">评审报告</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">查看评审结果汇总，确认后不可修改</p>
        </div>
        <div className="flex items-center gap-3">
          {/* C2: 组长末签按钮 */}
          {isLead && allMembersConfirmed && !leaderCoSigned && (
            <button onClick={onLeaderCoSign} disabled={busy} className="neu-btn-primary is-warning">
              {busy ? '末签中...' : <span className="inline-flex items-center gap-1.5"><Check size={14} strokeWidth={2.5} />组长末签</span>}
            </button>
          )}
          {report?.canConfirm && (
            <button onClick={onConfirmReport} disabled={busy} className="neu-btn-primary is-success">
              {busy ? '确认中...' : <span className="inline-flex items-center gap-1.5"><Check size={14} strokeWidth={2.5} />确认评审报告</span>}
            </button>
          )}
        </div>
      </div>

      {/* C2: 末签状态指示 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {leaderCoSigned && (
          <div className="exp-alert exp-alert--success flex items-center gap-2 !py-2">
            <Check size={14} strokeWidth={2} /><span className="text-sm font-semibold">组长已末签,可生成评标结果</span>
          </div>
        )}
        {isLead && !leaderCoSigned && allMembersConfirmed && (
          <div className="exp-alert exp-alert--warning flex items-center gap-2 !py-2">
            <AlertTriangle size={14} strokeWidth={2} /><span className="text-sm font-semibold">所有成员已确认,请组长末签</span>
          </div>
        )}
        {!isLead && !leaderCoSigned && allMembersConfirmed && (
          <div className="exp-alert exp-alert--info flex items-center gap-2 !py-2">
            <AlertTriangle size={14} strokeWidth={2} /><span className="text-sm">所有成员已确认,等待组长末签</span>
          </div>
        )}
      </div>

      {/* C3: 动议决议汇总 */}
      {(motions && motions.length > 0) && (
        <div className="neu-card-static mb-4 rounded-xl p-4">
          <div className="mb-3 flex items-center gap-2">
            <Gavel size={15} strokeWidth={1.8} className="text-[var(--accent)]" />
            <h3 className="text-sm font-bold text-[var(--foreground)]">委员会动议决议</h3>
            <span className="text-xs text-[var(--muted-foreground)]">{motions.length} 项</span>
          </div>
          <div className="space-y-2">
            {motions.map(m => {
              const approves = m.votes?.filter(v => v.vote === 'approve').length ?? 0;
              const rejects = m.votes?.filter(v => v.vote === 'reject').length ?? 0;
              const totalVotes = (m.votes?.length ?? 0);
              return (
                <div key={m.id} className="flex items-center justify-between rounded-lg border border-[color-mix(in_oklch,var(--foreground)_6%,transparent)] px-3 py-2">
                  <div>
                    <span className="text-sm font-semibold">{m.title}</span>
                    <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                      {m.status === 'closed' ? (m.result === 'approved' ? '✓ 通过' : m.result === 'rejected' ? '✗ 否决' : '△ 平票') : '投票中'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--success)]">赞成 {approves}</span>
                    <span className="text-[var(--danger)]">反对 {rejects}</span>
                    <span className="text-[var(--muted-foreground)]">/ {totalVotes} 票</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {report ? (
        <div className="space-y-6">
          {/* 项目概要标题卡 */}
          <div className="page-hero !gap-3">
            <div className="page-hero__row">
              <div className="page-hero__left">
                <div className="page-hero__icon"><BarChart3 size={18} strokeWidth={1.5} /></div>
                <div>
                  <div className="page-hero__title">{report.projectName}</div>
                  <div className="page-hero__sub">项目编号：{report.projectCode}</div>
                </div>
              </div>
              <div className="page-hero__right">
                <span className="page-hero__stat page-hero__stat--info">评审专家：{report.expertName}</span>
                <span className="page-hero__stat">完成度 {report.expertProgress}%</span>
              </div>
            </div>
          </div>

          {report.supplierScores.map((ss, i) => (
            <div key={i} className="neu-card-static overflow-hidden">
              <div className="flex items-center justify-between p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--accent-strong)] text-sm font-bold text-white">{i + 1}</div>
                  <h3 className="font-bold text-[var(--foreground)]">{ss.supplierName}</h3>
                  {ss.perSupplierComplete && (
                    <span className="exp-pill" style={{ '--c': 'var(--success)' } as React.CSSProperties}>评分完整</span>
                  )}
                </div>
                <div className="text-2xl font-bold text-[var(--accent-strong)]">{ss.totalScore} <span className="text-sm font-normal text-[var(--muted-foreground)]">分</span></div>
              </div>
              {Object.entries(ss.categoryScores).length > 0 && (
                <>
                  <hr className="wb-section-rule" />
                  <div className="grid grid-cols-3 gap-3 p-5">
                    {Object.entries(ss.categoryScores).map(([cat, data]) => {
                      const passFail = isPassFailCategory(cat);
                      const firstPassed = data.items[0]?.passed;
                      const catColor = CATEGORY_COLOR[cat] || 'var(--accent-strong)';
                      return (
                        <div key={cat} className="exp-category-group !p-3">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="exp-category-chip" style={{ '--cat': catColor } as React.CSSProperties} />
                            <span className="text-xs font-semibold text-[var(--foreground)]">{CATEGORY_LABEL[cat] || cat}</span>
                          </div>
                          {passFail ? (
                            <div className={`text-lg font-bold ${firstPassed === false ? 'text-[var(--danger)]' : 'text-[var(--success)]'}`}>
                              {firstPassed === false ? '不通过' : '通过'}
                            </div>
                          ) : (
                            <div className="text-lg font-bold text-[var(--foreground)]">{data.total} <span className="text-xs font-normal text-[var(--muted-foreground)]">/ {data.max}</span></div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ))}

          {!report.overallComplete && (
            <div className="exp-alert exp-alert--warn flex items-center gap-3 !p-4">
              <AlertTriangle size={14} strokeWidth={1.5} className="shrink-0" />
              <p className="!text-sm">请先完成所有供应商的评分后再确认报告</p>
            </div>
          )}
        </div>
      ) : (
        <div className="py-12 text-center text-[var(--muted-foreground)]">加载报告数据...</div>
      )}
    </div>
  );
}
