'use client';

import { useMemo } from 'react';
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

const urgencyConfig: Record<
  NotificationUrgency,
  {
    bar: string;
    barBg: string;
    label: string;
    tagClass: string;
  }
> = {
  urgent: {
    bar: '#ef4444',
    barBg: 'bg-[#ef4444]',
    label: '紧急',
    tagClass: 'text-[#ef4444] bg-[#fef2f2] border-[#fecaca]',
  },
  important: {
    bar: '#f59e0b',
    barBg: 'bg-[#f59e0b]',
    label: '重要',
    tagClass: 'text-[#d97706] bg-[#fffbeb] border-[#fde68a]',
  },
  normal: {
    bar: '#3b82f6',
    barBg: 'bg-[#3b82f6]',
    label: '普通',
    tagClass: 'text-[#2563eb] bg-[#eff6ff] border-[#bfdbfe]',
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
  const urg = urgencyConfig[urgency];
  const resolved = !!item.resolvedAt;

  return (
    <button
      type="button"
      onClick={() => onAction(item)}
      className={`neu-card group relative flex w-full cursor-pointer items-start gap-3 px-3.5 py-3 text-left transition-all duration-200 hover:-translate-y-px ${
        resolved ? 'opacity-55' : ''
      } ${!item.isRead ? 'shadow-[0_2px_8px_rgba(96,139,239,0.1)]' : ''}`}
    >
      {/* 左侧色条 */}
      <div
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full"
        style={{ backgroundColor: urg.bar }}
      />

      {/* 未读指示 */}
      {!item.isRead && (
        <span className="absolute left-1.5 top-3.5 h-[6px] w-[6px] rounded-full bg-[#064ea2]" />
      )}

      {/* 图标 */}
      <span
        className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border transition-shadow duration-200 group-hover:shadow-sm"
        style={{
          color: tone.color,
          backgroundColor: tone.bg,
          borderColor: `${tone.color}22`,
        }}
      >
        <Icon size={15} strokeWidth={1.8} />
      </span>

      {/* 正文 */}
      <span className="min-w-0 flex-1">
        {/* 第一行：紧急度标签 + 时间 */}
        <span className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-md border px-1.5 py-px text-[10px] font-bold ${urg.tagClass}`}
          >
            {urg.label}
          </span>
          <span className="text-[11px] tabular-nums text-[#8a99ad]">
            {relTime(item.createdAt)}
          </span>
          {resolved && (
            <span className="rounded-full bg-[#ecfdf5] px-1.5 py-px text-[10px] font-semibold text-[#11a874]">
              已处理
            </span>
          )}
        </span>

        {/* 标题 */}
        <span
          className={`mt-1.5 block text-[13px] font-semibold leading-snug ${
            resolved
              ? 'text-[color:var(--muted-foreground)] line-through'
              : 'text-[#18243a]'
          }`}
        >
          {item.title}
        </span>

        {/* 摘要 */}
        {item.content && (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-[#5a6d8a] line-clamp-2">
            {item.content}
          </span>
        )}

        {/* 操作提示 — hover 可见 */}
        <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-[#064ea2] opacity-0 transition group-hover:opacity-100">
          {meta.actionable && !resolved ? '去处理' : '查看详情'}
          <LucideIcons.ArrowRight size={11} />
        </span>
      </span>
    </button>
  );
}
