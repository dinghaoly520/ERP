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

export interface RegisterTemporaryParams {
  invitationCode: string
  name: string
  creditCode: string
  displayName: string
  password: string
  phone: string
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

  /** 注册前查重（公开）：统一社会信用代码硬拦截 / 法人身份证·联系人身份证软提示。 */
  checkDuplicate(fields: { creditCode?: string; legalPersonIdCard?: string; contactIdCard?: string }) {
    return api.get<{ creditCode: boolean; legalPersonIdCard: boolean; contactIdCard: boolean }>(
      '/supplier/register/check-duplicate', { params: fields })
  },

  /** 公开：校验邀请码（临时注册前）。返回 { valid, validityDays?, expiresAt?, reason? } */
  verifyInvitation(code: string) {
    return api.get('/supplier/invitations/verify', { params: { code } })
  },

  /** 公开：临时供应商注册（凭邀请码）。 */
  registerTemporary(data: RegisterTemporaryParams) {
    return api.post('/supplier/register/temporary', data)
  },

  /** 公开：临时供应商过期续期（凭新邀请码，需用户名+密码验证身份）。 */
  reactivateTemporary(data: { username: string; password: string; invitationCode: string }) {
    return api.post('/supplier-portal/reactivate', data)
  },
}
