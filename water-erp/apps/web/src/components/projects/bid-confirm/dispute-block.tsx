'use client';

/**
 * 专家异议处理区块——:3005 开评标指挥中心。
 * D2: 专家在评审中提交的异议工单（ExpertDispute），由采购端在此裁决（采纳/驳回）。
 * 数据来自父组件 detail.expertDisputes（getProject include），裁决后 onChanged 触发父组件 refreshDetail。
 * 显隐：仅 EVALUATING / ARCHIVED 渲染；ARCHIVED 只读。
 */

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { resolveExpertDispute, type BidProjectDetail } from '@/lib/api/bid';

type Props = {
  bidProjectId: string;
  detail: BidProjectDetail | null;
  onChanged: () => void;
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

export function DisputeBlock({ bidProjectId, detail, onChanged }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [responseById, setResponseById] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);

  if (!detail) return null;
  const { stage, expertDisputes } = detail;
  // 异议在评审阶段产生；OPENING 及之前不渲染，ARCHIVED 只读回看
  if (stage !== 'EVALUATING' && stage !== 'ARCHIVED') return null;
  const archived = stage === 'ARCHIVED';
  const disputes = expertDisputes ?? [];
  const pendingCount = disputes.filter((d) => d.status === 'open').length;

  const showToast = (text: string, tone: 'ok' | 'err' = 'ok') => {
    setFeedback({ text, tone });
    setTimeout(() => setFeedback(null), 2800);
  };

  async function handleResolve(disputeId: string, status: 'resolved' | 'rejected') {
    const response = (responseById[disputeId] ?? '').trim();
    if (!response) { showToast(status === 'resolved' ? '请填写采纳回复' : '请填写驳回理由', 'err'); return; }
    setBusyId(disputeId);
    try {
      await resolveExpertDispute(bidProjectId, disputeId, { response, status });
      showToast(status === 'resolved' ? '异议已采纳' : '异议已驳回');
      setResponseById((prev) => { const n = { ...prev }; delete n[disputeId]; return n; });
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '裁决失败', 'err');
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

      {feedback && (
        <div
          className="mb-3 flex items-center gap-2 rounded-[12px] px-3.5 py-2.5 text-xs font-semibold"
          style={{
            background: feedback.tone === 'ok' ? 'color-mix(in oklch, var(--success) 10%, transparent)' : 'color-mix(in oklch, var(--danger) 10%, transparent)',
            color: feedback.tone === 'ok' ? 'var(--success)' : 'var(--danger)',
          }}
        >
          {feedback.tone === 'ok' ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {feedback.text}
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
                    <div className="flex gap-2">
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
