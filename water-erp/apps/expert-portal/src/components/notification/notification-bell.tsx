"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as LucideIcons from "lucide-react";
import { Bell, CheckCheck } from "lucide-react";
import { getNotificationMeta, getNotificationLabel } from "@water-erp/shared";
import { resolveExpertLink } from "./realtime-notifications";

/**
 * 通知铃铛（2026-09-26，专家门户）：侧栏品牌区下方入口，30s 轮询未读数 +
 * `notification:received` 事件即时刷新（实时弹窗触发）。下拉最近 10 条，
 * 点击标已读并按本门户白名单跳转（外门户路径只标读不跳）。
 * 类型图标/中文标签从 shared 注册表派生（单一事实源）。
 */

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  content: string;
  link?: string | null;
  isRead: boolean;
  createdAt: string;
}

export default function NotificationBell() {
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const loadUnread = useCallback(() => {
    fetch("/api/notifications/unread-count", { credentials: "include", headers: { "X-Portal": "expert" } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && typeof d.count === "number") setUnread(d.count); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadUnread();
    const timer = setInterval(loadUnread, 30_000);
    const onReceived = () => loadUnread();
    window.addEventListener("notification:received", onReceived);
    return () => { clearInterval(timer); window.removeEventListener("notification:received", onReceived); };
  }, [loadUnread]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/notifications?page=1&pageSize=10", { credentials: "include", headers: { "X-Portal": "expert" } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.items) setItems(d.items); })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const markRead = async (n: NotificationRow) => {
    setItems(prev => prev.map(x => (x.id === n.id ? { ...x, isRead: true } : x)));
    setUnread(prev => Math.max(0, prev - 1));
    try {
      await fetch(`/api/notifications/${n.id}/read`, { method: "POST", credentials: "include", headers: { "X-Portal": "expert" } });
    } catch { /* 失败不阻断 */ }
  };

  const markAll = async () => {
    setItems(prev => prev.map(x => ({ ...x, isRead: true })));
    setUnread(0);
    try {
      await fetch("/api/notifications/mark-all-read", { method: "POST", credentials: "include", headers: { "X-Portal": "expert" } });
    } catch { /* 失败不阻断 */ }
  };

  const handleItemClick = (n: NotificationRow) => {
    if (!n.isRead) void markRead(n);
    const target = resolveExpertLink(n.link);
    if (!target) return;
    setOpen(false);
    if (target.external) window.open(target.href, "_blank", "noopener");
    else router.push(target.href);
  };

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-center gap-1.5 rounded-[12px] px-2 py-1.5 text-[11px] font-medium text-[color:var(--muted-foreground)] transition-colors hover:bg-[oklch(1_0_0/0.5)] hover:text-[var(--foreground)]"
        aria-label={`通知（${unread} 未读）`}
      >
        <span className="relative">
          <Bell size={13} strokeWidth={1.8} />
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1 flex h-[13px] min-w-[13px] items-center justify-center rounded-full bg-[#e05252] px-[3px] font-mono text-[8px] font-bold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </span>
        通知
      </button>

      {open && (
        <div
          className="exp-notice-pop absolute left-full top-0 z-[300] ml-2 w-[320px] overflow-hidden rounded-[14px]"
        >
          <div className="flex items-center justify-between border-b border-[oklch(0.6_0.04_258_/_0.14)] px-4 py-2.5">
            <span className="text-[12px] font-semibold text-[var(--foreground)]">
              通知 <span className="font-normal text-[color:var(--muted-foreground)]">({unread} 未读)</span>
            </span>
            {unread > 0 && (
              <button onClick={markAll} className="flex items-center gap-1 text-[11px] font-medium text-[var(--accent)] transition-opacity hover:opacity-75">
                <CheckCheck size={12} strokeWidth={1.8} /> 全部已读
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-7 text-center text-[12px] text-[color:var(--muted-foreground)]">暂无通知</div>
            ) : (
              items.map(n => {
                const meta = getNotificationMeta(n.type);
                const Icon = (LucideIcons as any)[meta.icon] ?? LucideIcons.Bell;
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleItemClick(n)}
                    className={`flex w-full items-start gap-2.5 border-b border-[oklch(0.94_0.004_264)] px-3.5 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[oklch(0.985_0.006_258)] ${!n.isRead ? "bg-[oklch(0.972_0.012_258)]" : ""}`}
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] text-[var(--accent)]">
                      <Icon size={12} strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-[var(--foreground)]">{n.title}</span>
                      <span className="mt-0.5 line-clamp-2 block break-words text-[11px] leading-relaxed text-[color:var(--muted-foreground)]">{n.content}</span>
                      <span className="mt-1 flex items-center justify-between">
                        <span className="text-[9px] uppercase tracking-wider text-[color:var(--muted-foreground)]/70">{getNotificationLabel(n.type)}</span>
                        <span className="font-mono text-[9px] text-[color:var(--muted-foreground)]/70">{new Date(n.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
