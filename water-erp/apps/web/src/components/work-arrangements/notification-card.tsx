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

const urgencyStyles: Record<
  NotificationUrgency,
  { bar: string; label: string; labelColor: string }
> = {
  urgent: {
    bar: 'bg-[#ef4444]',
    label: '紧急',
    labelColor: 'text-[#ef4444] bg-[#fef2f2]',
  },
  important: {
    bar: 'bg-[#f59e0b]',
    label: '重要',
    labelColor: 'text-[#f59e0b] bg-[#fffbeb]',
  },
  normal: {
    bar: 'bg-[#3b82f6]',
    label: '普通',
    labelColor: 'text-[#3b82f6] bg-[#eff6ff]',
  },
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
  const urgStyle = urgencyStyles[urgency];
  const resolved = !!item.resolvedAt;

  return (
    <button
      type="button"
      onClick={() => onAction(item)}
      className={`neu-card group relative flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition ${
        resolved ? 'opacity-60' : ''
      }`}
    >
      {/* 紧急度左侧色条 */}
      <div className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-full ${urgStyle.bar}`} />

      {/* 未读小圆点 */}
      {!item.isRead && (
        <span className="absolute left-[7px] top-2 h-1.5 w-1.5 rounded-full bg-[#064ea2]" />
      )}

      {/* 图标 */}
      <span
        className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
        style={{ color: tone.color, backgroundColor: tone.bg }}
      >
        <Icon size={14} strokeWidth={2} />
      </span>

      {/* 内容 */}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-[6px] px-1.5 py-0.5 text-[10px] font-bold ${urgStyle.labelColor}`}
          >
            {urgStyle.label}
          </span>
          <span className="text-[11px] text-[#8a99ad] tabular-nums">
            {relTime(item.createdAt)}
          </span>
        </span>
        <span className="mt-1 block text-[13px] font-semibold leading-snug text-[#18243a]">
          {item.title}
        </span>
        <span className="mt-0.5 block truncate text-[11px] leading-relaxed text-[#5a6d8a]">
          {item.content}
        </span>
        <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-[#064ea2] opacity-0 transition group-hover:opacity-100">
          {meta.actionable && !resolved ? '去处理' : '查看'}
          <LucideIcons.ArrowRight size={11} />
        </span>
      </span>
    </button>
  );
}
