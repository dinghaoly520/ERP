import { api, qs } from "../api";

export interface LoginParams {
  username: string;
  password: string;
}

export interface RegisterParams {
  /** 注册手机验证码（新必填：registrationPhone + registrationCode） */
  registrationPhone: string;
  registrationCode: string;
  username?: string;
  displayName: string;
  password: string;
  email?: string;
  name: string;
  creditCode: string;
  enterpriseType: string;
  legalPerson: string;
  legalPersonIdCard: string;
  registeredAddress: string;
  businessScope: string;
  // ── 注册 2.0 扩展 ──
  logoUrl?: string;
  country?: string;
  region?: string;
  detailedAddress?: string;
  registeredCapital?: string;
  industry?: string;
  legalPersonPhone?: string;
  companyEmail?: string;
  companyWebsite?: string;
  contacts: { name: string; gender?: string; phone: string; email?: string; idCard?: string; position?: string; isPrimary: boolean }[];
  qualifications: { type: string; name: string; fileUrl: string; attachments?: { name: string; url: string }[]; validFrom?: string; validTo?: string }[];
  bankAccounts?: { accountName: string; bankName: string; bankBranch?: string; accountNo: string; isDefault?: boolean }[];
  performances?: { projectName: string; clientName?: string; contractAmount?: string; signDate?: string; description?: string; proofFiles: { name: string; url: string }[] }[];
  tags?: string[];
}

export interface RegisterTemporaryParams {
  invitationCode: string;
  name: string;
  creditCode: string;
  displayName: string;
  password: string;
  phone: string;
}

export const authApi = {
  /** 业务标签库（公开）：已审核入池的可选标签 */
  listBusinessTags() {
    return api.get<{ id: string; name: string }[]>("/supplier/tags", { silent: true });
  },

  /** 发送注册短信验证码（公开，3次/分钟限流） */
  sendRegistrationCode(phone: string) {
    return api.post<any>("/verification/send-registration-code", { phone }, { silent: true });
  },

  /** 登录错误由登录页自行处理（ACCOUNT_PENDING/TEMPORARY_EXPIRED 分支），silent 跳过全局 toast */
  login(data: LoginParams) {
    return api.post<any>("/auth/login", data, { silent: true });
  },

  /** 注册错误由注册页展示行内提示，silent */
  register(data: RegisterParams) {
    return api.post<any>("/supplier/register", data, { silent: true });
  },

  logout() {
    return api.post<void>("/auth/logout", {}, { silent: true });
  },

  getMe() {
    return api.get<any>("/auth/me", { silent: true });
  },

  /** 公开：凭统一社会信用代码查询注册审核进度（无需登录）。 */
  getRegisterStatusPublic(creditCode: string) {
    return api.get<any>(`/supplier/register/status/public${qs({ creditCode })}`, { silent: true });
  },

  /** 注册前查重（公开）：统一社会信用代码硬拦截 / 法人身份证·联系人身份证软提示。 */
  checkDuplicate(fields: { creditCode?: string; legalPersonIdCard?: string; contactIdCard?: string }) {
    return api.get<{ creditCode: boolean; legalPersonIdCard: boolean; contactIdCard: boolean }>(
      `/supplier/register/check-duplicate${qs(fields)}`,
      { silent: true },
    );
  },

  /** 公开：校验邀请码（临时注册前）。返回 { valid, validityDays?, expiresAt?, reason? } */
  verifyInvitation(code: string) {
    return api.get<any>(`/supplier/invitations/verify${qs({ code })}`, { silent: true });
  },

  /** 公开：临时供应商注册（凭邀请码）。 */
  registerTemporary(data: RegisterTemporaryParams) {
    return api.post<any>("/supplier/register/temporary", data, { silent: true });
  },

  /** 公开：临时供应商过期续期（凭新邀请码，需用户名+密码验证身份）。 */
  reactivateTemporary(data: { username: string; password: string; invitationCode: string }) {
    return api.post<any>("/supplier-portal/reactivate", data, { silent: true });
  },
};
