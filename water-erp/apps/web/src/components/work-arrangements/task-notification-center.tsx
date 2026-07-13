'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { getNotificationMeta, statusTone } from '@water-erp/shared';
import { AiPlanningPanel } from '@/components/work-arrangements/ai-planning-panel';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';
import type { NotificationItem } from '@/lib/api/notification';
import { useNotifications } from '@/lib/hooks/use-notifications';

export interface PlannedItem {
  title: string;
  estimatedMinutes: number;
  link: string;
}

// ── 完整通知类型 → 中文标签 ──

const TYPE_LABELS: Record<string, string> = {
  SUPPLIER_PENDING:       '供应商审批',
  SUPPLIER_APPROVED:      '供应商入库',
  SUPPLIER_REJECTED:      '供应商驳回',
  SUPPLIER_RETURNED:      '供应商退回补正',
  PRICE_REVIEW:           '价格复核',
  QUALIFICATION_EXPIRING: '资质到期',
  BID_PUBLISHED:          '招标公告',
  BID_REMINDER:           '投标提醒',
  BID_OPENING:            '开标通知',
  BID_EVALUATION_RESULT:  '评标结果',
  CLARIFICATION_REPLIED:  '澄清答疑',
  CATALOG_APPLICATION:    '目录申请',
  SYSTEM:                 '系统通知',
};

// ── 通知类型 → 跳转链接 ──

const TYPE_LINKS: Record<string, string> = {
  SUPPLIER_PENDING:       '/supplier/approval',
  SUPPLIER_APPROVED:      '/supplier/repository',
  SUPPLIER_REJECTED:      '/supplier/approval',
  SUPPLIER_RETURNED:      '/supplier/approval',
  PRICE_REVIEW:           '/mall-management/approval',
  QUALIFICATION_EXPIRING: '/supplier/repository',
  BID_PUBLISHED:          '/projects',
  BID_REMINDER:           '/projects',
  BID_OPENING:            '/bid',
  BID_EVALUATION_RESULT:  '/bid',
  CLARIFICATION_REPLIED:  '/bid/clarifications',
  CATALOG_APPLICATION:    '/mall-management/catalog',
  SYSTEM:                 '/notifications',
};

// ── 可操作的（待办类）类型排前面 ──

const ACTIONABLE_ORDER = [
  'SUPPLIER_PENDING', 'PRICE_REVIEW', 'QUALIFICATION_EXPIRING',
  'BID_REMINDER', 'SUPPLIER_RETURNED',
];

// ── 从通知内容中提取核心名称 ──

function extractName(item: NotificationItem): string {
  const c = item.content || '';
  // 引号包裹的名称
  const quoted = c.match(/[""]([^""]{2,20})[""]/);
  if (quoted) return quoted[1];
  // 项目名
  const pj = c.match(/项目[""]([^""]{2,16})[""]/);
  if (pj) return pj[1];
  // 标题本身可能包含名称
  if (item.title && item.title.length <= 20) return item.title;
  return c.slice(0, 12);
}

function labelFor(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function linkFor(type: string): string {
  return TYPE_LINKS[type] ?? '/notifications';
}

// ── 主组件 ──

interface TaskNotificationCenterProps {
  dailyPlan: WorkArrangementDailyPlan | null;
  refreshingPlan: boolean;
  showProjectBrief?: boolean;
  onRefreshPlan: () => void;
  onSelectTimeBlock: (taskIds: string[]) => void;
  onAddToCalendar: (items: PlannedItem[]) => void;
  onShowHistory: () => void;
}

export function TaskNotificationCenter({
  dailyPlan, refreshingPlan, showProjectBrief = false,
  onRefreshPlan, onSelectTimeBlock, onAddToCalendar, onShowHistory,
}: TaskNotificationCenterProps) {
  const router = useRouter();
  const { recent } = useNotifications();

  const groups = useMemo(() => {
    const byType = new Map<string, NotificationItem[]>();
    for (const item of recent) {
      const list = byType.get(item.type) || [];
      list.push(item);
      byType.set(item.type, list);
    }

    return [...byType.entries()]
      .map(([type, items]) => {
        const meta = getNotificationMeta(type);
        const tone = statusTone[meta.tone] ?? statusTone.gray;
        const unread = items.filter((n) => !n.isRead).length;
        const names = items
          .filter((n) => !n.isRead)
          .map(extractName)
          .slice(0, 4);
        return {
          type,
          label: labelFor(type),
          link: linkFor(type),
          icon: meta.icon,
          toneColor: tone.color,
          toneBg: tone.bg,
          count: items.length,
          unread,
          names,
        };
      })
      .sort((a, b) => {
        const ai = ACTIONABLE_ORDER.indexOf(a.type);
        const bi = ACTIONABLE_ORDER.indexOf(b.type);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.label.localeCompare(b.label, 'zh');
      });
  }, [recent]);

  return (
    <section className="wb-panel">
      <div className="wb-panel-header">
        <span className="text-[15px] font-bold text-[#18243a]">任务通知</span>
      </div>

      {groups.length === 0 ? (
        <div className="wb-panel-body py-6 text-center text-sm text-[color:var(--muted-foreground)]">
          暂无通知
        </div>
      ) : (
        <div className="wb-panel-body flex flex-col gap-2">
          {groups.map((g) => {
            const Icon = (LucideIcons as any)[g.icon] ?? LucideIcons.Bell;
            return (
              <button
                key={g.type}
                type="button"
                onClick={() => router.push(g.link)}
                className="group flex items-center gap-3 rounded-[12px] px-3.5 py-2.5 text-left transition hover:bg-[var(--accent-soft)]/10"
              >
                {/* 图标 */}
                <span
                  className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: g.toneBg }}
                >
                  <Icon size={13} style={{ color: g.toneColor }} />
                </span>

                {/* 标签 + 名称 */}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[13px] font-bold text-[#18243a]">{g.label}</span>
                    <span
                      className="rounded-md px-1.5 py-px text-[11px] font-bold tabular-nums"
                      style={{
                        color: g.unread > 0 ? g.toneColor : '#8a99ad',
                        backgroundColor: g.unread > 0 ? `${g.toneColor}14` : 'transparent',
                      }}
                    >
                      {g.unread > 0 ? `${g.unread}条待处理` : `${g.count}条`}
                    </span>
                  </span>
                  {g.names.length > 0 && (
                    <span className="mt-0.5 block truncate text-[11px] leading-relaxed text-[#5a6d8a]">
                      {g.names.join('、')}
                    </span>
                  )}
                </span>

                <ArrowRight
                  size={13}
                  className="flex-shrink-0 text-[color:var(--accent)] opacity-0 transition group-hover:opacity-100"
                />
              </button>
            );
          })}
        </div>
      )}

      <hr className="wb-section-rule" />

      <div className="wb-panel-body">
        <AiPlanningPanel
          dailyPlan={dailyPlan} refreshingPlan={refreshingPlan}
          showProjectBrief={showProjectBrief}
          onRefreshPlan={() => onRefreshPlan()}
          onSelectTimeBlock={onSelectTimeBlock} onShowHistory={onShowHistory}
        />
      </div>
    </section>
  );
}
