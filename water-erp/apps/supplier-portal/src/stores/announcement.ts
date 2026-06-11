import { defineStore } from 'pinia'
import { ref } from 'vue'
import { announcementApi } from '@/api/announcement'

export const useAnnouncementStore = defineStore('announcement', () => {
  const announcements = ref<any[]>([])
  const currentAnnouncement = ref<any>(null)
  const total = ref(0)
  const loading = ref(false)

  async function fetchAnnouncements(params?: { type?: string; search?: string; page?: number; pageSize?: number }) {
    loading.value = true
    try {
      const res = await announcementApi.publicList(params) as any
      announcements.value = res.items || []
      total.value = res.total || 0
    } finally {
      loading.value = false
    }
  }

  async function fetchAnnouncement(id: string) {
    loading.value = true
    try {
      currentAnnouncement.value = await announcementApi.getPublic(id)
    } finally {
      loading.value = false
    }
  }

  return { announcements, currentAnnouncement, total, loading, fetchAnnouncements, fetchAnnouncement }
})
