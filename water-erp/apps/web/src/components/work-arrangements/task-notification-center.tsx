'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, UserCheck, Tag, AlertTriangle, Bell } from 'lucide-react';
import { AiPlanningPanel } from '@/components/work-arrangements/ai-planning-panel';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';
import { useNotifications } from '@/lib/hooks/use-notifications';
import type { NotificationItem } from '@/lib/api/notification';

export interface PlannedItem {
  title: string;
  estimatedMinutes: number;
  link: string;
}

// ── 从通知内容中提取核心名称 ──

function extractName(item: NotificationItem): string {
  const c = item.content || '';
  // 供应商名称："供应商"xxx"提交" → xxx
  const quoted = c.match(/[""]([^""]{2,20})[""]/);
  if (quoted) return quoted[1];
  // 商品名："断路器CDB6i" 等
  const itemMatch = c.match(/([^""]+?)报价调整|申请加入|价格调整|即将到期|投标截止/);
  if (itemMatch) return itemMatch[1].replace(/[「」""]/g, '').slice(0, 12);
  // 项目名：项目"xxx"
  const pj = c.match(/项目[""]([^""]{2,16})[""]/);
  if (pj) return pj[1];
  // 兜底：取前12字
  return c.slice(0, 12);
}

// ── 分组定义 ──

interface GroupDef {
  type: string;
  label: string;
  icon: typeof UserCheck;
  iconBg: string;
  iconColor: string;
  link: string;
}

const GROUP_DEFS: GroupDef[] = [
  { type: 'SUPPLIER_PENDING',      label: '供应商审批', icon: UserCheck,     iconBg: '#eff6ff', iconColor: '#064ea2', link: '/supplier/approval' },
  { type: 'PRICE_REVIEW',          label: '价格复核',   icon: Tag,           iconBg: '#f5f3ff', iconColor: '#7c3aed', link: '/mall-management/approval' },
  { type: 'QUALIFICATION_EXPIRING',label: '资质到期',   icon: AlertTriangle, iconBg: '#fff7ed', iconColor: '#f5a623', link: '/supplier/repository' },
  { type: 'BID_REMINDER',          label: '投标提醒',   icon: Bell,          iconBg: '#fff7ed', iconColor: '#d97706', link: '/projects' },
  { type: 'BID_PUBLISHED',         label: '招标公告',   icon: Bell,          iconBg: '#eff6ff', iconColor: '#2563eb', link: '/projects' },
  { type: 'SYSTEM',                label: '系统通知',   icon: Bell,          iconBg: '#f8fafc', iconColor: '#5a6d8a', link: '/notifications' },
];

const GROUP_ORDER = ['SUPPLIER_PENDING', 'PRICE_REVIEW', 'QUALIFICATION_EXPIRING', 'BID_REMINDER', 'BID_PUBLISHED', 'SYSTEM'];

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
  dailyPlan,
  refreshingPlan,
  showProjectBrief = false,
  onRefreshPlan,
  onSelectTimeBlock,
  onAddToCalendar,
  onShowHistory,
}: TaskNotificationCenterProps) {
  const router = useRouter();
  const { recent, markRead } = useNotifications();

  const groups = useMemo(() => {
    const byType = new Map<string, NotificationItem[]>();
    for (const item of recent) {
      const list = byType.get(item.type) || [];
      list.push(item);
      byType.set(item.type, list);
    }

    return GROUP_DEFS
      .filter((def) => {
        const items = byType.get(def.type);
        return items && items.length > 0;
      })
      .map((def) => {
        const items = byType.get(def.type)!;
        const unread = items.filter((n) => !n.isRead).length;
        const names = items
          .filter((n) => !n.isRead)
          .map(extractName)
          .slice(0, 4);
        return { ...def, count: items.length, unread, names };
      })
      .sort(
        (a, b) =>
          GROUP_ORDER.indexOf(a.type) - GROUP_ORDER.indexOf(b.type),
      );
  }, [recent]);

  const handleGroupClick = async (def: GroupDef, items: NotificationItem[]) => {
    for (const item of items.filter((n) => !n.isRead)) {
      await markRead(item.id);
    }
    router.push(def.link);
  };

  if (groups.length === 0) {
    return (
      <section className="wb-panel">
        <div className="wb-panel-header">
          <span className="text-[15px] font-bold text-[#18243a]">任务通知</span>
        </div>
        <div className="wb-panel-body py-6 text-center text-sm text-[color:var(--muted-foreground)]">
          暂无通知
        </div>
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

  return (
    <section className="wb-panel">
      <div className="wb-panel-header">
        <span className="text-[15px] font-bold text-[#18243a]">任务通知</span>
      </div>
      <div className="wb-panel-body flex flex-col gap-3">
        {/* 按模块分组，每行一组 */}
        {groups.map((g) => {
          const byType = new Map<string, NotificationItem[]>();
          for (const item of recent) {
            const list = byType.get(item.type) || [];
            list.push(item);
            byType.set(item.type, list);
          }
          const items = byType.get(g.type) || [];
          return (
            <button
              key={g.type}
              type="button"
              onClick={() => handleGroupClick(g, items)}
              className="group flex items-center gap-3 rounded-[12px] px-3.5 py-2.5 text-left transition hover:bg-[var(--accent-soft)]/10"
            >
              {/* 图标 */}
              <span
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: g.iconBg }}
              >
                <g.icon size={13} style={{ color: g.iconColor }} />
              </span>

              {/* 标签 + 名称列表 */}
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-[13px] font-bold text-[#18243a]">
                    {g.label}
                  </span>
                  <span
                    className="rounded-md px-1.5 py-px text-[11px] font-bold tabular-nums"
                    style={{
                      color: g.unread > 0 ? g.iconColor : '#8a99ad',
                      backgroundColor:
                        g.unread > 0
                          ? `${g.iconColor}14`
                          : 'transparent',
                    }}
                  >
                    {g.unread > 0 ? `${g.unread}条待处理` : '全部已处理'}
                  </span>
                </span>
                {g.names.length > 0 && (
                  <span className="mt-0.5 block truncate text-[11px] leading-relaxed text-[#5a6d8a]">
                    {g.names.join('、')}
                  </span>
                )}
              </span>

              {/* 箭头 */}
              <ArrowRight
                size={13}
                className="flex-shrink-0 text-[color:var(--accent)] opacity-0 transition group-hover:opacity-100"
              />
            </button>
          );
        })}
      </div>

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
