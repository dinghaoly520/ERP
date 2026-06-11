import api from './index'

export const announcementApi = {
  publicList(params?: { type?: string; search?: string; page?: number; pageSize?: number }) {
    return api.get('/announcements/public', { params })
  },
  getPublic(id: string) {
    return api.get(`/announcements/public/${id}`)
  },
}
