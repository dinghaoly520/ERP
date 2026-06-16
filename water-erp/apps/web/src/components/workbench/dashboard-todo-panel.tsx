'use client';
import { useRouter } from 'next/navigation';
import { UserCheck, AlertTriangle, Tag, CheckCircle2 } from 'lucide-react';
import { useNotifications } from '@/lib/hooks/use-notifications';

export function DashboardTodoPanel() {
  const router = useRouter();
  const { derivedTodo, todoItems } = useNotifications();

  // 双源：notification SUPPLIER_PENDING + stats pending，取大值
  const supplierPendingCount = Math.max(
    todoItems.filter((n) => n.type === 'SUPPLIER_PENDING').length,
    derivedTodo.supplierPending,
  );
  const todoDefs = [
    { key: 'supplier', label: '供应商审批', hint: '待审核', icon: UserCheck, toneBg: '#eff6ff', toneColor: '#064ea2', link: '/supplier/approval', count: supplierPendingCount },
    { key: 'qual',     label: '资质到期',    hint: '90天内', icon: AlertTriangle, toneBg: '#fff7ed', toneColor: '#f5a623', link: '/supplier/repository', count: derivedTodo.expiringQualifications },
    { key: 'price',    label: '价格复核',    hint: '待审批', icon: Tag,            toneBg: '#f5f3ff', toneColor: '#7c3aed', link: '/mall-management/approval', count: derivedTodo.priceReview },
  ];
  const total = todoDefs.reduce((s, d) => s + d.count, 0);

  if (total === 0) {
    return (
      <div className="card-enter flex items-center gap-3 rounded-2xl border border-[#bbf7d0] bg-[#f0fdf4] px-5 py-4">
        <CheckCircle2 size={18} className="text-[#11a874]" />
        <div>
          <div className="text-sm font-extrabold text-[#18243a]">今日待办已清零</div>
          <div className="text-xs text-[#5a6d8a]">没有需要处理的审批、资质或价格复核</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card-enter overflow-hidden rounded-2xl border border-[#e5ecf4] bg-white">
      <div className="flex items-center justify-between border-b border-[#eef3f8] px-5 py-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={14} className="text-[#064ea2]" />
          <span className="text-sm font-extrabold text-[#18243a]">今日待办</span>
          <span className="rounded-full bg-[#e74c3c] px-2 py-0.5 text-[10px] font-extrabold text-white">{total}</span>
        </div>
        <span className="text-xs text-[#8a99ad]">按模块分组</span>
      </div>
      <div className="grid grid-cols-3 divide-x divide-[#eef3f8]">
        {todoDefs.map((d) => (
          <button key={d.key} onClick={() => router.push(d.link)} className="group px-5 py-4 text-left transition hover:bg-[#f8fafc]">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: d.toneBg }}><d.icon size={14} style={{ color: d.toneColor }} /></span>
              <span className="text-xs font-bold text-[#18243a]">{d.label}</span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-black tabular-nums" style={{ color: d.toneColor }}>{d.count}</span>
              <span className="text-xs text-[#8a99ad]">{d.hint}</span>
            </div>
            <div className="mt-1 text-xs font-bold text-[#064ea2] opacity-0 transition group-hover:opacity-100">去处理 →</div>
          </button>
        ))}
      </div>
    </div>
  );
}
