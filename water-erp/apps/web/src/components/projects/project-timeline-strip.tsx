'use client';

import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { fmtAcquireRangeISO } from '@/lib/utils/format-acquire-time';
import { apiFetch } from '@/lib/api/api-fetch';

/**
 * B3 项目时间信息轴（CTS-EBS01 A-204）：十类节点横向条
 * （立项/公告发布·供应商邀请/获取文件/截止/开标/评标结束/中标公告/流标公告/签约/归档）。
 * 固定业务顺序，缺值灰显占位。挂在项目详情 page-hero 顶部；台账详情同款复用。
 * 刷新契约：调用方传 refreshKey（详情面板在任一写操作后推进），组件即时重拉；
 * 不传则维持挂载时拉取一次（台账详情等只读场景）。
 */

type TimelineNode = { key: string; label: string; time: string | null; timeEnd?: string | null; source: string };

export function ProjectTimelineStrip({ pmiId, refreshKey = 0 }: { pmiId: string; refreshKey?: string | number }) {
  const [nodes, setNodes] = useState<TimelineNode[] | null>(null);

  // 拉取时机：挂载 / pmiId 变化 / refreshKey 推进——详情面板内任一信息更新（阶段推进、
  // 上传、AI 提取、公告、合同…）后即时重拉，不再是挂载时的死快照。刷新失败保留已有
  // 节点（仅首拉失败落空态），避免瞬时故障把整条轴打成「未登记」。
  useEffect(() => {
    let alive = true;
    apiFetch(`/api/project-management/${pmiId}/timeline`, {
      credentials: 'include',
      headers: { 'X-Portal': 'web' },
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('加载失败'))))
      .then((data: TimelineNode[]) => { if (alive) setNodes(data); })
      .catch(() => { if (alive) setNodes(prev => prev ?? []); });
    return () => { alive = false; };
  }, [pmiId, refreshKey]);

  if (nodes === null) return null;

  // 日期展示：纯 00:00 无时刻语义（如立项日）只显日期，其余带时分
  const fmt = (iso: string | null, omitYear = false) => {
    if (!iso) return '未登记';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '未登记';
    const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
    const hm = hasTime ? ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
    return `${omitYear ? '' : `${d.getFullYear()}/`}${d.getMonth() + 1}/${d.getDate()}${hm}`;
  };
  // 节点展示：区间节点（采购文件获取）按拍板固定中文格式「2026年9月7日9:00-2026年9月8日15:00」
  const fmtNode = (n: TimelineNode) => {
    if (!n.time) return '未登记';
    if (!n.timeEnd) return fmt(n.time);
    return fmtAcquireRangeISO(n.time, n.timeEnd);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
      <span className="mr-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted-foreground)]">
        <CalendarClock size={11} /> 时间轴
      </span>
      {nodes.map((n, i) => (
        <span key={n.key} className="inline-flex items-center gap-1">
          {i > 0 && <span className="text-[color:var(--muted-foreground)]/40">·</span>}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${
              n.time
                ? 'bg-white text-[color:var(--foreground)] shadow-[inset_0_1px_0_oklch(1_0_0/0.9),1px_1px_3px_oklch(0.55_0.03_258/0.12),-1px_-1px_2px_oklch(1_0_0/0.85)]'
                : 'text-[color:var(--muted-foreground)]/60'
            }`}
            title={`${n.label}（来源：${n.source}）`}
          >
            <span className={`h-1 w-1 rounded-full ${n.time ? 'bg-[var(--accent)]' : 'bg-[color:var(--muted-foreground)]/40'}`} />
            {n.label}
            <span className="font-mono tabular-nums">{fmtNode(n)}</span>
          </span>
        </span>
      ))}
      {nodes.length === 0 && (
        <span className="text-[10px] text-[color:var(--muted-foreground)]/60">暂无时间节点</span>
      )}
    </div>
  );
}
