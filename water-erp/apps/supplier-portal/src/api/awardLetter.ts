import api from './index'

export const awardLetterApi = {
  list() {
    return api.get('/supplier-portal/award-letters')
  },
  sign(id: string) {
    return api.post(`/supplier-portal/award-letters/${id}/sign`, {})
  },
  markReceived(id: string) {
    return api.post(`/supplier-portal/award-letters/${id}/received`, {})
  },
}
