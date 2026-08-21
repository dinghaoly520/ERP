"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dayjs from "dayjs";
import { toast } from "sonner";
import {
  AlarmClock, BarChart3, Bell, Check, CircleCheck, CircleX, ClipboardList,
  Inbox, LockOpen, Megaphone, MessageSquare, Search, Send, TriangleAlert,
} from "lucide-react";
import type { ComponentType } from "react";
import { useNotifications } from "@/lib/notification-context";
import { SpPageHero } from "@/components/sp-page-hero";
import { LoadingBlock, SpDialog, SpPagination } from "@/components/ui";
import "@/styles/pages/announcements.css";

const typeIconMap: Record<string, ComponentType<{ size?: number | string; strokeWidth?: number }>> = {
  SUPPLIER_APPROVED: CircleCheck, SUPPLIER_REJECTED: CircleX, SUPPLIER_RETURNED: TriangleAlert,
  BID_PUBLISHED: ClipboardList, BID_INVITED: Send, BID_REMINDER: AlarmClock, SYSTEM: Bell,
  CLARIFICATION_REPLIED: MessageSquare, BID_OPENING: LockOpen, BID_EVALUATION_RESULT: BarChart3,
  ANNOUNCEMENT_PUBLISHED: Megaphone,
};
const typeColorMap: Record<string, string> = {
  SUPPLIER_APPROVED: "#059669", SUPPLIER_REJECTED: "#dc2626", SUPPLIER_RETURNED: "#d97706",
  BID_PUBLISHED: "#2563eb", BID_INVITED: "#db2777", BID_REMINDER: "#ea580c", SYSTEM: "#475569",
  CLARIFICATION_REPLIED: "#0d9488", BID_OPENING: "#0891b2", BID_EVALUATION_RESULT: "#7c3aed",
  ANNOUNCEMENT_PUBLISHED: "#0891b2",
};
const typeLabels: Record<string, string> = {
  SUPPLIER_APPROVED: "入库审批", SUPPLIER_REJECTED: "驳回通知", SUPPLIER_RETURNED: "退回补正",
  BID_PUBLISHED: "采购项目发布", BID_INVITED: "采购项目邀请", BID_REMINDER: "开标提醒", SYSTEM: "系统通知",
  CLARIFICATION_REPLIED: "澄清答疑", BID_OPENING: "开标通知", BID_EVALUATION_RESULT: "评标结果",
  ANNOUNCEMENT_PUBLISHED: "公告发布",
};

// NEW 标记：未读且 48h 内到达（兜底首次访问也能看到新消息）
const NEW_WINDOW_MS = 48 * 3600 * 1000;
function isNewArrival(n: any): boolean {
  return !n.isRead && new Date(n.createdAt).getTime() > Date.now() - NEW_WINDOW_MS;
}

