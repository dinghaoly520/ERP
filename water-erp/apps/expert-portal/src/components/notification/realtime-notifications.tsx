"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { Bell, CheckCheck, X } from "lucide-react";
import { getNotificationLabel } from "@water-erp/shared";

/**
 * 全局实时通知（2026-09-26，专家门户版）：WS 订阅 `notification:new`，新站内通知在
 * 当前页面右下角即时弹出（10s 未点击自动消失、hover 暂停），点击跳转通知 link。
 * 与 :3004/:3005 同源移植，差异：X-Portal=expert、类型显示中文标签（注册表派生）、
 * 链接按本门户白名单解析——外门户路径（供应商/管理端）不跳转，绝对链接（RSVP）新窗打开。
 */

interface PushNotification {
  id: string;
  type: string;
  title: string;
  content: string;
  link?: string | null;
  createdAt: string;
}

function wsUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") return `${window.location.origin}/api/notifications`;
  return "http://localhost:4001/notifications";
}

/** 本门户可跳转路径前缀（专家门户路由）；绝对链接走外链；其余（供应商/管理端路径）不跳转 */
const EXPERT_LINK_PREFIXES = ["/evaluate", "/tasks", "/projects", "/profile", "/rsvp", "/invitation"];

export function resolveExpertLink(link?: string | null): { href: string; external: boolean } | null {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return { href: link, external: true };
  if (link === "/" || EXPERT_LINK_PREFIXES.some(p => link === p || link.startsWith(`${p}/`) || link.startsWith(`${p}?`))) {
    return { href: link, external: false };
  }
  return null;
}

export function RealtimeNotifications() {
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const [toasts, setToasts] = useState<Array<PushNotification & { bornAt: number }>>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
  }, []);

  const armTimer = useCallback((n: PushNotification) => {
    const old = timersRef.current.get(n.id);
    if (old) clearTimeout(old);
    timersRef.current.set(n.id, setTimeout(() => dismiss(n.id), 10_000));
  }, [dismiss]);

  const open = useCallback((n: PushNotification) => {
    setToasts((prev) => {
      if (prev.some((t) => t.id === n.id)) return prev;
      return [...prev.slice(-4), { ...n, bornAt: Date.now() }];
    });
    armTimer(n);
  }, [armTimer]);

  // hover 暂停自动消失（正在阅读）；移开重新计时 10s
  const pauseTimer = (id: string) => {
    const t = timersRef.current.get(id);
    if (t) { clearTimeout(t); timersRef.current.delete(id); }
  };

  useEffect(() => {
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleReconnect = () => {
      if (attempts >= 5) return;
      attempts += 1;
      const delay = Math.min(30_000, 2_000 * 2 ** (attempts - 1));
      retryTimer = setTimeout(connect, delay);
    };

    const connect = () => {
      const socket = io(wsUrl(), {
        withCredentials: true,
        reconnection: false,
        timeout: 8000,
        transports: ["websocket"],
      });
      socketRef.current = socket;

      socket.on("connect", () => { attempts = 0; });
      socket.on("notification:new", (n: PushNotification) => {
        if (n?.id && n.title) {
          open(n);
          window.dispatchEvent(new CustomEvent("notification:received"));
        }
      });
      socket.on("disconnect", (reason: string) => {
        if (reason === "io client disconnect") return;
        scheduleReconnect();
      });
      socket.on("connect_error", () => { socket.close(); scheduleReconnect(); });
    };

    connect();

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
    };
  }, [open]);

  const handleClick = (n: PushNotification) => {
    dismiss(n.id);
    const target = resolveExpertLink(n.link);
    if (!target) return;
    if (target.external) window.open(target.href, "_blank", "noopener");
    else router.push(target.href);
  };

  const markRead = async (e: React.MouseEvent, n: PushNotification) => {
    e.stopPropagation();
    dismiss(n.id);
    try {
      await fetch(`/api/notifications/${n.id}/read`, { method: "POST", credentials: "include", headers: { "X-Portal": "expert" } });
      window.dispatchEvent(new CustomEvent("notification:received"));
    } catch { /* 已读标记失败不影响 */ }
  };

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[999] flex w-[340px] flex-col gap-2" role="region" aria-label="新通知提醒">
      {toasts.map((n) => (
        <div
          key={n.id}
          className="notif-card pointer-events-auto relative cursor-pointer rounded-[14px] p-3 pr-8"
          onMouseEnter={() => pauseTimer(n.id)}
          onMouseLeave={() => armTimer(n)}
          onClick={() => handleClick(n)}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); dismiss(n.id); }}
            className="absolute right-2 top-2 text-[color:var(--muted-foreground)]/70 transition-colors hover:text-[var(--foreground)]"
            aria-label="关闭"
          >
            <X size={13} strokeWidth={2} />
          </button>
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] bg-[color-mix(in_oklch,var(--accent)_10%,transparent)] text-[var(--accent)]">
              <Bell size={13} strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-bold text-[var(--foreground)]">{n.title}</p>
              <p className="mt-0.5 line-clamp-2 break-words text-[11px] leading-relaxed text-[color:var(--muted-foreground)]">{n.content}</p>
              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-[9px] uppercase tracking-wider text-[color:var(--muted-foreground)]/70">{getNotificationLabel(n.type)}</span>
                <button
                  type="button"
                  onClick={(e) => markRead(e, n)}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--accent)] transition-colors hover:underline"
                >
                  <CheckCheck size={10} strokeWidth={2.2} /> 标为已读
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
      <style>{`
        .notif-card {
          background: linear-gradient(145deg, oklch(1 0 0) 0%, oklch(0.965 0.012 258) 100%);
          box-shadow: 6px 6px 18px oklch(0.45 0.05 258 / 0.18), -3px -3px 10px oklch(1 0 0 / 0.9), inset 0 1px 0 oklch(1 0 0 / 0.9);
          animation: notifIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes notifIn {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .notif-card { animation: none; }
        }
      `}</style>
    </div>
  );
}
