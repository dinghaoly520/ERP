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
    } finally {
      loading.value = false
    }
  }

  async function fetchUnreadCount() {
    try {
      const res = await notificationApi.getUnreadCount() as any
      unreadCount.value = res.count || 0
    } catch {}
  }

  async function markAsRead(id: string) {
    await notificationApi.markAsRead(id)
    const n = notifications.value.find((n: any) => n.id === id)
    if (n) n.isRead = true
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  }

  async function markAllAsRead() {
    await notificationApi.markAllAsRead()
    notifications.value.forEach((n: any) => { n.isRead = true })
    unreadCount.value = 0
  }

  return { notifications, unreadCount, total, loading, fetchNotifications, fetchUnreadCount, markAsRead, markAllAsRead }
})
