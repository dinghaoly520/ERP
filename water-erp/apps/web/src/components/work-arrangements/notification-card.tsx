'use client';

import * as LucideIcons from 'lucide-react';
import { getNotificationMeta, statusTone } from '@water-erp/shared';
import type { NotificationItem } from '@/lib/api/notification';

export type NotificationUrgency = 'urgent' | 'important' | 'normal';

const URGENCY_MAP: Record<string, NotificationUrgency> = {
  SUPPLIER_PENDING: 'urgent',
  PRICE_REVIEW: 'important',
  QUALIFICATION_EXPIRING: 'important',
  BID_REMINDER: 'normal',
};

function getUrgency(type: string): NotificationUrgency {
  return URGENCY_MAP[type] ?? 'normal';
}

const urgencyColors: Record<NotificationUrgency, { dot: string; label: string }> = {
  urgent:    { dot: 'bg-[#ef4444]', label: '紧急' },
  important: { dot: 'bg-[#f59e0b]', label: '重要' },
  normal:    { dot: 'bg-[#3b82f6]', label: '普通' },
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

interface NotificationCardProps {
  item: NotificationItem;
  onAction: (item: NotificationItem) => void;
}

export function NotificationCard({ item, onAction }: NotificationCardProps) {
  const meta = getNotificationMeta(item.type);
  const Icon = (LucideIcons as any)[meta.icon] ?? LucideIcons.Bell;
  const tone = statusTone[meta.tone] ?? statusTone.gray;
  const urgency = getUrgency(item.type);
  const colors = urgencyColors[urgency];
  const resolved = !!item.resolvedAt;

  return (
    <div
      className={`group relative rounded-[14px] bg-white px-4 py-3 ${
        resolved ? 'opacity-50' : ''
      } ${!item.isRead ? 'ring-1 ring-[rgba(96,139,239,0.12)]' : ''}`}
    >
      {/* 顶部：类型图标 + 紧急度标签 + 时间 */}
      <div className="flex items-center gap-2">
        <span
          className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-md"
          style={{ color: tone.color, backgroundColor: tone.bg }}
        >
          <Icon size={11} strokeWidth={2} />
        </span>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-bold ${
            urgency === 'urgent'
              ? 'bg-[#fef2f2] text-[#ef4444]'
              : urgency === 'important'
                ? 'bg-[#fffbeb] text-[#d97706]'
                : 'bg-[#eff6ff] text-[#2563eb]'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
          {colors.label}
        </span>
        <span className="text-[11px] tabular-nums text-[#8a99ad]">
          {relTime(item.createdAt)}
        </span>
        {resolved && (
          <span className="rounded-full bg-[#ecfdf5] px-1.5 py-px text-[10px] font-semibold text-[#11a874]">
            已处理
          </span>
        )}
      </div>

      {/* 标题 — 直接展示 */}
      <p
        className={`mt-2 text-[13px] font-semibold leading-snug ${
          resolved
            ? 'text-[color:var(--muted-foreground)] line-through'
            : 'text-[#18243a]'
        }`}
      >
        {item.title}
      </p>

      {/* 内容 — 完整展示，不折叠 */}
      {item.content && (
        <p className="mt-1 text-[11px] leading-relaxed text-[#5a6d8a]">
          {item.content}
        </p>
      )}

      {/* 底部操作行 */}
      {meta.actionable && !resolved && item.link ? (
        <button
          type="button"
          onClick={() => onAction(item)}
          className="mt-2 inline-flex items-center gap-1 rounded-lg bg-[rgba(96,139,239,0.08)] px-2.5 py-1 text-[11px] font-bold text-[color:var(--accent)] transition hover:bg-[rgba(96,139,239,0.15)]"
        >
          去处理
          <LucideIcons.ArrowRight size={10} />
        </button>
      ) : item.link ? (
        <button
          type="button"
          onClick={() => onAction(item)}
          className="mt-2 inline-flex items-center gap-1 rounded-lg bg-[rgba(140,140,140,0.08)] px-2.5 py-1 text-[11px] font-semibold text-[#5a6d8a] transition hover:bg-[rgba(140,140,140,0.15)]"
        >
          查看
          <LucideIcons.ArrowRight size={10} />
        </button>
      ) : null}
    </div>
  );
}
