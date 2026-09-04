"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { serverNowMs } from "@water-erp/shared";
import { toast } from "sonner";
import {
  AlarmClock, Bell, Check, CircleCheck, ClipboardList, ExternalLink, FileCheck2,
  Inbox, Megaphone, MessageSquare, Search, TriangleAlert,
} from "lucide-react";
import { notificationApi, type SupplierNotification } from "@/lib/api/notification";
import { useNotifications } from "@/lib/notification-context";
import {
  getNotificationMeta, notificationTypesForGroup, resolveNotificationLink,
  summarizeNotification, type NotificationGroup, type NotificationTone,
} from "@/lib/notification-meta";
import { SpPageHero } from "@/components/sp-page-hero";
import { LoadingBlock, SpDialog, SpPagination } from "@/components/ui";
import "@/styles/pages/notifications.css"; // nd-*/notif-* 通知样式（原寄居 announcements.css，2026-09-02 归位）

const NEW_WINDOW_MS = 48 * 3600 * 1000;
const PAGE_SIZE = 15;

const GROUPS: Array<{ value: NotificationGroup | "all"; label: string }> = [
  { value: "all", label: "全部" },
  { value: "todo", label: "待办" },
  { value: "project", label: "项目动态" },
  { value: "approval", label: "审批" },
  { value: "contract", label: "合同" },
  { value: "system", label: "系统" },
];

const GROUP_ICONS: Record<NotificationGroup, ComponentType<{ size?: number | string; strokeWidth?: number }>> = {
  todo: AlarmClock,
  project: ClipboardList,
  approval: CircleCheck,
  contract: FileCheck2,
  system: Bell,
};

const TONE_COLOR: Record<NotificationTone, string> = {
  success: "var(--success)",
  danger: "var(--danger)",
  warning: "var(--warning)",
  info: "var(--info, var(--accent))",
  accent: "var(--accent)",
  neutral: "var(--muted-foreground)",
};

function isNewArrival(notification: SupplierNotification): boolean {
  return !notification.isRead && new Date(notification.createdAt).getTime() > serverNowMs() - NEW_WINDOW_MS;
}

