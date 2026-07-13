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

// ── 名称提取 ──
// 中文引号 U+201C (") U+201D (")
const LQ = '“';
const RQ = '”';

function extractName(item: NotificationItem): string {
  const c = item.content || '';

  // 1) 中文引号包裹的名称
  const re = new RegExp(`${LQ}([^${LQ}${RQ}]{2,20})${RQ}`);
  const m = c.match(re);
  if (m) return m[1];

  // 2) 商品名/项目名 (在明确动作关键字之前)
  const kws = '报价调整|申请加入|价格调整|投标截止|评标已结|已发布招标|将于.*开标|已通过审核|审核不通过|已被退回|已回复|即将到期|提交了入库';
  const kw = c.match(new RegExp(`^(.+?)(${kws})`));
  if (kw) {
    const raw = kw[1].replace(/[""'',，。]/g, '').trim();
    if (raw.length >= 2 && raw.length <= 22) return raw;
  }

  // 3) 标题去前缀
  const t = (item.title || '').replace(/^(新供应商|供应商|采购目录|新增品类|月度|周度|系统)/, '');
  if (t.length >= 2 && t.length <= 16) return t;

  return c.slice(0, 12);
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
  CATALOG_APPLICATION:    '/mall-management/catalog',
  SYSTEM:                 '/notifications',
};

const ACTIONABLE_ORDER = [
  'SUPPLIER_PENDING', 'PRICE_REVIEW', 'QUALIFICATION_EXPIRING',
  'BID_REMINDER', 'SUPPLIER_RETURNED',
];

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
          .filter(Boolean)
          .slice(0, 5);
        return {
          type, items,
          label: TYPE_LABELS[type] ?? type,
          link: TYPE_LINKS[type] ?? '/notifications',
          icon: meta.icon, toneColor: tone.color, toneBg: tone.bg,
          count: items.length, unread, names,
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
      <div className="wb-panel-header flex items-center justify-between">
        <span className="text-[15px] font-bold text-[#18243a]">任务通知</span>
        {groups.length > 0 && (
          <span className="text-[11px] tabular-nums text-[color:var(--muted-foreground)]">
            {groups.length} 类 · {groups.reduce((s, g) => s + g.count, 0)} 条
          </span>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="flex-1 py-10 text-center text-sm text-[color:var(--muted-foreground)]">
          暂无通知
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          {groups.map((g) => {
            const Icon = (LucideIcons as any)[g.icon] ?? LucideIcons.Bell;
            return (
              <button
                key={g.type}
                type="button"
                onClick={() => router.push(g.link)}
                className="group flex items-start gap-3 border-b border-[#eef3f8] px-4 py-2.5 text-left transition last:border-b-0 hover:bg-[var(--accent-soft)]/8"
              >
                <span
                  className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: g.toneBg }}
                >
                  <Icon size={12} style={{ color: g.toneColor }} />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[13px] font-bold text-[#18243a]">{g.label}</span>
                    {g.unread > 0 ? (
                      <span
                        className="rounded-md px-1.5 py-px text-[10px] font-bold tabular-nums"
                        style={{ color: g.toneColor, backgroundColor: `${g.toneColor}15` }}
                      >
                        {g.unread}条待处理
                      </span>
                    ) : (
                      <span className="text-[11px] text-[#8a99ad]">{g.count}条</span>
                    )}
                  </span>
                  {g.names.length > 0 && (
                    <span className="mt-0.5 block text-[11px] leading-snug text-[#5a6d8a] line-clamp-2">
                      {g.names.join('、')}
                    </span>
                  )}
                </span>

                <ArrowRight
                  size={13}
                  className="mt-0.5 flex-shrink-0 text-[color:var(--accent)] opacity-0 transition group-hover:opacity-100"
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
