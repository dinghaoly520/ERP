'use client';

import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { Modal } from '@/components/workbench';
import { fmtAcquireRangeISO } from '@/lib/utils/format-acquire-time';
import { apiFetch } from '@/lib/api/api-fetch';

/**
 * 项目时间轴弹窗（2026-11-13 用户裁定：面板内横条改按钮+窗口展示）。
 * 数据与 ProjectTimelineStrip 同源（/project-management/:id/timeline，按轮十节点）；
 * 视觉为垂直时间轴：已登记节点=品牌色实心圆点+亮色干线，未登记=空心圆点+虚线余段，
 * 区间节点（采购文件获取）整段中文格式；台账详情仍用横条不动。
 */

type TimelineNode = {
  key: string; label: string; time: string | null; timeEnd?: string | null; source: string;
  tone?: 'danger';
  group?: { label: string; count: number; time: string | null }[];
};
type TimelineRound = { round: number; nodes: TimelineNode[] };
type TimelineData = { rounds: TimelineRound[]; currentRound: number };

const fmt = (iso: string | null) => {
  if (!iso) return '未登记';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未登记';
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  const hm = hasTime ? ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}${hm}`;
};
const fmtNode = (n: TimelineNode) => (!n.time ? '未登记' : n.timeEnd ? fmtAcquireRangeISO(n.time, n.timeEnd) : fmt(n.time));

function TimelineRoundSection({ r, isCurrent, multiRound }: { r: TimelineRound; isCurrent: boolean; multiRound: boolean }) {
  return (
    <div className="relative">
      {multiRound && (
        <div className="mb-3 flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
              isCurrent
                ? 'bg-[var(--accent)] text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.3)]'
                : 'bg-[color-mix(in_oklch,var(--muted-foreground)_8%,transparent)] text-[color:var(--muted-foreground)]'
            }`}
          >
            第 {r.round} 轮{isCurrent ? ' · 当前' : ''}
          </span>
          <span className="h-px flex-1 bg-[oklch(0.6_0.04_258_/_0.12)]" />
        </div>
      )}
      <div className="space-y-1">
        {r.nodes.map((n, i) => {
          const done = Boolean(n.time);
          const last = i === r.nodes.length - 1;
          return (
            <div key={n.key} className="relative flex gap-3" title={`${n.label}（来源：${n.source}）`}>
              {/* 干线余段：已过=品牌色渐实线；未至=虚线余段 */}
              {!last && (
                <span
                  className={`absolute left-[9px] top-[22px] bottom-[-4px] w-[2px] rounded-full ${
                    done
                      ? 'bg-[linear-gradient(180deg,color-mix(in_oklch,var(--accent)_38%,transparent),color-mix(in_oklch,var(--accent)_16%,transparent))]'
                      : 'bg-[repeating-linear-gradient(180deg,oklch(0.6_0.04_258_/_0.28)_0_4px,transparent_4px_9px)]'
                  }`}
                />
              )}
              {/* 节点圆点：已登记=实心品牌色+柔光环；未登记=内凹描边空心 */}
              <span
                className={`relative z-10 mt-[7px] h-[20px] w-[20px] shrink-0 rounded-full ${
                  n.tone === 'danger'
                    ? 'bg-[var(--danger)] shadow-[inset_0_1px_0_oklch(1_0_0/0.3),0_0_0_4px_color-mix(in_oklch,var(--danger)_14%,transparent)]'
                    : done
                    ? 'bg-[var(--accent)] shadow-[inset_0_1px_0_oklch(1_0_0/0.35),0_0_0_4px_color-mix(in_oklch,var(--accent)_14%,transparent)]'
                    : 'bg-[oklch(0.972_0.012_258/0.7)] shadow-[inset_0_0_0_1.5px_oklch(0.6_0.04_258_/_0.3),inset_0_1px_0_oklch(1_0_0/0.7)]'
                }`}
              >
                {(done || n.tone === 'danger') && <span className="absolute left-[7px] top-[6px] h-[7px] w-[4px] rotate-45 rounded-[1px] bg-white shadow-[0_1px_1px_rgba(0,0,0,0.2)]" />}
              </span>
              {/* 节点内容：标签 + 时间（已登记右对齐品牌色 tabular；未登记灰；红色警示单列配色） */}
              <div
                className={`mb-1.5 flex flex-1 flex-col rounded-[11px] px-3 py-2 ${
                  n.tone === 'danger'
                    ? 'bg-[color-mix(in_oklch,var(--danger)_6%,transparent)] shadow-[inset_0_1px_0_oklch(1_0_0/0.6)]'
                    : done
                    ? 'bg-[oklch(1_0_0/0.5)] shadow-[inset_0_1px_0_oklch(1_0_0/0.65),1px_1px_2px_oklch(0.55_0.03_258_/_0.06)]'
                    : 'bg-[oklch(1_0_0/0.18)]'
                }`}
              >
                <div className="flex flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                  <span className={`text-[13px] font-semibold ${n.tone === 'danger' ? 'text-[var(--danger)]' : done ? 'text-[color:var(--foreground)]' : 'text-[color:var(--muted-foreground)]'}`}>{n.label}</span>
                  {n.group ? (
                    <span className="text-xs font-semibold text-[color:var(--accent-strong)]">{n.group.map(g => g.count).join('/')} 家</span>
                  ) : (
                    <span className={`text-xs tabular-nums ${n.tone === 'danger' ? 'font-semibold text-[var(--danger)]' : done ? 'font-semibold text-[color:var(--accent-strong)]' : 'text-[color:var(--muted-foreground)]/70'}`}>
                      {fmtNode(n)}
                    </span>
                  )}
                </div>
                {/* 组合子项（供应商参与=一个整体）：三行「事项 · N 家 · 最近时刻」内嵌列表 */}
                {n.group && (
                  <div className="mt-1.5 space-y-1 rounded-[9px] bg-[oklch(0.972_0.012_258/0.5)] px-2.5 py-1.5 shadow-[inset_1px_1px_3px_oklch(0.55_0.03_258_/_0.08),inset_-1px_-1px_2px_oklch(1_0_0/0.7)]">
                    {n.group.map(g => (
                      <div key={g.label} className="flex items-baseline justify-between gap-3 text-[11px]">
                        <span className="font-medium text-[color:var(--foreground)]">{g.label}</span>
                        <span className="flex items-baseline gap-2">
                          <span className="tabular-nums font-bold text-[color:var(--accent-strong)]">{g.count} 家</span>
                          <span className="tabular-nums text-[color:var(--muted-foreground)]">{g.time ? fmt(g.time) : '—'}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ProjectTimelineDialog({
  open, onClose, pmiId, refreshKey = 0,
}: { open: boolean; onClose: () => void; pmiId: string; refreshKey?: number | string }) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !pmiId) return;
    let alive = true;
    setLoading(true);
    apiFetch(`/api/project-management/${pmiId}/timeline`, {
      credentials: 'include',
      headers: { 'X-Portal': 'web' },
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('加载失败'))))
      .then((d: TimelineData) => { if (alive) setData(d); })
      .catch(() => { if (alive) setData(prev => prev ?? { rounds: [], currentRound: 1 }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, pmiId, refreshKey]);

  const multiRound = (data?.rounds.length ?? 0) > 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      icon={<Clock3 size={14} />}
      title="项目时间轴"
      description={multiRound ? '按采购轮次划分——每轮完整十节点' : '立项到归档的十类关键时间节点'}
      footer={
        <div className="neu-btn-group flex justify-end">
          <button type="button" onClick={onClose} className="neu-btn-soft">关闭</button>
        </div>
      }
    >
      {loading && !data ? (
        <div className="py-12 text-center text-sm text-[color:var(--muted-foreground)]">正在加载时间轴…</div>
      ) : !data || data.rounds.length === 0 ? (
        <div className="py-12 text-center text-sm text-[color:var(--muted-foreground)]">暂无时间节点</div>
      ) : (
        <div className={`space-y-5 ${multiRound ? '' : 'pt-1'}`}>
          {data.rounds.map(r => (
            <TimelineRoundSection key={r.round} r={r} isCurrent={r.round === data.currentRound} multiRound={multiRound} />
          ))}
        </div>
      )}
    </Modal>
  );
}
