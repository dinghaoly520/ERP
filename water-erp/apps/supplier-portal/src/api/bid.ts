import api from './index'

export const bidApi = {
  // 投标机会列表（供应商端，仅公开字段）
  listProjects(params?: { page?: number; pageSize?: number; search?: string; scope?: string }) {
    return api.get('/supplier-portal/bid-projects', { params })
  },
  getProject(id: string) {
    return api.get(`/supplier-portal/bid-projects/${id}`)
  },
  // AI 融合概览（采购内容 + 通知 + 两个时间）
  getProjectOverview(id: string) {
    return api.get(`/supplier-portal/bid-projects/${id}/overview`)
  },
  // 招标文件（通过项目 → 公告 relatedProjectCode 关联）
  getProjectBidDocument(projectId: string) {
    return api.get(`/supplier-portal/bid-projects/${projectId}/bid-document`)
  },
  // 谈判采购文件（受邀项目，获取窗口内可下载）
  getNegotiationFiles(projectId: string) {
    return api.get(`/supplier-portal/bid-projects/${projectId}/negotiation-files`)
  },
  // 澄清说明文案（只读，由采购管理端编辑发布）
  getClarificationNotice() {
    return api.get('/system-config/clarification-notice')
  },
  // P2c: 多轮报价
  getMyBidSupplier(projectId: string) {
    return api.get(`/supplier-portal/projects/${projectId}/my-bid-supplier`)
  },
  listRounds(projectId: string) {
    return api.get(`/supplier-portal/projects/${projectId}/rounds`)
  },
  getMyQuotes(projectId: string) {
    return api.get(`/supplier-portal/projects/${projectId}/my-quotes`)
  },
  submitQuote(projectId: string, roundId: string, data: { bidSupplierId: string; quotePrice: number }) {
    return api.post(`/supplier-portal/projects/${projectId}/rounds/${roundId}/quote`, data)
  },
  getRoundQuotes(projectId: string, roundId: string) {
    return api.get(`/supplier-portal/projects/${projectId}/rounds/${roundId}/quotes`)
  },
}
