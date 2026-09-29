import type { useRouter } from 'next/navigation';
import { getNotificationMeta } from '@water-erp/shared';
import { markNotificationRead } from '@/lib/api/notification';

/** 通知点击所需的最小字段（与 NotificationItem 结构兼容）。 */
export interface ClickableNotification {
  id: string;
  isRead: boolean;
  link?: string | null;
  type?: string | null;
}

type Router = ReturnType<typeof useRouter>;

/**
 * 通知点击的统一处理：知会类未读先标记已读，再按 link 跳转。
 * - 内链（以 `/` 开头）走 router.push；
 * - 外链（http/https，如跳开评标端 :3007）走 window.open 新标签；
 * - actionable 待办只跳转不标已读——五段模型"已读兜底归已办"，点开≠办结，
 *   标了会把待办误归已办（2026-09-29 修复，后端单条已读端点同步拒写，双保险）。
 *
 * `onMarkedRead` 用于让调用页即时把本地列表里该条置为已读（纯 UX，失败不影响跳转）。
 */
export function handleNotificationClick(
  n: ClickableNotification,
  router: Router,
  onMarkedRead?: (id: string) => void,
): void {
  const actionable = !!n.type && !!getNotificationMeta(n.type)?.actionable;
  if (!n.isRead && !actionable) {
    void markNotificationRead(n.id)
      .then(() => onMarkedRead?.(n.id))
      .catch(() => {});
  }
  const link = n.link;
  if (!link) return;
  if (link.startsWith('/')) {
    router.push(link);
  } else {
    window.open(link, '_blank', 'noopener');
  }
}
