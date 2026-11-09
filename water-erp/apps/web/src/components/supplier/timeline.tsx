'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupplierTimeline } from '@/lib/api/supplier';
import type { SupplierTimeline, TimelineEvent } from '@/lib/api/supplier';
import {
  Loader2, UserPlus, CheckCircle2, XCircle, RotateCcw, Ban, ShieldOff, Trash2,
  RefreshCw, Send, Activity, FileEdit, Award, Briefcase, Package, FileText,
  ArrowRightLeft,
} from 'lucide-react';

type TypeConfig = { color: string; bg: string; icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }> };

const typeConfig: Record<string, TypeConfig> = {
  // 注册
  register:      { color: 'var(--accent)',       bg: 'var(--accent)',       icon: UserPlus },
  // 审核
  SUPPLIER_APPROVED:          { color: 'var(--success)', bg: 'var(--success)', icon: CheckCircle2 },
  SUPPLIER_REJECTED:          { color: 'var(--danger)',  bg: 'var(--danger)',  icon: XCircle },
  SUPPLIER_RETURNED:          { color: 'var(--warning)', bg: 'var(--warning)', icon: RotateCcw },
  // 状态变更
  SUPPLIER_DISABLED:          { color: 'oklch(0.55 0.05 70)',  bg: 'oklch(0.55 0.05 70)',  icon: Ban },
  SUPPLIER_BLACKLIST:         { color: 'var(--danger)',        bg: 'var(--danger)',        icon: ShieldOff },
  SUPPLIER_ELIMINATED:        { color: 'var(--danger)',        bg: 'var(--danger)',        icon: Trash2 },
  SUPPLIER_RESTORED:          { color: 'var(--success)',       bg: 'var(--success)',       icon: RefreshCw },
  SUPPLIER_RESUBMITTED:       { color: 'var(--accent)',        bg: 'var(--accent)',        icon: Send },
  SUPPLIER_REACTIVATED:       { color: 'var(--success)',       bg: 'var(--success)',       icon: Activity },
  // 变更
  SUPPLIER_CHANGE_APPROVED:   { color: 'var(--success)', bg: 'var(--success)', icon: FileEdit },
  SUPPLIER_CHANGE_REJECTED:   { color: 'var(--danger)',  bg: 'var(--danger)',  icon: FileEdit },
  SUPPLIER_CONVERTED_REGULAR: { color: 'var(--success)', bg: 'var(--success)', icon: ArrowRightLeft },
  SUPPLIER_TAGS_UPDATED:     { color: 'var(--accent)',  bg: 'var(--accent)',  icon: FileEdit },
  // 业务
  evaluation:      { color: 'var(--accent)', bg: 'var(--accent)', icon: Award },
  SUPPLIER_EVALUATION_CREATED: { color: 'var(--accent)', bg: 'var(--accent)', icon: Award },
  bid:             { color: 'oklch(0.5 0.12 220)', bg: 'oklch(0.5 0.12 220)', icon: Briefcase },
};

const fallback: TypeConfig = { color: 'var(--muted-foreground)', bg: 'var(--muted-foreground)', icon: FileText };

/** 绩效评价等级徽章：A 优秀 / B 良好 / C 中等 / D·E 预警（与画像-评价域口径一致） */
const GRADE_TONES: Record<string, string> = {
  A: 'var(--success)',
  B: 'var(--accent)',
  C: 'var(--warning)',
  D: 'var(--danger)',
  E: 'var(--danger)',
};

function monthKey(d: Date) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

/** 事件流按月分组（事件流已升序，Map 插入序即时间序） */
function groupByMonth(events: TimelineEvent[]): Array<[string, TimelineEvent[]]> {
  const map = new Map<string, TimelineEvent[]>();
  for (const ev of events) {
    const key = monthKey(new Date(ev.at));
    const bucket = map.get(key);
    if (bucket) bucket.push(ev);
    else map.set(key, [ev]);
  }
  return Array.from(map.entries());
}

export function SupplierTimeline({ supplierId }: { supplierId: string }) {
  const [data, setData] = useState<SupplierTimeline | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSupplierTimeline(supplierId).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [supplierId]);

  const groups = useMemo(() => (data ? groupByMonth(data.events) : []), [data]);

  if (loading) return <div className="py-8 text-center text-sm text-[var(--muted-foreground)]"><Loader2 size={14} className="animate-spin mx-auto mb-2" />加载生命周期...</div>;
  if (!data || data.events.length === 0) return <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">暂无事件记录</p>;

  return (
    <div className="relative pl-7">
      {/* 贯穿全列的时间轴竖线 */}
      <div className="absolute left-[9px] top-2 bottom-2 w-px bg-[var(--muted)]/25" />
      <div className="space-y-5">
        {groups.map(([month, events]) => (
          <div key={month}>
            {/* 月份分隔头（年份上下文由这里承载，行内时间保持 MM/DD HH:mm 短格式） */}
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-bold tracking-[0.08em] text-[var(--muted-foreground)]/70 font-mono">{month}</span>
              <span className="h-px flex-1" style={{ background: 'oklch(0.6 0.04 258 / 0.16)' }} />
            </div>
            <div className="mt-2.5 space-y-3.5">
              {events.map((event, i) => {
                const cfg = typeConfig[event.type] || fallback;
                const Icon = cfg.icon;
                const gradeTone = event.grade ? GRADE_TONES[event.grade] : undefined;
                return (
                  <div key={i} className="group relative">
                    {/* 图标节点 */}
                    <div
                      className="absolute left-[-19px] top-0.5 flex h-[17px] w-[17px] items-center justify-center rounded-full border-2 border-[var(--background)] transition-transform duration-150 group-hover:scale-110"
                      style={{ backgroundColor: cfg.bg }}
                    >
                      <Icon size={9} className="text-white" strokeWidth={2.5} />
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12px] font-bold" style={{ color: cfg.color }}>{event.label}</span>
                      {event.grade && (
                        <span
                          className="inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-black leading-4"
                          style={{ color: gradeTone, background: `color-mix(in oklch, ${gradeTone} 10%, transparent)` }}
                        >
                          {event.grade} 级
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-[var(--muted-foreground)]/50 tabular-nums font-mono">
                        {new Date(event.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)] leading-relaxed">{event.detail}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
