import { api, qs } from "../api";

export const notificationApi = {
  list(params?: { page?: number; pageSize?: number }) {
    return api.get<any>(`/notifications${qs(params)}`);
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