function linkify(text: string): string {
  if (!text) return "";
  const escaped = text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const lines = escaped.split("\n");
  const sigLen = Math.min(2, lines.length);
  const bodyLines = lines.slice(0, -sigLen);
  const sigLines = lines.slice(-sigLen);
  let html = bodyLines.join("<br>");
  html = html.replace(
    /(https?:\/\/[^\s<>"'{}|]+)/g,
    '<a href="$1" target="_blank" rel="noopener" class="notif-link">$1</a>',
  );
  if (sigLines.length > 0) {
    html += '<div class="nd-signature">' + sigLines.join("<br>") + "</div>";
  }
  return html;
}

export default function NotificationListPage() {
  const router = useRouter();
  const { notifications, unreadCount, total, fetchNotifications, fetchUnreadCount, markAsRead, markAllAsRead } = useNotifications();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState("");
  const [detailNotif, setDetailNotif] = useState<any>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  const pageRef = useRef(1);

  const fetchData = async (page = 1) => {
    pageRef.current = page;
    setCurrentPage(page);
    setLoading(true);
    setError(false);
    try {
      await fetchNotifications(page, 15);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 每 30s 轮询新通知，有新消息自动刷新列表
  useEffect(() => {
    const timer = setInterval(() => {
      fetchNotifications(pageRef.current, 15).catch(() => {});
    }, 30_000);
    return () => clearInterval(timer);
  }, [fetchNotifications]);

  // 未读置顶，其余按时间倒序（新通知永远排在最前面）
  const filteredNotifications = useMemo(() => {
    const list = typeFilter ? notifications.filter((n: any) => n.type === typeFilter) : notifications;
    const unread = list.filter((n: any) => !n.isRead);
    const read = list.filter((n: any) => n.isRead);
    return [...unread, ...read];
  }, [notifications, typeFilter]);

  async function handleRead(id: string) {
    try {
      await markAsRead(id);
    } catch {
      toast.error("标记失败，请重试");
    }
  }
  async function handleReadAll() {
    try {
      await markAllAsRead();
      await fetchUnreadCount();
      toast.success("已全部标为已读");
    } catch {
      toast.error("操作失败，请重试");
    }
  }

  function handleClick(n: any) {
    setDetailNotif({ ...n });
    setDetailVisible(true);
  }
  function goLink(link?: string) {
    if (link) {
      setDetailVisible(false);
      // 通知 link 可能是完整 URL（如 http://localhost:3004/rsvp?t=xxx），只取路径部分
      const url = new URL(link, window.location.origin);
      router.push(url.pathname + url.search + url.hash);
    }
  }

  if (error) {
    return (
      <div className="sp-error-block">
        <div className="sp-error-icon"><TriangleAlert size={22} strokeWidth={1.75} /></div>
        <div className="sp-error-text">数据加载失败</div>
        <div className="sp-error-desc">网络或服务异常，请稍后重试</div>
        <button type="button" className="nd-btn nd-btn--sm nd-btn--soft" style={{ margin: "0 auto" }} onClick={() => fetchData()}>
          重新加载
        </button>
      </div>
    );
  }

  return (
    <>
      <SpPageHero icon={Bell} title="消息中心" sub="查看系统通知和业务消息，及时处理重要提醒。"
        actions={
          <button
            type="button"
            className="nd-btn nd-btn--sm nd-btn--soft"
            disabled={unreadCount === 0}
            onClick={handleReadAll}
          >
            <Check size={14} strokeWidth={2.5} style={{ marginRight: 5 }} />
            全部标为已读
          </button>
        }
      />

      {loading ? (
        <LoadingBlock />
      ) : (
        <>
          {/* Type filter tabs */}
          {notifications.length > 0 && (
            <div className="neu-tab-bar notif-tabs">
              <button type="button" className={`neu-tab${!typeFilter ? " active" : ""}`} onClick={() => setTypeFilter("")}>全部</button>
              {Object.entries(typeLabels).map(([key, label]) => (
                <button key={key} type="button" className={`neu-tab${typeFilter === key ? " active" : ""}`} onClick={() => setTypeFilter(key)}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {filteredNotifications.length > 0 ? (
            <div className="notif-list">
              {filteredNotifications.map((n: any) => {
                const Icon = typeIconMap[n.type] || Inbox;
                return (
                  <div key={n.id} className={`notif-row${!n.isRead ? " unread" : ""}`} onClick={() => handleClick(n)}>
                    <div className="notif-icon" style={{ "--c": typeColorMap[n.type] || "#475569" } as React.CSSProperties}>
                      <Icon size={17} strokeWidth={1.75} />
                    </div>
                    <div className="notif-body">
                      <div className="notif-row-title">
                        {isNewArrival(n) && <span className="notif-new-badge">NEW</span>}
                        {n.title}
                      </div>
                      <div className="notif-row-content">{n.content}</div>
                    </div>
                    <div className="notif-right">
                      <div className="notif-row-time">{dayjs(n.createdAt).format("MM-DD HH:mm")}</div>
                      {!n.isRead && (
                        <button
                          type="button"
                          className="nd-btn nd-btn--xs nd-btn--danger"
                          onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleRead(n.id); }}
                        >
                          标为已读
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              <div style={{ display: "flex", justifyContent: "center", padding: 16 }}>
                <SpPagination page={currentPage} pageSize={15} total={total} onChange={(p) => fetchData(p)} />
              </div>
            </div>
          ) : notifications.length > 0 ? (
            <div className="sp-empty-panel">
              <div className="sp-empty-icon"><Search size={22} strokeWidth={1.75} /></div>
              <p className="sp-empty-text">无匹配通知</p>
              <p className="sp-empty-desc">该分类暂无通知，试试其他筛选</p>
            </div>
          ) : (
            <div className="sp-empty-panel">
              <div className="sp-empty-icon"><MessageSquare size={22} strokeWidth={1.75} /></div>
              <p className="sp-empty-text">暂无消息</p>
              <p className="sp-empty-desc">您没有未读消息</p>
            </div>
          )}
        </>
      )}

      {/* 通知详情弹窗 */}
      <SpDialog
        open={detailVisible}
        onClose={() => { setDetailVisible(false); setDetailNotif(null); }}
        title={detailNotif?.title || "通知详情"}
        width={600}
        footer={
          <div className="nd-footer">
            {detailNotif && !detailNotif.isRead && (
              <button
                type="button"
                className="nd-btn nd-btn--danger"
                onClick={() => {
                  markAsRead(detailNotif.id).catch(() => {});
                  setDetailNotif({ ...detailNotif, isRead: true });
                }}
              >
                标为已读
              </button>
            )}
            {detailNotif?.link && (
              <button type="button" className="nd-btn nd-btn--soft" onClick={() => goLink(detailNotif.link)}>查看详情</button>
            )}
            <button type="button" className="nd-btn nd-btn--soft" onClick={() => setDetailVisible(false)}>关闭</button>
          </div>
        }
      >
        {detailNotif && (
          <div className="nd-body">
            <span className="nd-time">{dayjs(detailNotif.createdAt).format("YYYY-MM-DD HH:mm")}</span>
            <div className="nd-content" dangerouslySetInnerHTML={{ __html: linkify(detailNotif.content) }} />
          </div>
        )}
      </SpDialog>
    </>
  );
}
