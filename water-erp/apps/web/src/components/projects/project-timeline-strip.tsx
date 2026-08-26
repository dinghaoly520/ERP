'use client';

import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';

/**
 * B3 项目时间信息轴（CTS-EBS01 A-204）：六类节点横向条（立项/获取文件/截标/开标/签约/归档）。
 * 有值节点按时间升序排前，缺值灰显垫底。挂在项目详情 page-hero 顶部。
 */

type TimelineNode = { key: string; label: string; time: string | null; source: string };

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

  const fmt = (iso: string | null) => {
    if (!iso) return '未登记';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '未登记' : d.toLocaleDateString('zh-CN');
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
                ? 'bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] text-[color:var(--foreground)]'
                : 'text-[color:var(--muted-foreground)]/60'
            }`}
            title={`${n.label}（来源：${n.source}）`}
          >
            <span className={`h-1 w-1 rounded-full ${n.time ? 'bg-[var(--accent)]' : 'bg-[color:var(--muted-foreground)]/40'}`} />
            {n.label}
            <span className="font-mono tabular-nums">{fmt(n.time)}</span>
          </span>
        </span>
      ))}
      {nodes.length === 0 && (
        <span className="text-[10px] text-[color:var(--muted-foreground)]/60">暂无时间节点</span>
      )}
    </div>
  );
}
