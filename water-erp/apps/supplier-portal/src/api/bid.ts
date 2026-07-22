import api from './index'

export const bidApi = {
  // 投标机会列表（供应商端，仅公开字段）
  listProjects(params?: { page?: number; pageSize?: number; search?: string; stage?: string }) {
    return api.get('/supplier-portal/bid-projects', { params })
  },
  getProject(id: string) {
    return api.get(`/supplier-portal/bid-projects/${id}`)
  },
  // 招标文件（通过项目 → 公告 relatedProjectCode 关联）
  getProjectBidDocument(projectId: string) {
    return api.get(`/supplier-portal/bid-projects/${projectId}/bid-document`)
  },
  // 供应商提问（答疑）
  createQuestion(projectId: string, question: string) {
    return api.post(`/supplier-portal/bid-projects/${projectId}/questions`, { question })
  },
}
