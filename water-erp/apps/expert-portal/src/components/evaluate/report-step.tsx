'use client';

import { useState } from 'react';
import { Check, AlertTriangle, BarChart3, Gavel, ClipboardList, ChevronRight, ChevronDown, ShieldCheck } from 'lucide-react';
import type { EvaluationReport } from '@/lib/types';
import { CATEGORY_LABEL, CATEGORY_COLOR, isPassFailCategory } from '@water-erp/shared';
import { QuoteHistoryPanel } from './quote-history-panel';

interface MotionItem {
  id: string; title: string; description?: string | null;
  status: string; result?: string | null;
  /** P1 收口：服务端派生字段（voting 期无计数）；组长响应额外带 votes */
  myVote?: string | null;
  votedCount?: number;
  approveCount?: number;
  rejectCount?: number;
  abstainCount?: number;
  votes?: Array<{ expertId: string; vote: string }>;
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
  projectId?: string;
  /** A-152 评标报告电子签署区块四态（undefined/hidden 不渲染） */
  esign?: { state: EsignBlockState; busy: boolean };
  /** 无证书态：创建软证书→绑定→签署 一气流入口 */
  onCreateAndSign?: () => void;
  /** 有证书态：PIN 解锁→签名→提交入口 */
  onSign?: () => void;
}

/**
 * A-152 电子签署区块四态（T12 控制器裁定：门户端不做精确已签徽标——
 * 已电签/已纸质登记合并为中性「已完成签署」文案，精确徽标归 :3007 T13）：
 * - need-cert：未绑定证书 → 「创建签名证书并签署」（首次口令=创建软证书口令）
 * - ready：可签 → 「电子签署评标报告」
 * - wait-packet：签字包未生成 → 等待主持人提示
 * - done-or-registered：非 PENDING（已签/已纸质登记）→ 中性完成文案
 * - hidden：非签署对象（候补/异常）或数据不可用 → 不渲染
 */
export type EsignBlockState = 'need-cert' | 'ready' | 'wait-packet' | 'done-or-registered' | 'hidden';

const VOTE_LABEL: Record<string, string> = { approve: '赞成', reject: '反对', abstain: '弃权' };

