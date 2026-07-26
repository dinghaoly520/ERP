import type { useRouter } from 'next/navigation';
import { markNotificationRead } from '@/lib/api/notification';

/** 通知点击所需的最小字段（与 NotificationItem 结构兼容）。 */
export interface ClickableNotification {
  id: string;
  isRead: boolean;
  link?: string | null;
}

type Router = ReturnType<typeof useRouter>;

/**
 * 通知点击的统一处理：未读先标记已读，再按 link 跳转。
 * - 内链（以 `/` 开头）走 router.push；
 * - 外链（http/https，如跳开评标端 :3007）走 window.open 新标签；
 * - 无 link 则仅标记已读。
 *
 * `onMarkedRead` 用于让调用页即时把本地列表里该条置为已读（纯 UX，失败不影响跳转）。
 * 这样工作台任务通知与 /notifications 页共用同一套"点击即已读+跳转"语义，
 * 解决此前任务通知点击既不标记已读、外链又无法跳转的问题。
 */
export function handleNotificationClick(
  n: ClickableNotification,
  router: Router,
  onMarkedRead?: (id: string) => void,
): void {
  if (!n.isRead) {
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
