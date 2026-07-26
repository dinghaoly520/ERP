import api from './index'

export const announcementApi = {
  publicList(params?: { type?: string; search?: string; page?: number; pageSize?: number }) {
    return api.get('/announcements/public', { params })
  },
  getPublic(id: string) {
    return api.get(`/announcements/public/${id}`)
  },
  // 招标文件（供应商视角：权限/付费/下载）
  getBidDocument(announcementId: string) {
    return api.get(`/supplier-portal/bid-documents/${announcementId}`)
  },
  payBidDocument(announcementId: string, paymentRef?: string) {
    return api.post(`/supplier-portal/bid-documents/${announcementId}/pay`, { paymentRef })
  },
  // 下载（cookie 鉴权 + 服务端解密），返回 blob
  async downloadBidDocument(announcementId: string, password?: string): Promise<{ blob: Blob; fileName: string }> {
    const res = await api.get(`/supplier-portal/bid-documents/${announcementId}/download`, {
      params: password ? { password } : undefined,
      responseType: 'blob',
    })
    const disposition = res.headers['content-disposition'] || ''
    const m = disposition.match(/filename="?([^"]+)"?/)
    return { blob: res.data, fileName: m ? decodeURIComponent(m[1]) : '招标文件' }
  },
}
