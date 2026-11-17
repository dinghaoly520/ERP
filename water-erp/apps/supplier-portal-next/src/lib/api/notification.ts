import { api, qs } from "../api";

export interface SupplierNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  link?: string | null;
  resolvedAt?: string | null;
  createdAt: string;
}

export interface NotificationPage {
  total: number;
  page: number;
  pageSize: number;
  items: SupplierNotification[];
}

export const notificationApi = {
  list(params?: { page?: number; pageSize?: number; tab?: "all" | "todo"; types?: string }) {
    return api.get<NotificationPage>(`/notifications${qs(params)}`);
  },
  getUnreadCount() {
    return api.get<{ count: number }>("/notifications/unread-count", { silent: true });
  },
  markAsRead(id: string) {
    return api.post<any>(`/notifications/${id}/read`, {}, { silent: true });
  },
  /** 办结自己的待办（resolvedAt+isRead 落库）——actionable 未办结时 markAsRead 后端是 no-op，勿混用（对齐 :3005） */
  resolveNotification(id: string) {
    return api.post<any>(`/notifications/${id}/resolve`, {}, { silent: true });
  },
  markAllAsRead() {
    return api.post<any>("/notifications/mark-all-read", {}, { silent: true });
  },
};
