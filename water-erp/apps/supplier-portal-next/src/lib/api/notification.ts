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
  markAllAsRead() {
    return api.post<any>("/notifications/mark-all-read", {}, { silent: true });
  },
};
