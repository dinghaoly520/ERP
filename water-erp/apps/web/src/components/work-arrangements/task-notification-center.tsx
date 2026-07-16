'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as LucideIcons from 'lucide-react';
import { getNotificationMeta, statusTone } from '@water-erp/shared';
import { AiPlanningPanel } from '@/components/work-arrangements/ai-planning-panel';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';
import type { NotificationItem } from '@/lib/api/notification';
import { listNotifications } from '@/lib/api/notification';
import { useNotifications } from '@/lib/hooks/use-notifications';

export interface PlannedItem {
  title: string;
  estimatedMinutes: number;
  link: string;
}

// ── 中文标签 + 跳转链接 ──

const TYPE_LABELS: Record<string, string> = {
  SUPPLIER_PENDING:       '供应商审批',
  SUPPLIER_APPROVED:      '供应商入库',
  SUPPLIER_REJECTED:      '供应商驳回',
  SUPPLIER_RETURNED:      '退回补正',
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
  CATALOG_APPLICATION:    '/mall-management/approval',
  SYSTEM:                 '/notifications',
};

const ACTIONABLE_ORDER = [
  'SUPPLIER_PENDING', 'PRICE_REVIEW', 'QUALIFICATION_EXPIRING',
  'BID_REMINDER', 'SUPPLIER_RETURNED',
];

// 特定标题的系统通知——赋予场景化图标
const TITLE_ICONS: Record<string, string> = {
  '预算预警':   'TrendingDown',
  '合同提醒':   'FileText',
  '专家抽取':   'Users',
  '阶段变更':   'GitBranch',
  '工作安排':   'ClipboardList',
  '公告发布':   'Megaphone',
  '目录更新':   'ShoppingBag',
  '澄清请求':   'MessageCircle',
};

function resolveIcon(type: string, title: string): string {
  if (TITLE_ICONS[title]) return TITLE_ICONS[title];
  return getNotificationMeta(type).icon;
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
  const [directItems, setDirectItems] = useState<NotificationItem[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    listNotifications('all', 1, 50).then((res) => {
      if (!cancelled) { setDirectItems(res.items); setTotalCount(res.total); }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const source = directItems && directItems.length > 0 ? directItems : recent;

  // 每条通知独立展示完整标题和内容，不按类型聚合
  const flatItems = useMemo(() => {
    return source
      .map((item) => {
        const meta = getNotificationMeta(item.type);
        const tone = statusTone[meta.tone] ?? statusTone.gray;
        return {
          ...item,
          typeLabel: TYPE_LABELS[item.type] ?? item.type,
          link: item.link || TYPE_LINKS[item.type] || '/notifications',
          icon: resolveIcon(item.type, item.title),
          toneColor: tone.color,
          toneBg: tone.bg,
        };
      })
      .sort((a, b) => {
        // 未读优先
        if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
        // 可操作类型优先
        const ai = ACTIONABLE_ORDER.indexOf(a.type);
        const bi = ACTIONABLE_ORDER.indexOf(b.type);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        // 最新在前
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [source]);

  return (
    <section className="wb-panel">
      <div className="wb-panel-header flex items-center justify-between">
        <span className="text-[15px] font-bold text-[#18243a]">任务通知</span>
        {flatItems.length > 0 && (
          <span className="text-[11px] tabular-nums text-[color:var(--muted-foreground)]">
            共 {flatItems.length} 条通知
          </span>
        )}
      </div>

      {flatItems.length === 0 ? (
        <div className="flex-1 py-10 text-center text-sm text-[color:var(--muted-foreground)]">
          暂无通知
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          {flatItems.map((item) => {
            const Icon = (LucideIcons as any)[item.icon] ?? LucideIcons.Bell;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => router.push(item.link)}
                className="group flex flex-col gap-1 border-b border-[#eef3f8] px-4 py-3 text-left transition last:border-b-0 hover:bg-[var(--accent-soft)]/8"
              >
                {/* ── Title row: icon + title + neumorphic badge ── */}
                <span className="flex items-center gap-3">
                  <span
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
                    style={{ backgroundColor: item.toneBg }}
                  >
                    <Icon size={12} style={{ color: item.toneColor }} />
                  </span>

                  <span className="min-w-0 flex-1 text-[13px] font-bold text-[#18243a]">
                    {item.title}
                  </span>

                  {/* ── Neumorphic badge — "待处理" pill ── */}
                  {!item.isRead && (
                    <span
                      className="shrink-0 flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold tracking-wide"
                      style={{
                        color: item.toneColor,
                        backgroundColor: `color-mix(in oklch, ${item.toneColor} 8%, transparent)`,
                        boxShadow:
                          'inset 0 1px 0 oklch(1 0 0 / 0.55), 1px 1px 2px oklch(0.55 0.03 258 / 0.1), -1px -1px 2px oklch(1 0 0 / 0.75)',
                      }}
                    >
                      <span
                        className="h-1 w-1 rounded-full"
                        style={{ backgroundColor: item.toneColor }}
                      />
                      待处理
                    </span>
                  )}
                </span>

                {/* ── Content row — specific details ── */}
                {item.content && (
                  <span className="ml-9 text-[12px] leading-relaxed text-[#5a6d8a] line-clamp-2">
                    {item.content}
                  </span>
                )}
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
