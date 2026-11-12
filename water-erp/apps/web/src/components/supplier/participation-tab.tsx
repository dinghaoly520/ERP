"use client";

import { useCallback, useEffect, useState } from "react";
import { FileCheck2, AlertTriangle, ShieldAlert } from "lucide-react";
import { getSupplierParticipation, type ParticipationView } from "@/lib/api/supplier";

const TRACK_LABEL: Record<string, string> = { INTENT: '公开意向', RSVP: '邀请回执' };

export function ParticipationTab({ supplierId }: { supplierId: string }) {
  const [data, setData] = useState<ParticipationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    if (!supplierId) return;
    setLoading(true);
    getSupplierParticipation(supplierId)
      .then((r) => { setData(r); setFailed(false); })
      .catch(() => { setFailed(true); })
      .finally(() => setLoading(false));
  }, [supplierId]);
  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>;
  if (failed || !data) return (
    <div className="py-8 text-center">
      <p className="text-sm text-[var(--muted-foreground)]">参与情况加载失败</p>
      <button type="button" className="neu-btn-soft mt-3 !h-[32px] !text-xs" onClick={load}>重试</button>
    </div>
  );

  const { kpi } = data;
  return (
    <div>
      {/* 拉黑状态条 */}
      {data.blacklist && (
        <div className="mb-4 rounded-2xl border border-[color-mix(in_oklch,var(--danger)_30%,transparent)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] p-4">
          <div className="flex items-start gap-2">
            <ShieldAlert size={16} className="mt-0.5 text-[var(--danger)]" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-[var(--danger)]">已列入黑名单</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--foreground)]">{data.blacklist.reason}</p>
              {data.blacklist.penalties.map((p) => (
                <p key={p.penaltyDocNo} className="mt-1 text-[11px] text-[var(--muted-foreground)]">
                  处罚留痕 {p.penaltyDocNo} · {p.authority} · {new Date(p.decisionDate).toLocaleDateString('zh-CN')}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 统计瓷片（照邀请回执 tab 形态） */}
      <div className="grid grid-cols-2 gap-4 mb-4 lg:grid-cols-4">
        <div className="neu-card-static !rounded-xl p-4 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">确认参与（意向）</p>
          <p className="text-[2rem] font-black tabular-nums tracking-[-0.03em] leading-none text-[var(--accent)]">{kpi.intentTotal}</p>
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1">次公开项目确认</p>
        </div>
        <div className="neu-card-static !rounded-xl p-4 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">回执确认参加</p>
          <p className="text-[2rem] font-black tabular-nums tracking-[-0.03em] leading-none">{kpi.rsvpAcceptedTotal}</p>
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1">次邀请确认</p>
        </div>
        <div className="neu-card-static !rounded-xl p-4 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">实际投递</p>
          <p className="text-[2rem] font-black tabular-nums tracking-[-0.03em] leading-none" style={{ color: 'var(--success)' }}>{kpi.submittedTotal}</p>
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1">次标书投递</p>
        </div>
        <div className="neu-card-static !rounded-xl p-4 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] mb-2">确认未投递</p>
          <p className="text-[2rem] font-black tabular-nums tracking-[-0.03em] leading-none" style={{ color: 'var(--danger)' }}>{kpi.noShowTotal}</p>
          <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
            {kpi.noShowActiveCount > 0
              ? `履约进度 ${kpi.noShowActiveCount}/${kpi.blacklistThreshold}——再次确认未投递将自动列入黑名单`
              : `含历史 ${kpi.noShowTotal - kpi.noShowActiveCount} 条`}
          </p>
        </div>
      </div>

      {/* 事故明细 */}
      <div className="neu-card-static !rounded-2xl p-4">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle size={14} className="text-[var(--danger)]" />
          <h4 className="text-sm font-semibold text-[var(--foreground)]">确认参与未投递记录</h4>
          <span className="neu-tab-count ml-auto">{data.incidents.length} 条</span>
        </div>
        {data.incidents.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">暂无确认未投递记录</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {data.incidents.map((it, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-[8px] bg-[var(--surface)] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]" title={it.projectName}>{it.projectName}</p>
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    {it.projectCode} · {TRACK_LABEL[it.track] ?? it.track}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {it.legacy && <span className="rounded-[6px] bg-[var(--muted)]/60 px-2 py-0.5 text-[11px] font-semibold text-[var(--muted-foreground)]">历史</span>}
                  <span className="text-[11px] tabular-nums text-[var(--muted-foreground)]">{new Date(it.detectedAt).toLocaleString('zh-CN')}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 意向明细 */}
      <div className="mt-4 neu-card-static !rounded-2xl p-4">
        <div className="mb-3 flex items-center gap-2">
          <FileCheck2 size={14} className="text-[var(--accent)]" />
          <h4 className="text-sm font-semibold text-[var(--foreground)]">参与意向记录</h4>
          <span className="neu-tab-count ml-auto">{data.intents.length} 条</span>
        </div>
        {data.intents.length === 0 ? (
          <p className="py-4 text-center text-xs text-[var(--muted-foreground)]">暂无公开项目参与意向</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {data.intents.map((it, i) => (
              <div key={i} className="flex items-center justify-between gap-2 rounded-[8px] bg-[var(--surface)] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]" title={it.projectName}>{it.projectName}</p>
                  <p className="text-[11px] text-[var(--muted-foreground)]">{it.projectCode} · 确认于 {new Date(it.confirmedAt).toLocaleString('zh-CN')}</p>
                </div>
                {it.submitted ? (
                  <span className="shrink-0 rounded-[6px] bg-[rgba(92,181,150,0.12)] px-2 py-0.5 text-[11px] font-semibold text-[rgba(78,150,124,1)]">已投递</span>
                ) : (
                  <span className="shrink-0 rounded-[6px] bg-[var(--muted)]/60 px-2 py-0.5 text-[11px] font-semibold text-[var(--muted-foreground)]">未投递</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
