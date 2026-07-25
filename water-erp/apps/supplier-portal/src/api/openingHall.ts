import api from './index'

export const openingHallApi = {
  checkIn(projectId: string) {
    return api.post(`/opening-hall/${projectId}/check-in`)
  },
  presence(projectId: string) {
    return api.get(`/opening-hall/${projectId}/presence`)
  },
  send(projectId: string, body: { roomType: 'PUBLIC' | 'PRIVATE'; supplierId?: string; content: string }) {
    return api.post(`/opening-hall/${projectId}/messages`, body)
  },
  messages(projectId: string, params: { roomType: 'PUBLIC' | 'PRIVATE'; supplierId?: string; cursor?: string; limit?: number }) {
    return api.get(`/opening-hall/${projectId}/messages`, { params })
  },
  unread(projectId: string) {
    return api.get(`/opening-hall/${projectId}/unread`)
  },
  markRead(projectId: string, roomKey: string, lastMessageId?: string) {
    return api.post(`/opening-hall/${projectId}/read`, { roomKey, ...(lastMessageId ? { lastMessageId } : {}) })
  },
}
