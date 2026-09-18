'use client';

import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { fmtAcquireRangeISO } from '@/lib/utils/format-acquire-time';

/**
 * B3 项目时间信息轴（CTS-EBS01 A-204）：六类节点横向条（立项/获取文件/截标/开标/签约/归档）。
 * 有值节点按时间升序排前，缺值灰显垫底。挂在项目详情 page-hero 顶部。
 */

type TimelineNode = { key: string; label: string; time: string | null; timeEnd?: string | null; source: string };

export function ProjectTimelineStrip({ pmiId }: { pmiId: string }) {
  const [nodes, setNodes] = useState<TimelineNode[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/project-management/${pmiId}/timeline`, {
      credentials: 'include',
      headers: { 'X-Portal': 'web' },
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('加载失败'))))
      .then((data: TimelineNode[]) => { if (alive) setNodes(data); })
      .catch(() => { if (alive) setNodes([]); });
    return () => { alive = false; };
  }, [pmiId]);

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
