'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ListChecks } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { getNotificationMeta, statusTone } from '@water-erp/shared';
import { portalURL } from '@water-erp/config';
import { AiPlanningPanel } from '@/components/work-arrangements/ai-planning-panel';
import { Modal } from '@/components/workbench';
import type { WorkArrangementDailyPlan } from '@/lib/types/work-arrangements';
import type { NotificationItem } from '@/lib/api/notification';
import { listNotifications } from '@/lib/api/notification';
import { handleNotificationClick } from '@/lib/notification-click';
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
  CATALOG_PRICE_ALERT:    '目录价格预警',
  SYSTEM:                 '系统通知',
};

// 兜底链接：仅在后端未下发 link 时使用。注意 /bid、/bid/clarifications、
// /supplier/qualifications 在 :3005 不存在（属开评标端 :3007 或写错），
// 故其余类型一律改指 :3005 内真实页面；澄清答疑归 :3007（分工 v3）。
const TYPE_LINKS: Record<string, string> = {
  SUPPLIER_PENDING:       '/supplier/approval',
  SUPPLIER_APPROVED:      '/supplier/repository',
  SUPPLIER_REJECTED:      '/supplier/approval',
  SUPPLIER_RETURNED:      '/supplier/approval',
  PRICE_REVIEW:           '/mall-management/catalog?tab=approval',
  QUALIFICATION_EXPIRING: '/supplier/qualification-alerts',
  BID_PUBLISHED:          '/projects',
  BID_REMINDER:           '/projects',
  BID_OPENING:            portalURL('bid', '/bid'), // 开标大厅在 :3007（纯开标执行终端）
  BID_EVALUATION_RESULT:  '/projects',              // 评标结果回传 :3005 指挥中心查看
  CLARIFICATION_REPLIED:  portalURL('bid', '/bid'), // 澄清答疑归 :3007（分工 v3），:3005 无该页面
  CATALOG_APPLICATION:    '/mall-management/catalog?tab=approval',
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

// ── 通知条目增强 ──

type EnrichedItem = NotificationItem & {
  typeLabel: string;
  link: string;
  icon: string;
  toneColor: string;
  toneBg: string;
};

function enrich(item: NotificationItem): EnrichedItem {
  const meta = getNotificationMeta(item.type);
  const tone = statusTone[meta.tone] ?? statusTone.gray;
  // 强制覆盖跨端链接（种子/历史写死的死链也失效）：BID_OPENING / CLARIFICATION_REPLIED
  // 的操作面都在 :3007（分工 v3：澄清答疑迁回现场端），:3005 内无对应页面。
  const forced =
    item.type === 'BID_OPENING' ? portalURL('bid', '/bid')
    : item.type === 'CLARIFICATION_REPLIED' ? portalURL('bid', '/bid')
    : null;
  const link = (forced ?? item.link ?? TYPE_LINKS[item.type]) || '/notifications';
  return {
    ...item,
    typeLabel: TYPE_LABELS[item.type] ?? item.type,
    link,
    icon: resolveIcon(item.type, item.title),
    toneColor: tone.color,
    toneBg: tone.bg,
  };
}

function sortNotifications(items: EnrichedItem[]): EnrichedItem[] {
  return [...items].sort((a, b) => {
    if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
    const ai = ACTIONABLE_ORDER.indexOf(a.type);
    const bi = ACTIONABLE_ORDER.indexOf(b.type);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

// ── 同类通知聚合（同 type+title 多条折叠为一组，避免批量通知刷屏）──

type GroupedItem =
  | { kind: 'single'; key: string; item: EnrichedItem }
  | { kind: 'group'; key: string; typeLabel: string; toneColor: string; toneBg: string; icon: string; items: EnrichedItem[] };

function groupByType(items: EnrichedItem[]): GroupedItem[] {
  const map = new Map<string, EnrichedItem[]>();
  for (const it of items) {
    const key = `${it.type}::${it.title}`;
    const arr = map.get(key) ?? [];
    arr.push(it);
    map.set(key, arr);
  }
  const groups: GroupedItem[] = [];
  for (const [k, arr] of map.entries()) {
    if (arr.length > 1) {
      const head = arr[0];
      groups.push({ kind: 'group', key: k, typeLabel: head.typeLabel, toneColor: head.toneColor, toneBg: head.toneBg, icon: head.icon, items: arr });
    } else {
      groups.push({ kind: 'single', key: arr[0].id, item: arr[0] });
    }
  }
  // 按组内最新条目时间排序（sortNotifications 已对单条排过，组内顺序保留）
  groups.sort((a, b) => {
    const aKey = a.kind === 'single' ? a.item : a.items[0];
    const bKey = b.kind === 'single' ? b.item : b.items[0];
    return new Date(bKey.createdAt).getTime() - new Date(aKey.createdAt).getTime();
  });
  return groups;
}

function AggregatedGroup({ group, router }: { group: Extract<GroupedItem, { kind: 'group' }>; router: ReturnType<typeof useRouter> }) {
  const [open, setOpen] = useState(false);
  const { items, typeLabel, toneColor, toneBg, icon } = group;
  const Icon = (LucideIcons as any)[icon] ?? LucideIcons.Bell;
  const unread = items.filter((i) => !i.isRead).length;
  return (
    <>
      <div className="border-b border-[#eef3f8] last:border-b-0">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex w-full flex-col gap-1 px-4 py-3 text-left transition hover:bg-[var(--accent-soft)]/8"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: toneBg }}>
              <Icon size={12} style={{ color: toneColor }} />
            </span>
            <span className="min-w-0 flex-1 text-[13px] font-bold text-[#18243a]">{typeLabel}</span>
            <span
              className="shrink-0 flex items-center gap-1 rounded-lg px-2.5 py-1 text-[10px] font-bold tracking-wide"
              style={{ color: toneColor, backgroundColor: `color-mix(in oklch, ${toneColor} 8%, transparent)`, boxShadow: 'inset 0 1px 0 oklch(1 0 0 / 0.55), 1px 1px 2px oklch(0.55 0.03 258 / 0.1), -1px -1px 2px oklch(1 0 0 / 0.75)' }}
            >
              <span className="h-1 w-1 rounded-full" style={{ backgroundColor: toneColor }} />
              {unread > 0 ? `${unread} 项待处理` : `${items.length} 项`}
            </span>
          </span>
          <span className="ml-9 text-[12px] text-[#5a6d8a]">点击查看 {items.length} 条明细</span>
        </button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="md"
        title={
          <span className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ backgroundColor: toneBg }}>
              <Icon size={13} style={{ color: toneColor }} />
            </span>
            {typeLabel} · {items.length} 项
          </span>
        }
        description={unread > 0 ? `${unread} 项待处理` : undefined}
      >
        <div className="-mx-2 max-h-[60vh] overflow-y-auto divide-y divide-[#eef3f8]">
          {items.map((item) => (
            <NotificationRow
              key={item.id}
              item={item}
              onClick={() => {
                handleNotificationClick(item, router);
                setOpen(false);
              }}
            />
          ))}
        </div>
      </Modal>
    </>
  );
}

// ── 单条通知行（在面板和弹窗中共用）──

function NotificationRow({
  item,
  onClick,
}: {
  item: EnrichedItem;
  onClick: () => void;
}) {
  const Icon = (LucideIcons as any)[item.icon] ?? LucideIcons.Bell;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-1 border-b border-[#eef3f8] px-4 py-3 text-left transition last:border-b-0 hover:bg-[var(--accent-soft)]/8"
    >
      {/* Title row: icon + title + neumorphic badge */}
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

      {/* Content row */}
      {item.content && (
        <span className="ml-9 text-[12px] leading-relaxed text-[#5a6d8a] line-clamp-2">
          {item.content}
        </span>
      )}
    </button>
  );
}

// ── 主组件 ──

interface TaskNotificationCenterProps {
  dailyPlan: WorkArrangementDailyPlan | null;
  refreshingPlan: boolean;
  onRefreshPlan: () => void;
  onSelectTimeBlock: (taskIds: string[]) => void;
  onAddToCalendar: (items: PlannedItem[]) => void;
}

export function TaskNotificationCenter({
  dailyPlan, refreshingPlan,
  onRefreshPlan, onSelectTimeBlock, onAddToCalendar,
}: TaskNotificationCenterProps) {
  const router = useRouter();
  const { recent } = useNotifications();
  const [directItems, setDirectItems] = useState<NotificationItem[] | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listNotifications('all', 1, 50).then((res) => {
      if (!cancelled) { setDirectItems(res.items); setTotalCount(res.total); }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const source = directItems && directItems.length > 0 ? directItems : recent;

  const allItems = useMemo(
    () => sortNotifications(source.map(enrich)),
    [source],
  );

  // 同类通知聚合：同 type+title 多条折叠为一组（避免目录价格预警等批量通知刷屏）
  const grouped = useMemo(() => groupByType(allItems), [allItems]);
  const shownGroups = grouped.slice(0, 10);
  const hasMore = grouped.length > 10;

  return (
    <>
      <section className="wb-panel flex-1">
        <div className="wb-panel-header flex items-center justify-between">
          <span className="text-[15px] font-bold text-[#18243a]">任务通知</span>
          {allItems.length > 0 && (
            <span className="text-[11px] tabular-nums text-[color:var(--muted-foreground)]">
              共 {allItems.length} 条{hasMore ? '，显示前 10 条' : ''}
            </span>
          )}
        </div>

        {allItems.length === 0 ? (
          <div className="flex-1 py-10 text-center text-sm text-[color:var(--muted-foreground)]">
            暂无通知
          </div>
        ) : (
          <div className="flex flex-1 flex-col min-h-0 overflow-y-auto">
            {shownGroups.map((g) =>
              g.kind === 'single' ? (
                <NotificationRow key={g.key} item={g.item} onClick={() => handleNotificationClick(g.item, router)} />
              ) : (
                <AggregatedGroup key={g.key} group={g} router={router} />
              ),
            )}

            {/* ── 查看更多 ── */}
            {hasMore && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="flex items-center justify-center gap-1.5 border-b border-[#eef3f8] px-4 py-2.5 text-[12px] font-semibold text-[color:var(--accent)] transition last:border-b-0 hover:bg-[var(--accent-soft)]/10"
              >
                <ListChecks size={14} />
                查看更多（共 {grouped.length - 10} 组未显示）
              </button>
            )}
          </div>
        )}

        <hr className="wb-section-rule" />

        <div className="wb-panel-body">
          <AiPlanningPanel
            dailyPlan={dailyPlan} refreshingPlan={refreshingPlan}
            onRefreshPlan={() => onRefreshPlan()}
            onSelectTimeBlock={onSelectTimeBlock}
          />
        </div>
      </section>

      {/* ── 全部通知弹窗 ── */}
      {showAll && (
        <Modal
          open
          onClose={() => setShowAll(false)}
          title={
            <span className="flex items-center gap-2.5">
              <ListChecks size={18} className="text-[color:var(--accent)]" />
              全部通知
            </span>
          }
          description={`共 ${allItems.length} 条通知（${grouped.length} 组）`}
          size="lg"
        >
          <div className="-mx-2 max-h-[60vh] overflow-y-auto divide-y divide-[#eef3f8]">
            {grouped.map((g) =>
              g.kind === 'single' ? (
                <NotificationRow
                  key={g.key}
                  item={g.item}
                  onClick={() => {
                    handleNotificationClick(g.item, router);
                    setShowAll(false);
                  }}
                />
              ) : (
                <AggregatedGroup key={g.key} group={g} router={router} />
              ),
            )}
            {allItems.length === 0 && (
              <div className="py-16 text-center text-sm text-[color:var(--muted-foreground)]">
                暂无通知
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