export function ReportStep({ report, busy, onConfirmReport, isLead, leaderCoSigned, allMembersConfirmed, onLeaderCoSign, motions = [], disputes = [], projectId, esign, onCreateAndSign, onSign }: ReportStepProps) {
  // 逐项明细折叠态（默认折叠，点击 item 行展开）
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const toggleItem = (key: string) => setExpandedItems(prev => {
    const n = new Set(prev);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

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

      {/* ── ①-bis 评标报告电子签署（A-152：四态区块，hidden/未传不渲染）── */}
      {esign && esign.state !== 'hidden' && (
        <div className="neu-card-static mb-4 flex items-center justify-between gap-3 !p-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] text-[var(--accent-strong)] bg-[color-mix(in_oklch,var(--accent-strong)_10%,transparent)]">
              <ShieldCheck size={17} strokeWidth={1.8} />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-bold text-[var(--foreground)]">评标报告电子签署</div>
              <div className="mt-0.5 text-xs leading-relaxed text-[var(--muted-foreground)]">
                {esign.state === 'need-cert' && '尚未绑定数字证书——首次签署将创建平台自签 SM2 软证书（请设置并牢记证书口令）'}
                {esign.state === 'ready' && '使用本人数字证书（SM2/SM3）对评标报告签名，签署后不可撤销'}
                {esign.state === 'wait-packet' && '签字包尚未生成——请等待主持人生成评标签字包后再签署'}
                {esign.state === 'done-or-registered' && '已完成签署（或已登记纸质签署），以现场签字登记为准'}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            {esign.state === 'need-cert' && (
              <button type="button" onClick={onCreateAndSign} disabled={esign.busy} className="neu-btn-primary !h-[38px]">
                {esign.busy ? '签署中…' : '创建签名证书并签署'}
              </button>
            )}
            {esign.state === 'ready' && (
              <button type="button" onClick={onSign} disabled={esign.busy} className="neu-btn-primary is-success !h-[38px]">
                <span className="inline-flex items-center gap-1.5"><Check size={14} strokeWidth={2.5} />{esign.busy ? '签署中…' : '电子签署评标报告'}</span>
              </button>
            )}
            {esign.state === 'wait-packet' && (
              <span className="exp-pill" style={{ '--c': 'var(--muted-foreground)' } as React.CSSProperties}>等待签字包</span>
            )}
            {esign.state === 'done-or-registered' && (
              <span className="exp-pill" style={{ '--c': 'var(--muted-foreground)' } as React.CSSProperties}>已完成签署</span>
            )}
          </div>
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

          {/* 多轮报价历史（谈判/竞价采购项目，报价完成后可见） */}
          {projectId && <QuoteHistoryPanel projectId={projectId} />}

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
                    {ss.bidPrice && (
                      <span className="text-xs font-mono tabular-nums text-[var(--muted-foreground)]">
                        报价：¥{Number(ss.bidPrice).toLocaleString('zh-CN')}
                      </span>
                    )}
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

                {/* 逐项评分明细（默认折叠；展开显示 reason + 得分点 checklist） */}
                {Object.entries(ss.categoryScores).some(([, d]) => d.items.length > 0) && (
                  <div className="border-t border-[color-mix(in_oklch,var(--foreground)_4%,transparent)] px-5 py-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[var(--muted-foreground)]">
                      <ClipboardList size={12} strokeWidth={1.5} />
                      <span className="text-xs font-bold tracking-wide">逐项评分明细</span>
                    </div>
                    <div className="space-y-2.5">
                      {Object.entries(ss.categoryScores).map(([cat, data]) => (
                        <div key={cat}>
                          <div className="mb-1 flex items-center gap-1.5">
                            <span className="exp-category-chip !h-2 !w-2" style={{ '--cat': CATEGORY_COLOR[cat] || 'var(--accent-strong)' } as React.CSSProperties} />
                            <span className="text-[11px] font-semibold text-[var(--muted-foreground)]">{CATEGORY_LABEL[cat] || cat}</span>
                          </div>
                          <div className="space-y-0.5">
                            {data.items.map((item, idx) => {
                              const itemKey = `${i}-${cat}-${idx}`;
                              const hasDetail = Boolean(item.reason || item.points?.length);
                              const expanded = expandedItems.has(itemKey);
                              const passFail = isPassFailCategory(cat);
                              return (
                                <div key={idx} className="rounded-md hover:bg-[oklch(0.97_0.005_258/0.5)]">
                                  <div
                                    role={hasDetail ? 'button' : undefined}
                                    tabIndex={hasDetail ? 0 : undefined}
                                    onClick={() => hasDetail && toggleItem(itemKey)}
                                    onKeyDown={e => { if (hasDetail && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleItem(itemKey); } }}
                                    className={`flex items-center gap-2 px-2 py-1 ${hasDetail ? 'cursor-pointer' : ''}`}
                                  >
                                    {hasDetail ? (
                                      expanded
                                        ? <ChevronDown size={12} strokeWidth={1.5} className="shrink-0 text-[var(--muted-foreground)]" />
                                        : <ChevronRight size={12} strokeWidth={1.5} className="shrink-0 text-[var(--muted-foreground)]" />
                                    ) : (
                                      <span className="w-3 shrink-0" />
                                    )}
                                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--foreground)]">{item.name}</span>
                                    {passFail ? (
                                      <span className={`shrink-0 text-xs font-bold ${item.passed === false ? 'text-[var(--danger)]' : 'text-[var(--success)]'}`}>
                                        {item.passed === false ? '不通过' : '通过'}
                                      </span>
                                    ) : (
                                      <span className="shrink-0 font-mono text-xs tabular-nums text-[var(--foreground)]">
                                        {item.score}<span className="text-[var(--muted-foreground)]"> / {item.maxScore}</span>
                                      </span>
                                    )}
                                  </div>
                                  {expanded && hasDetail && (
                                    <div className="ml-5 space-y-1 pb-1.5 pl-2">
                                      {item.reason && (
                                        <div className="text-xs text-[var(--muted-foreground)]">
                                          <span className="font-semibold">理由：</span>{item.reason}
                                        </div>
                                      )}
                                      {(item.points?.length ?? 0) > 0 && (
                                        <div className="space-y-0.5">
                                          {item.points!.map((p, pi) => (
                                            <div key={pi} className="flex items-start gap-1.5 text-[11px]">
                                              <span className={`mt-px font-bold ${p.checked ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
                                                {p.checked ? '✓' : '✗'}
                                              </span>
                                              <span className="min-w-0 flex-1 text-[var(--foreground)]">{p.name}</span>
                                              <span className="shrink-0 font-mono tabular-nums text-[var(--muted-foreground)]">
                                                {p.awardedScore} / {p.fullScore}
                                              </span>
                                              {p.note && (
                                                <span className="ml-1 max-w-[40%] shrink-0 truncate text-[var(--warning)]" title={p.note}>
                                                  ⟨{p.note}⟩
                                                </span>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
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
                          <span className="font-semibold text-[var(--foreground)]" title={d.tenderContent}>
                            {d.tenderContent || '（条款原文未提取，请核对招标文件）'}
                          </span>
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
                // P1 收口：服务端已剥离 votes（组长保留）——统一消费派生字段；
                // voting 期不显示赞/反分布（防从众），只显示已投进度
                const approves = m.approveCount ?? 0;
                const rejects = m.rejectCount ?? 0;
                const totalVotes = m.votedCount ?? 0;
                const myVote = m.myVote ?? null;
                const isClosed = m.status === 'closed';
                const showCounts = m.approveCount != null;
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
                      {showCounts ? (
                        <>
                          <span className="text-[var(--success)]">赞成 {approves}</span>
                          <span className="text-[var(--danger)]">反对 {rejects}</span>
                        </>
                      ) : null}
                      <span>/ 已投 {totalVotes} 票</span>
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
