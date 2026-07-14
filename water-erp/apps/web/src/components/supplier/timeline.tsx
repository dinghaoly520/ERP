'use client';

import { useEffect, useState } from 'react';
import { getSupplierTimeline } from '@/lib/api/supplier';
import type { SupplierTimeline } from '@/lib/api/supplier';
import { Loader2 } from 'lucide-react';

const typeConfig: Record<string, { color: string; bg: string }> = {
  register: { color: 'var(--accent)', bg: 'var(--accent)' },
  SUPPLIER_APPROVED: { color: 'var(--success)', bg: 'var(--success)' },
  SUPPLIER_REJECTED: { color: 'var(--danger)', bg: 'var(--danger)' },
  SUPPLIER_RETURNED: { color: 'var(--warning)', bg: 'var(--warning)' },
  SUPPLIER_DISABLED: { color: 'var(--danger)', bg: 'var(--danger)' },
  SUPPLIER_BLACKLIST: { color: 'var(--danger)', bg: 'var(--danger)' },
  SUPPLIER_ELIMINATED: { color: 'var(--danger)', bg: 'var(--danger)' },
  evaluation: { color: 'var(--accent)', bg: 'var(--accent)' },
  bid_invited: { color: 'var(--success)', bg: 'var(--success)' },
};

export function SupplierTimeline({ supplierId }: { supplierId: string }) {
  const [data, setData] = useState<SupplierTimeline | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSupplierTimeline(supplierId).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [supplierId]);

  if (loading) return <div className="py-8 text-center text-sm text-[var(--muted-foreground)]"><Loader2 size={14} className="animate-spin mx-auto mb-2" />加载生命周期...</div>;
  if (!data || data.events.length === 0) return <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">暂无事件记录</p>;

  return (
    <div className="relative pl-6">
      {/* vertical line */}
      <div className="absolute left-[7px] top-1 bottom-1 w-px bg-[var(--muted)]/30" />
      <div className="space-y-5">
        {data.events.map((event, i) => {
          const cfg = typeConfig[event.type] || { color: 'var(--muted-foreground)', bg: 'var(--muted-foreground)' };
          return (
            <div key={i} className="relative">
              {/* dot */}
              <div className="absolute left-[-17px] top-1 flex h-[13px] w-[13px] items-center justify-center rounded-full border-2 border-[var(--background)]" style={{ backgroundColor: cfg.bg }}>
                <span className="block h-[5px] w-[5px] rounded-full bg-white" />
              </div>
              <div>
                <span className="text-[11px] font-semibold" style={{ color: cfg.color }}>{event.label}</span>
                <span className="ml-2 text-[10px] text-[var(--muted-foreground)]/60 tabular-nums">
                  {new Date(event.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--muted-foreground)] leading-relaxed">{event.detail}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
