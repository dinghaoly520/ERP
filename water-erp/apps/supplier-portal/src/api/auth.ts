import api from './index'

export interface LoginParams {
  username: string
  password: string
}

export interface RegisterParams {
  username: string
  displayName: string
  password: string
  email?: string
  name: string
  creditCode: string
  enterpriseType: string
  legalPerson: string
  registeredAddress: string
  businessScope: string
  contacts: { name: string; phone: string; email?: string; isPrimary: boolean }[]
  qualifications: { type: string; name: string; fileUrl: string; validFrom?: string; validTo?: string }[]
}

export const authApi = {
  login(data: LoginParams) {
    return api.post('/auth/login', data)
  },

  register(data: RegisterParams) {
    return api.post('/supplier/register', data)
  },

  logout() {
    return api.post('/auth/logout')
  },

  getMe() {
    return api.get('/auth/me')
  },

  /** 公开：凭统一社会信用代码查询注册审核进度（无需登录）。 */
  getRegisterStatusPublic(creditCode: string) {
    return api.get('/supplier/register/status/public', { params: { creditCode } })
  },
}
