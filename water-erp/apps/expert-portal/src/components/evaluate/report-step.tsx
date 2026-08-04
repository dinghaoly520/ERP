'use client';

import { Check, AlertTriangle, BarChart3, Gavel, ClipboardList } from 'lucide-react';
import type { EvaluationReport } from '@/lib/types';
import { CATEGORY_LABEL, CATEGORY_COLOR, isPassFailCategory } from '@water-erp/shared';

interface MotionItem {
  id: string; title: string; description?: string | null;
  status: string; result?: string | null;
  votes: Array<{ expertId: string; vote: string }>;
}
interface DisputeItem {
  id: string; title: string; expertName: string;
  status: string; response?: string | null;
}

interface ReportStepProps {
  report: EvaluationReport | null;
  busy: boolean;
  onConfirmReport: () => void;
  isLead?: boolean;
  leaderCoSigned?: boolean;
  allMembersConfirmed?: boolean;
  onLeaderCoSign?: () => void;
  motions?: MotionItem[];
  disputes?: DisputeItem[];
  myExpertId?: string;
}

const VOTE_LABEL: Record<string, string> = { approve: '赞成', reject: '反对', abstain: '弃权' };

export function ReportStep({ report, busy, onConfirmReport, isLead, leaderCoSigned, allMembersConfirmed, onLeaderCoSign, motions = [], disputes = [], myExpertId }: ReportStepProps) {
  // 个人异议标注按 supplierName 分组（嵌入对应供应商卡片）
  const disputedBySupplier = new Map<string, EvaluationReport['myDisputedReviews']>();
  if (report?.myDisputedReviews) {
    for (const d of report.myDisputedReviews) {
      const arr = disputedBySupplier.get(d.supplierName) ?? [];
      arr.push(d);
      disputedBySupplier.set(d.supplierName, arr);
    }
  }

  const hasMotions = motions.length > 0;
  const hasDisputes = disputes.length > 0;

  return (
    <div className="mx-auto max-w-4xl p-6">
      {/* ── ① 操作栏 ── */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[var(--foreground)]">评审报告</h2>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">查看评审结果汇总，确认后不可修改</p>
        </div>
        <div className="flex items-center gap-3">
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

      {/* 末签状态提示 */}
      {(leaderCoSigned || (allMembersConfirmed && !leaderCoSigned)) && (
        <div className="mb-4">
          {leaderCoSigned && (
            <div className="exp-alert exp-alert--success flex items-center gap-2 !py-2">
              <Check size={14} strokeWidth={2} /><span className="text-sm font-semibold">组长已末签，可生成评标结果</span>
            </div>
          )}
          {isLead && !leaderCoSigned && allMembersConfirmed && (
            <div className="exp-alert exp-alert--warning flex items-center gap-2 !py-2">
              <AlertTriangle size={14} strokeWidth={2} /><span className="text-sm font-semibold">所有成员已确认，请组长末签</span>
            </div>
          )}
          {!isLead && !leaderCoSigned && allMembersConfirmed && (
            <div className="exp-alert exp-alert--info flex items-center gap-2 !py-2">
              <AlertTriangle size={14} strokeWidth={2} /><span className="text-sm">所有成员已确认，等待组长末签</span>
            </div>
          )}
        </div>
      )}

      {/* ── ② 评分结果汇总（核心）── */}
      {report ? (
        <div className="space-y-4">
          {/* 项目概要 */}
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

          {/* 按供应商展示评分 + 该供应商的异议条款标注 */}
          {report.supplierScores.map((ss, i) => {
            const supplierDisputes = disputedBySupplier.get(ss.supplierName) ?? [];
            return (
              <div key={i} className="neu-card-static overflow-hidden">
                {/* 供应商头部 + 总分 */}
                <div className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--accent-strong)] text-sm font-bold text-white">{i + 1}</div>
                    <h3 className="font-bold text-[var(--foreground)]">{ss.supplierName}</h3>
                    {ss.perSupplierComplete && (
                      <span className="exp-pill" style={{ '--c': 'var(--success)' } as React.CSSProperties}>评分完整</span>
                    )}
                    {supplierDisputes.length > 0 && (
                      <span className="exp-pill" style={{ '--c': 'var(--warning)' } as React.CSSProperties}>
                        <AlertTriangle size={10} strokeWidth={2.4} className="mr-0.5" />{supplierDisputes.length} 条异议标注
                      </span>
                    )}
                  </div>
                  <div className="text-2xl font-bold text-[var(--accent-strong)]">{ss.totalScore} <span className="text-sm font-normal text-[var(--muted-foreground)]">分</span></div>
                </div>

                {/* 类别明细 */}
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

                {/* 该供应商的异议条款标注（嵌入，有上下文） */}
                {supplierDisputes.length > 0 && (
                  <div className="border-t border-[color-mix(in_oklch,var(--foreground)_4%,transparent)] bg-[color-mix(in_oklch,var(--warning)_4%,transparent)] px-5 py-3">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-[var(--warning)]">
                      <AlertTriangle size={12} strokeWidth={2} /> 异议条款标注
                    </div>
                    <div className="space-y-1.5">
                      {supplierDisputes.map((d, j) => (
                        <div key={j} className="text-xs">
                          <span className="font-semibold text-[var(--foreground)]">{d.requirementId}</span>
                          {d.note && <span className="ml-1.5 text-[var(--warning)]">{d.note}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

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

      {/* ── ③ 委员会记录（只读附录）── */}
      {(hasMotions || hasDisputes) && (
        <div className="mt-8 space-y-3">
          <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
            <ClipboardList size={14} strokeWidth={1.5} />
            <span className="text-xs font-bold tracking-wide uppercase">委员会记录</span>
            <div className="h-px flex-1 bg-[color-mix(in_oklch,var(--foreground)_8%,transparent)]" />
          </div>

          {/* 表决记录 */}
          {hasMotions && (
            <div className="space-y-2">
              {motions.map(m => {
                const approves = m.votes?.filter(v => v.vote === 'approve').length ?? 0;
                const rejects = m.votes?.filter(v => v.vote === 'reject').length ?? 0;
                const totalVotes = m.votes?.length ?? 0;
                const myVote = m.votes?.find(v => v.expertId === myExpertId)?.vote;
                const isClosed = m.status === 'closed';
                return (
                  <div key={m.id} className={`neu-card-static rounded-xl p-3 ${isClosed ? 'opacity-60' : ''}`}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Gavel size={12} strokeWidth={1.8} className="text-[var(--accent)]" />
                        <span className="text-sm font-bold">{m.title}</span>
                      </div>
                      <span className={`text-[10px] font-bold ${
                        m.status === 'voting' ? 'text-[var(--accent)]'
                        : m.result === 'approved' ? 'text-[var(--success)]'
                        : m.result === 'rejected' ? 'text-[var(--danger)]'
                        : 'text-[var(--muted-foreground)]'
                      }`}>
                        {m.status === 'voting' ? '投票中' : m.result === 'approved' ? '✓ 通过' : m.result === 'rejected' ? '✗ 否决' : '△ 平票'}
                      </span>
                    </div>
                    {m.description && <p className="mb-1 text-[11px] text-[var(--muted-foreground)]">{m.description}</p>}
                    <div className="flex items-center gap-3 text-[10px] tabular-nums text-[var(--muted-foreground)]">
                      <span className="text-[var(--success)]">赞成 {approves}</span>
                      <span className="text-[var(--danger)]">反对 {rejects}</span>
                      <span>/ {totalVotes} 票</span>
                      {myVote && <span className="ml-auto">本人：{VOTE_LABEL[myVote] ?? myVote}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 异议工单 */}
          {hasDisputes && (
            <div className="space-y-2">
              {disputes.map(d => {
                const isOpen = d.status === 'open';
                return (
                  <div key={d.id} className={`neu-card-static rounded-xl p-3 ${isOpen ? '' : 'opacity-60'}`}>
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-2">
                        <AlertTriangle size={12} strokeWidth={1.8} className="text-[var(--warning)]" />
                        <span className="text-sm font-bold">{d.title}</span>
                      </div>
                      <span className={`text-[10px] font-bold ${
                        isOpen ? 'text-[var(--warning)]' : d.status === 'resolved' ? 'text-[var(--success)]' : 'text-[var(--danger)]'
                      }`}>
                        {isOpen ? '待裁决' : d.status === 'resolved' ? '已采纳' : '已驳回'}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--muted-foreground)]">
                      提交人：{d.expertName}
                      {d.response && <span className="ml-2">· 裁决：{d.response}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-[10px] text-[var(--muted-foreground)] opacity-60">
            表决发起、投票与异议提交请前往工作台「评审待办」页面
          </p>
        </div>
      )}
    </div>
  );
}
