import api from './index'

export const bidApi = {
  // 招标机会列表（供应商端，仅公开字段）
  listProjects(params?: { page?: number; pageSize?: number }) {
    return api.get('/supplier-portal/bid-projects', { params })
  },
  getProject(id: string) {
    return api.get(`/supplier-portal/bid-projects/${id}`)
  },
}
