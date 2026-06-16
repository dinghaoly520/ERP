import { defineStore } from 'pinia'
import { ref } from 'vue'
import { notificationApi } from '@/api/notification'

export const useNotificationStore = defineStore('notification', () => {
  const notifications = ref<any[]>([])
  const unreadCount = ref(0)
  const total = ref(0)
  const loading = ref(false)

  async function fetchNotifications(page = 1, pageSize = 20) {
    loading.value = true
    try {
      const res = await notificationApi.list({ page, pageSize }) as any
      notifications.value = res.items || []
      total.value = res.total || 0
    } finally { loading.value = false }
  }

  async function fetchUnreadCount() {
    try {
      const res = await notificationApi.getUnreadCount() as any
      unreadCount.value = res.count || 0
    } catch {}
  }

  async function markAsRead(id: string) {
    const n = notifications.value.find((x: any) => x.id === id)
    const wasUnread = !!n && !n.isRead
    if (n) n.isRead = true
    if (wasUnread) unreadCount.value = Math.max(0, unreadCount.value - 1)
    try { await notificationApi.markAsRead(id) } catch {
      if (n) n.isRead = false
      if (wasUnread) unreadCount.value += 1
      throw new Error('failed')
    }
  }

  async function markAllAsRead() {
    const changed = notifications.value.filter((n: any) => !n.isRead)
    const prevUnread = unreadCount.value
    notifications.value.forEach((n: any) => { n.isRead = true })
    unreadCount.value = 0
    try { await notificationApi.markAllAsRead() } catch {
      changed.forEach((n: any) => { n.isRead = false })
      unreadCount.value = prevUnread
      throw new Error('failed')
    }
  }

  return { notifications, unreadCount, total, loading, fetchNotifications, fetchUnreadCount, markAsRead, markAllAsRead }
})
