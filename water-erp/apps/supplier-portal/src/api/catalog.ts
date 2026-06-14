import api from './index'

/** 集中采购目录（脱敏浏览）+ 供货申请 */
export const catalogApi = {
  // 脱敏浏览（仅品类，无价格）
  listCategories() {
    return api.get('/supplier-portal/catalog/categories')
  },
  listItems(params: { category?: string; group?: string; search?: string } = {}) {
    return api.get('/supplier-portal/catalog/items', { params })
  },
  getItem(id: string) {
    return api.get(`/supplier-portal/catalog/items/${id}`)
  },
  getSupplyStatus(itemId: string) {
    return api.get(`/supplier-portal/catalog/items/${itemId}/supply-status`)
  },

  // 我的申请
  listApplications() {
    return api.get('/supplier-portal/catalog-applications')
  },
  createApplication(data: any) {
    return api.post('/supplier-portal/catalog-applications', data)
  },
  updateApplication(id: string, data: any) {
    return api.patch(`/supplier-portal/catalog-applications/${id}`, data)
  },
  acceptCounter(id: string) {
    return api.post(`/supplier-portal/catalog-applications/${id}/accept-counter`)
  },
  withdraw(id: string) {
    return api.post(`/supplier-portal/catalog-applications/${id}/withdraw`)
  },

  // 我的已准入供货关系
  listSupply() {
    return api.get('/supplier-portal/catalog-supply')
  },
}