export default function NotificationListPage() {
  const router = useRouter();
  const { unreadCount, fetchUnreadCount } = useNotifications();
  const [items, setItems] = useState<SupplierNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [groupFilter, setGroupFilter] = useState<NotificationGroup | "all">("all");
  const [detail, setDetail] = useState<SupplierNotification | null>(null);
  const pageRef = useRef(1);
  const groupRef = useRef<NotificationGroup | "all">("all");

  const fetchData = useCallback(async (page = 1, group = groupRef.current) => {
    pageRef.current = page;
    groupRef.current = group;
    setCurrentPage(page);
    setLoading(true);
    setError(false);
    try {
      const types = notificationTypesForGroup(group);
      const response = await notificationApi.list({
        page,
        pageSize: PAGE_SIZE,
        tab: group === "todo" ? "todo" : "all",
        types: types.length ? types.join(",") : undefined,
      });
      setItems(response.items ?? []);
      setTotal(response.total ?? 0);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData(1, groupFilter);
  }, [fetchData, groupFilter]);

  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === "visible") void fetchData(pageRef.current, groupRef.current);
    };
    const timer = window.setInterval(poll, 30_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [fetchData]);

  const orderedItems = useMemo(() => [
    ...items.filter((item) => !item.isRead),
    ...items.filter((item) => item.isRead),
  ], [items]);

  async function markRead(id: string) {
    try {
      await notificationApi.markAsRead(id);
      setItems((current) => current.map((item) => item.id === id ? { ...item, isRead: true } : item));
      setDetail((current) => current?.id === id ? { ...current, isRead: true } : current);
      await fetchUnreadCount();
    } catch {
      toast.error("标记失败，请重试");
    }
  }

  async function markAllRead() {
    try {
      await notificationApi.markAllAsRead();
      setItems((current) => current.map((item) => ({ ...item, isRead: true })));
      await fetchUnreadCount();
      toast.success("已全部标为已读");
    } catch {
      toast.error("操作失败，请重试");
    }
  }

  function followLink(notification: SupplierNotification) {
    const resolved = resolveNotificationLink(notification.link, window.location.origin);
    if (!resolved) return;
    setDetail(null);
    if (resolved.kind === "internal") router.push(resolved.href);
    else window.open(resolved.href, "_blank", "noopener,noreferrer");
  }

  if (error) {
    return (
      <div className="sp-error-block" role="alert">
        <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} aria-hidden="true" /></div>
        <div className="sp-error-text">数据加载失败</div>
        <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
        <button type="button" className="nd-btn nd-btn--sm nd-btn--soft" onClick={() => void fetchData(currentPage, groupFilter)}>重新加载</button>
      </div>
    );
  }

  const detailLink = detail && typeof window !== "undefined"
    ? resolveNotificationLink(detail.link, window.location.origin)
    : null;

  return (
    <>
      <SpPageHero
        icon={Bell}
        title="消息中心"
        sub="按待办、项目、审批和合同分类查看业务消息。"
        actions={(
          <button type="button" className="nd-btn nd-btn--sm nd-btn--soft" disabled={unreadCount === 0} onClick={() => void markAllRead()}>
            <Check size={14} strokeWidth={2.5} aria-hidden="true" />全部标为已读
          </button>
        )}
      />

      <div className="neu-tab-bar notif-tabs" role="group" aria-label="消息分类">
        {GROUPS.map((group) => (
          <button
            key={group.value}
            type="button"
            className={`neu-tab${groupFilter === group.value ? " active" : ""}`}
            aria-pressed={groupFilter === group.value}
            onClick={() => setGroupFilter(group.value)}
          >
            {group.label}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingBlock />
      ) : orderedItems.length > 0 ? (
        <div className="notif-list" aria-live="polite">
          {orderedItems.map((notification) => {
            const meta = getNotificationMeta(notification.type);
            const Icon = GROUP_ICONS[meta.group] ?? Inbox;
            return (
              <article key={notification.id} className={`notif-row${!notification.isRead ? " unread" : ""}`}>
                <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setDetail(notification)}>
                  <span className="notif-icon" style={{ "--c": TONE_COLOR[meta.tone] } as React.CSSProperties}>
                    <Icon size={17} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <span className="notif-body">
                    <span className="notif-row-title">
                      {isNewArrival(notification) && <span className="notif-new-badge">NEW</span>}
                      {notification.title}
                    </span>
                    <span className="notif-row-content">{summarizeNotification(notification.content)}</span>
                    <span className="mt-1 block text-xs text-[var(--muted-foreground)]">{meta.label}</span>
                  </span>
                </button>
                <div className="notif-right">
                  <time className="notif-row-time" dateTime={notification.createdAt}>{dayjs(notification.createdAt).format("MM-DD HH:mm")}</time>
                  {!notification.isRead && (
                    <button type="button" className="nd-btn nd-btn--xs nd-btn--danger" onClick={() => void markRead(notification.id)}>标为已读</button>
                  )}
                </div>
              </article>
            );
          })}
          <div className="flex justify-center p-4">
            <SpPagination page={currentPage} pageSize={PAGE_SIZE} total={total} onChange={(page) => void fetchData(page, groupFilter)} />
          </div>
        </div>
      ) : groupFilter !== "all" ? (
        <div className="sp-empty-panel">
          <div className="sp-empty-icon"><Search size={22} strokeWidth={1.75} aria-hidden="true" /></div>
          <p className="sp-empty-text">该分类暂无消息</p>
          <p className="sp-empty-desc">切换到“全部”可查看其他业务消息</p>
        </div>
      ) : (
        <div className="sp-empty-panel">
          <div className="sp-empty-icon"><MessageSquare size={22} strokeWidth={1.75} aria-hidden="true" /></div>
          <p className="sp-empty-text">暂无消息</p>
          <p className="sp-empty-desc">新的业务通知会在此集中展示</p>
        </div>
      )}

      <SpDialog
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.title || "通知详情"}
        subtitle={detail ? `${getNotificationMeta(detail.type).label} · ${dayjs(detail.createdAt).format("YYYY-MM-DD HH:mm")}` : undefined}
        width={600}
        footer={(
          <div className="nd-footer">
            {detail && !detail.isRead && (
              <button type="button" className="nd-btn nd-btn--danger" onClick={() => void markRead(detail.id)}>标为已读</button>
            )}
            {detailLink && (
              <button type="button" className="nd-btn nd-btn--soft" onClick={() => followLink(detail!)}>
                {getNotificationMeta(detail!.type).actionLabel || "查看详情"}
                {detailLink.kind === "external" && <ExternalLink size={13} aria-label="外部链接" />}
              </button>
            )}
            <button type="button" className="nd-btn nd-btn--soft" onClick={() => setDetail(null)}>关闭</button>
          </div>
        )}
      >
        {detail && (
          <div className="nd-body">
            <p className="nd-content whitespace-pre-wrap">{summarizeNotification(detail.content, 2000)}</p>
            {detailLink?.kind === "external" && (
              <p className="mt-3 flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                <Megaphone size={13} aria-hidden="true" />此操作将打开外部网站，请确认来源后继续。
              </p>
            )}
          </div>
        )}
      </SpDialog>
    </>
  );
}
