'use client';

import { useRouter } from 'next/navigation';
import { UserCheck, Tag, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { DerivedTodo } from '@/lib/hooks/use-notifications';
import type { NotificationItem } from '@/lib/api/notification';

interface NotificationKpiBarProps {
  derivedTodo: DerivedTodo;
  todoItems: NotificationItem[];
}

const kpiDefs = [
  {
    key: 'supplier' as const,
    label: '待审批',
    sublabel: '供应商审批',
    icon: UserCheck,
    toneBg: '#eff6ff',
    toneColor: '#064ea2',
    link: '/supplier/approval',
    deriveCount: (derived: DerivedTodo, items: NotificationItem[]) =>
      Math.max(
        items.filter((n) => n.type === 'SUPPLIER_PENDING').length,
        derived.supplierPending,
      ),
  },
  {
    key: 'price' as const,
    label: '待复核',
    sublabel: '价格复核',
    icon: Tag,
    toneBg: '#f5f3ff',
    toneColor: '#7c3aed',
    link: '/mall-management/approval',
    deriveCount: (derived: DerivedTodo) => derived.priceReview,
  },
  {
    key: 'qual' as const,
    label: '即将到期',
    sublabel: '资质+投标',
    icon: AlertTriangle,
    toneBg: '#fff7ed',
    toneColor: '#f5a623',
    link: '/notifications',
    deriveCount: (derived: DerivedTodo) => derived.expiringQualifications,
  },
];

export function NotificationKpiBar({ derivedTodo, todoItems }: NotificationKpiBarProps) {
  const router = useRouter();
  const total = kpiDefs.reduce(
    (s, d) => s + d.deriveCount(derivedTodo, todoItems),
    0,
  );

  if (total === 0) {
    return (
      <div className="card-enter flex items-center gap-3 rounded-2xl border border-[#bbf7d0] bg-[#f0fdf4] px-5 py-3">
        <CheckCircle2 size={18} className="text-[#11a874]" />
        <div className="text-sm font-extrabold text-[#18243a]">今日待办已清零 ✓</div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {kpiDefs.map((d) => {
        const count = d.deriveCount(derivedTodo, todoItems);
        return (
          <button
            key={d.key}
            type="button"
            onClick={() => router.push(d.link)}
            className="neu-card group flex cursor-pointer flex-col items-start gap-1.5 px-4 py-3 text-left transition hover:-translate-y-0.5"
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ backgroundColor: d.toneBg }}
            >
              <d.icon size={14} style={{ color: d.toneColor }} />
            </span>
            <div className="flex items-baseline gap-1.5">
              <span
                className="text-2xl font-black tabular-nums"
                style={{ color: d.toneColor }}
              >
                {count}
              </span>
              <span className="text-xs font-semibold text-[#18243a]">
                {d.label}
              </span>
            </div>
            <div className="text-[11px] text-[#8a99ad]">{d.sublabel}</div>
            <div className="mt-0.5 text-[11px] font-bold text-[#064ea2] opacity-0 transition group-hover:opacity-100">
              去处理 →
            </div>
          </button>
        );
      })}
    </div>
  );
}
