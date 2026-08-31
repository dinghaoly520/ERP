'use client';

/**
 * 专家异议处理区块——:3007 项目工作区「评标管理」tab（分工 v3 自 :3005 迁回现场）。
 * D2: 专家在评审中提交的异议工单（ExpertDispute），由现场在此裁决（采纳/驳回，含评标中流标）。
 * 数据来自父组件 project.expertDisputes（getProject include），裁决后 onChanged 触发父组件重载。
 * 显隐：仅 EVALUATING / ARCHIVED 渲染；ARCHIVED 只读。
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, Ban, CheckCircle2, Flag, ShieldCheck, XCircle } from 'lucide-react';
import { abortBidProject, listEvaluationResults, resolveExpertDispute } from '@/lib/api/evaluation';
import { FeedbackBanner, FEEDBACK_AUTOHIDE_MS } from './shared';
import type { BidProjectDetail } from '@/lib/types';

type Props = {
  bidProjectId: string;
  detail: BidProjectDetail | null;
  onChanged: () => void;
  /** 页级结果信号（O2：生成/裁决等改结果动作递增）——变化即重拉；替代原 detail 引用依赖 */
  refreshSignal?: number;
};

const TYPE_LABEL: Record<string, string> = {
  scoring: '评分异议',
  procedure: '程序异议',
  other: '其他',
};

const STATUS_META: Record<string, { label: string; color: string; icon: typeof AlertTriangle }> = {
  open: { label: '待裁决', color: 'var(--warning)', icon: AlertTriangle },
  resolved: { label: '已采纳', color: 'var(--success)', icon: CheckCircle2 },
  rejected: { label: '已驳回', color: 'var(--danger)', icon: XCircle },
};

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN');
}

