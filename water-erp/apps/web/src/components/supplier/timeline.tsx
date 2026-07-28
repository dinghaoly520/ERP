'use client';

import { useEffect, useState } from 'react';
import { getSupplierTimeline } from '@/lib/api/supplier';
import type { SupplierTimeline } from '@/lib/api/supplier';
import {
  Loader2, UserPlus, CheckCircle2, XCircle, RotateCcw, Ban, ShieldOff, Trash2,
  RefreshCw, Send, Activity, FileEdit, Award, Briefcase, Package, FileText,
  ArrowRightLeft, Star,
} from 'lucide-react';

type TypeConfig = { color: string; bg: string; icon: React.ComponentType<{ size?: number }> };

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
  catalog_apply:   { color: 'oklch(0.55 0.1 170)', bg: 'oklch(0.55 0.1 170)', icon: Package },
  contract:        { color: 'oklch(0.55 0.12 110)', bg: 'oklch(0.55 0.12 110)', icon: Star },
};

const fallback: TypeConfig = { color: 'var(--muted-foreground)', bg: 'var(--muted-foreground)', icon: FileText };

export function SupplierTimeline({ supplierId }: { supplierId: string }) {
  const [data, setData] = useState<SupplierTimeline | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSupplierTimeline(supplierId).then(setData).catch(() => {}).finally(() => setLoading(false));
  }, [supplierId]);

  if (loading) return <div className="py-8 text-center text-sm text-[var(--muted-foreground)]"><Loader2 size={14} className="animate-spin mx-auto mb-2" />加载生命周期...</div>;
  if (!data || data.events.length === 0) return <p className="text-sm text-[var(--muted-foreground)] py-8 text-center">暂无事件记录</p>;

  return (
    <div className="relative pl-8">
      {/* vertical line */}
      <div className="absolute left-[10px] top-1 bottom-1 w-px bg-[var(--muted)]/25" />
      <div className="space-y-4">
        {data.events.map((event, i) => {
          const cfg = typeConfig[event.type] || fallback;
          const Icon = cfg.icon;
          return (
            <div key={i} className="relative group">
              {/* icon dot */}
              <div
                className="absolute left-[-22px] top-0.5 flex h-[19px] w-[19px] items-center justify-center rounded-full border-2 border-[var(--background)] transition-transform duration-150 group-hover:scale-110"
                style={{ backgroundColor: cfg.bg }}
              >
                <Icon size={10} className="text-white" strokeWidth={2.5} />
              </div>
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-bold" style={{ color: cfg.color }}>{event.label}</span>
                  <span className="text-[10px] text-[var(--muted-foreground)]/50 tabular-nums font-mono">
                    {new Date(event.at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)] leading-relaxed">{event.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
