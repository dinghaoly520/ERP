import api from './index'

export const notificationApi = {
  list(params?: { page?: number; pageSize?: number }) {
    return api.get('/notifications', { params })
  },
  getUnreadCount() {
    return api.get('/notifications/unread-count')
  },
  markAsRead(id: string) {
    return api.post(`/notifications/${id}/read`)
  },
  markAllAsRead() {
    return api.post('/notifications/mark-all-read')
  },
}
