import api from './index'

export const supplierApi = {
  // Profile
  getProfile() {
    return api.get('/supplier-portal/profile')
  },
  getStatus() {
    return api.get('/supplier-portal/status')
  },
  getDashboardStats() {
    return api.get('/supplier-portal/dashboard-stats')
  },

  // Contacts
  listContacts() {
    return api.get('/supplier-portal/contacts')
  },
  addContact(data: any) {
    return api.post('/supplier-portal/contacts', data)
  },
  updateContact(contactId: string, data: any) {
    return api.put(`/supplier-portal/contacts/${contactId}`, data)
  },
  deleteContact(contactId: string) {
    return api.delete(`/supplier-portal/contacts/${contactId}`)
  },

  // Qualifications
  listQualifications() {
    return api.get('/supplier-portal/qualifications')
  },
  addQualification(data: any) {
    return api.post('/supplier-portal/qualifications', data)
  },
  deleteQualification(qualificationId: string) {
    return api.delete(`/supplier-portal/qualifications/${qualificationId}`)
  },

  // Change requests
  listChangeRecords() {
    return api.get('/supplier-portal/change-records')
  },
  createChangeRequest(data: any) {
    return api.post('/supplier-portal/change-requests', data)
  },

  // Evaluations
  listEvaluations() {
    return api.get('/supplier-portal/evaluations')
  },
  getEvaluationStats() {
    return api.get('/supplier-portal/evaluation-stats')
  },

  // Bid submissions
  listBidSubmissions() {
    return api.get('/supplier-portal/bid-submissions')
  },
  getBidSubmission(projectId: string) {
    return api.get(`/supplier-portal/bid-submissions/${projectId}`)
  },
  saveBidDraft(projectId: string, data: any) {
    return api.post(`/supplier-portal/bid-submissions/${projectId}/draft`, data)
  },
  submitBid(projectId: string, data: any) {
    return api.post(`/supplier-portal/bid-submissions/${projectId}/submit`, data)
  },
  withdrawSubmission(submissionId: string) {
    return api.post(`/supplier-portal/bid-submissions/${submissionId}/withdraw`)
  },

  // 开标确认（供应商侧）
  getOpeningRecord(projectId: string) {
    return api.get(`/supplier-portal/bid-submissions/${projectId}/opening-record`)
  },
  // 唱标记录列表（大厅公开视图：自 OPENING 起向全体投标人公开各家唱标信息）
  getOpeningRecords(projectId: string) {
    return api.get(`/supplier-portal/bid-submissions/${projectId}/opening-records`)
  },
  confirmOpening(projectId: string) {
    return api.post(`/supplier-portal/bid-submissions/${projectId}/opening-confirm`)
  },
  disputeOpening(projectId: string, reason: string) {
    return api.post(`/supplier-portal/bid-submissions/${projectId}/opening-dispute`, { reason })
  },

  // Password
  changePassword(oldPassword: string, newPassword: string) {
    return api.post('/supplier-portal/change-password', { oldPassword, newPassword })
  },

  /** 临时供应商申请转为正式（补全企业+联系人+资质资料，提交审批） */
  convertToRegular(data: {
    enterpriseType: string; legalPerson: string; registeredAddress: string; businessScope: string; creditCode: string;
    contacts: { name: string; phone: string; email?: string; isPrimary?: boolean }[];
    qualifications: { type: string; name: string; fileUrl?: string; validFrom?: string; validTo?: string }[];
  }) {
    return api.post('/supplier-portal/convert-request', data)
  },
}