export function DisputeBlock({ bidProjectId, detail, onChanged, refreshSignal }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [responseById, setResponseById] = useState<Record<string, string>>({});
  const [invalidateById, setInvalidateById] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  // 官方评标结果是否已生成——F10 后不再收起建议流标，仅用于流标 warn/书面理由文案分支（N4c：
  // 结果已生成时后端强制书面理由并作废结果）。注：hooks 必须位于 if (!detail) 早退之前
  // （detail null→loaded 会改变 hook 数量，违反 React hooks 规则）。
  const [resultsGenerated, setResultsGenerated] = useState(false);
  useEffect(() => {
    if (!bidProjectId || detail?.stage === 'ARCHIVED') return;
    listEvaluationResults(bidProjectId)
      .then((r) => setResultsGenerated(r.length > 0))
      .catch(() => setResultsGenerated(false));
    // O2：detail 引用随 WS 高频刷新（scheduleRefresh 防抖后仍每轮必变）→ 改 stage 标量 + 页级信号；
    // 生成/重生成/裁决（onEvalChanged）与裁决废标后的刷新都经 refreshSignal 传达
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bidProjectId, detail?.stage, refreshSignal]);

  if (!detail) return null;
  const { stage, expertDisputes } = detail;
  // 异议在评审阶段产生；OPENING 及之前不渲染，ARCHIVED 只读回看
  if (stage !== 'EVALUATING' && stage !== 'ARCHIVED') return null;
  const archived = stage === 'ARCHIVED';
  const disputes = expertDisputes ?? [];
  const pendingCount = disputes.filter((d) => d.status === 'open').length;

  // 有效供应商（解密成功 + 未撤回 + 未废标）——供废标选择与流标判定
  const validSuppliers = (detail.suppliers ?? []).filter(
    (s) => s.decryptStatus === 'SUCCESS' && s.submitStatus !== '已撤回' && s.bidValidity !== 'invalid',
  );
  // N4a：法定家数按采购方式取（直接采购=1，其余=3；后端下发缺失时兜底 3）。
  // F10（2026-08-28）：撤掉「已生成结果 ⇒ 收起建议流标」——裁决废标把家数打穿最低线后
  // 结果已生成、流标入口反而消失成死路（后端本就允许结果已生成时凭书面理由流标，N4c）。
  const minBidders = detail.minBidders ?? 3;
  const suggestAbort = !archived && validSuppliers.length < minBidders;
  const hasOpenDispute = pendingCount > 0;

  const showToast = (text: string, tone: 'ok' | 'err' = 'ok') => {
    setFeedback({ text, tone });
    setTimeout(() => setFeedback(null), FEEDBACK_AUTOHIDE_MS);
  };

  async function handleResolve(disputeId: string, status: 'resolved' | 'rejected', withInvalidate = false) {
    const response = (responseById[disputeId] ?? '').trim();
    if (!response) { showToast(status === 'resolved' ? '请填写采纳回复' : '请填写驳回理由', 'err'); return; }
    const invalidateBidSupplierId = withInvalidate ? invalidateById[disputeId] : undefined;
    if (withInvalidate && !invalidateBidSupplierId) { showToast('请先选择要废标的供应商', 'err'); return; }
    setBusyId(disputeId);
    try {
      await resolveExpertDispute(bidProjectId, disputeId, { response, status, invalidateBidSupplierId });
      showToast(withInvalidate ? '异议已采纳并废标' : status === 'resolved' ? '异议已采纳' : '异议已驳回');
      setResponseById((prev) => { const n = { ...prev }; delete n[disputeId]; return n; });
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '裁决失败', 'err');
    } finally {
      setBusyId(null);
    }
  }

  async function handleAbort() {
    // F10：流标理由按有无未决异议动态化——无异议时「经异议裁决」名不副实（废标/撤回同样打穿家数线）
    const reasonBase = hasOpenDispute
      ? `存在 ${pendingCount} 条异议未裁决，有效供应商仅 ${validSuppliers.length} 家（< ${minBidders}），经评标委员会认定流标`
      : `有效供应商仅 ${validSuppliers.length} 家（< ${minBidders}），不足法定家数，经评标委员会认定流标`;
    const warn = resultsGenerated
      ? `${reasonBase}；已生成的官方评标结果将作废并高风险留痕。确认执行？此操作不可逆。`
      : `${reasonBase}。确认执行流标？此操作不可逆。`;
    if (!window.confirm(warn)) return;
    setBusyId('__abort__');
    try {
      // N4c：结果已生成时后端强制书面理由（ABORT_REASON_REQUIRED），此处同步带上
      await abortBidProject(bidProjectId, resultsGenerated ? `${reasonBase}；已生成的评标结果作废` : reasonBase);
      showToast('已流标');
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '流标失败', 'err');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="neu-table-card px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px]"
            style={{ background: 'color-mix(in oklch, var(--warning) 14%, transparent)', boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.6), 2px 2px 3px oklch(0.55 0.03 258 / 0.08)' }}
          >
            <AlertTriangle size={15} className="text-[var(--warning)]" />
          </div>
          <h3 className="text-sm font-semibold tracking-[-0.02em] text-[var(--foreground)]">专家异议处理</h3>
          {pendingCount > 0 && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums text-white"
              style={{ background: 'var(--warning)' }}
            >
              {pendingCount} 待裁决
            </span>
          )}
        </div>
      </div>

      <FeedbackBanner feedback={feedback} />

      {/* 流标建议 / 异议待裁决提醒（N4）：横幅由 suggestAbort || hasOpenDispute 控制。
          F10：结果已生成不再收起建议流标——confirm 文案会作废警示，后端凭书面理由放行（N4c）。 */}
      {(suggestAbort || hasOpenDispute) && (
        <div
          className="mb-3 flex items-center justify-between gap-3 rounded-[12px] px-3.5 py-2.5 text-xs font-semibold"
          style={{ background: 'color-mix(in oklch, var(--danger) 10%, transparent)', color: 'var(--danger)' }}
        >
          {suggestAbort ? (
            <>
              <span className="flex items-center gap-2">
                <Flag size={13} /> 有效供应商仅 {validSuppliers.length} 家（&lt; {minBidders}），不满足评标条件，建议流标
              </span>
              <button
                type="button"
                onClick={handleAbort}
                disabled={busyId === '__abort__'}
                className="neu-btn-soft !h-[28px] !text-xs shrink-0"
                style={{ color: 'var(--danger)' }}
              >
                {busyId === '__abort__' ? '流标中…' : '执行流标'}
              </button>
            </>
          ) : (
            <span className="flex items-center gap-2">
              <Flag size={13} /> 存在 {pendingCount} 条异议待裁决
            </span>
          )}
        </div>
      )}

      {disputes.length === 0 ? (
        <div className="px-3.5 py-6 text-center text-xs text-[var(--muted-foreground)]">暂无异议工单</div>
      ) : (
        <div className="space-y-2.5">
          {disputes.map((d) => {
            const meta = STATUS_META[d.status] ?? STATUS_META.open;
            const StatusIcon = meta.icon;
            const canResolve = d.status === 'open' && !archived;
            return (
              <div
                key={d.id}
                className="overflow-hidden rounded-[14px]"
                style={{ border: `1px solid color-mix(in oklch, ${meta.color} 30%, oklch(0.6 0.04 258 / 0.1))` }}
              >
                {/* 头部：标题 / 专家 / 类型 / 状态 */}
                <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5" style={{ background: 'oklch(0.975 0.012 258 / 0.5)' }}>
                  <span className="text-[13px] font-bold text-[var(--foreground)]">{d.title}</span>
                  <span className="text-[10px] text-[var(--muted-foreground)]">{d.expertName}</span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{ background: 'color-mix(in oklch, var(--accent) 10%, transparent)', color: 'var(--accent)' }}
                  >
                    {TYPE_LABEL[d.type] ?? d.type}
                  </span>
                  <span className="ml-auto tabular-nums text-[10px] text-[var(--muted-foreground)]">{formatTime(d.createdAt)}</span>
                  <span
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold"
                    style={{ background: `color-mix(in oklch, ${meta.color} 12%, transparent)`, color: meta.color }}
                  >
                    <StatusIcon size={11} strokeWidth={2} />
                    {meta.label}
                  </span>
                </div>

                {/* 异议正文 */}
                <p className="whitespace-pre-line px-3.5 py-2.5 text-xs leading-5 text-[var(--foreground)]">{d.content}</p>

                {/* 裁决表单（open 且 EVALUATING） */}
                {canResolve && (
                  <div className="space-y-2 px-3.5 pb-3">
                    <textarea
                      className="w-full rounded-[10px] px-3 py-2 text-xs leading-5 outline-none"
                      style={{ border: '1px solid oklch(0.6 0.04 258 / 0.16)', background: 'oklch(0.985 0.008 258 / 0.6)' }}
                      rows={2}
                      placeholder="裁决回复（采纳说明 / 驳回理由）"
                      value={responseById[d.id] ?? ''}
                      onChange={(e) => setResponseById((prev) => ({ ...prev, [d.id]: e.target.value }))}
                      disabled={busyId === d.id}
                    />
                    {/* 联动废标：选择供应商后「废标并采纳」同事务生效 */}
                    {validSuppliers.length > 0 && (
                      <select
                        className="w-full rounded-[10px] px-3 py-2 text-xs outline-none"
                        style={{ border: '1px solid oklch(0.6 0.04 258 / 0.16)', background: 'oklch(0.985 0.008 258 / 0.6)' }}
                        value={invalidateById[d.id] ?? ''}
                        onChange={(e) => setInvalidateById((prev) => ({ ...prev, [d.id]: e.target.value }))}
                        disabled={busyId === d.id}
                      >
                        <option value="">（可选）采纳时同时废标的供应商</option>
                        {validSuppliers.map((s) => (
                          <option key={s.id} value={s.id}>{s.supplierName}</option>
                        ))}
                      </select>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleResolve(d.id, 'resolved')}
                        disabled={busyId === d.id}
                        className="neu-btn-soft !h-[30px] !text-xs"
                        style={{ color: 'var(--success)' }}
                      >
                        <ShieldCheck size={13} /> 采纳并回复
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResolve(d.id, 'resolved', true)}
                        disabled={busyId === d.id || !invalidateById[d.id]}
                        className="neu-btn-soft !h-[30px] !text-xs"
                        style={{ color: 'var(--danger)' }}
                        title="采纳异议并把所选供应商置为废标"
                      >
                        <Ban size={13} /> 废标并采纳
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResolve(d.id, 'rejected')}
                        disabled={busyId === d.id}
                        className="neu-btn-soft !h-[30px] !text-xs"
                        style={{ color: 'var(--danger)' }}
                      >
                        <XCircle size={13} /> 驳回
                      </button>
                    </div>
                  </div>
                )}

                {/* 已裁决回复 */}
                {d.status !== 'open' && d.response && (
                  <div className="px-3.5 py-2.5" style={{ borderTop: '1px solid oklch(0.6 0.04 258 / 0.1)' }}>
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--muted-foreground)]">
                      <ShieldCheck size={11} /> 裁决回复 · {formatTime(d.resolvedAt)}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-xs leading-5 text-[var(--foreground)]">{d.response}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
