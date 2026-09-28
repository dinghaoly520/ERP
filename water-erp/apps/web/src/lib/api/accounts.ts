import { api } from "@/lib/api";
import type { AuthRole } from "@/lib/api/auth";

export type AdminAccount = {
  id: string;
  username: string;
  displayName: string;
  role: AuthRole;
  company: string | null;
  /** 公司归属 id（隔离引擎读此字段；null=未归属——巡检警示用，2026-09-17 起建/改号均联动写入） */
  companyId: string | null;
  departmentName: string | null;
  phone: string | null;
  email: string | null;
  officeLocation: string | null;
  isActive: boolean;
  isFrozen: boolean;
  createdAt: string;
};

export type CreateAccountInput = {
  username: string;
  displayName: string;
  password: string;
  role: AuthRole;
  company?: string;
  departmentName?: string;
  phone?: string;
  email?: string;
};

export type UpdateAccountInput = Partial<
  Pick<AdminAccount, "displayName" | "role" | "company" | "departmentName" | "phone" | "email" | "officeLocation">
>;

export function fetchAccounts() {
  return api.get<AdminAccount[]>("/auth/admin/accounts");
}

export function createAccount(payload: CreateAccountInput) {
  return api.post<AdminAccount>("/auth/admin/accounts", payload);
}

export function updateAccount(id: string, patch: UpdateAccountInput) {
  return api.patch<AdminAccount>(`/auth/admin/accounts/${id}`, patch);
}

export function resetAccountPassword(id: string, password: string) {
  return api.post<AdminAccount>(`/auth/admin/accounts/${id}/reset-password`, { password });
}

export function freezeAccount(id: string) {
  return api.post<AdminAccount>(`/auth/admin/accounts/${id}/freeze`);
}

export function unfreezeAccount(id: string) {
  return api.post<AdminAccount>(`/auth/admin/accounts/${id}/unfreeze`);
}

export function deleteAccount(id: string) {
  return api.delete<{ ok: true }>(`/auth/admin/accounts/${id}`);
}

// ── 2026-09-14 供应商账号视图（账号管理按公司分组 + 密码查看）──

export type SupplierAccount = {
  id: string;
  username: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  isFrozen: boolean;
  createdAt: string;
  passwordVault: string | null; // 仅判存在，明文走 revealAccountPassword
  supplier: {
    name: string;
    creditCode: string;
    isTemporary: boolean;
    companyId: string | null;
    companyName: string | null;
  } | null;
  lastLogin: LastLogin;
};

export type CompanyOption = { id: string; name: string };

export interface PendingSummary {
  registrations: number;
  passwordChanges: number;
  passwordResets: number;
  profileChanges: number;
  securityFeedback: number;
  total: number;
}

/** 账号管理待审批汇总（侧栏红标 + tab 红色角标） */
export function fetchPendingSummary() {
  return api.get<PendingSummary>("/auth/admin/accounts/pending-summary");
}

export function fetchSupplierAccounts() {
  return api.get<SupplierAccount[]>("/auth/admin/accounts/suppliers");
}

export function fetchCompanyOptions() {
  return api.get<CompanyOption[]>("/auth/companies/options");
}

export function revealAccountPassword(id: string) {
  return api.get<{ password: string | null; hasVault: boolean }>(
    `/auth/admin/accounts/${id}/password`,
  );
}

export function updateSupplierCompany(id: string, companyId: string) {
  return api.patch(`/auth/admin/accounts/${id}/supplier-company`, { companyId });
}

// ── 2026-09-28 登录 IP 存证（账号管理）──

/** 列表行内「最近登录 IP + 时间」 */
export type LastLogin = { ip: string | null; at: string } | null;

export type LoginIpEntry = {
  ip: string;
  firstAt: string;
  lastAt: string;
  count: number;
  lastUserAgent: string | null;
};

/** 单账号登录过的全部 IP（去重聚合） */
export function fetchLoginIps(id: string) {
  return api.get<{
    account: { id: string; username: string; displayName: string; role: AuthRole; supplier: { name: string } | null };
    ips: LoginIpEntry[];
  }>(`/auth/admin/accounts/login-ips/${id}`);
}

export type SharedIpGroup = {
  ip: string;
  suppliers: { name: string; firstAt: string; lastAt: string }[];
};

/** 跨供应商同 IP 检测（串号预警） */
export function fetchSharedIps() {
  return api.get<{ shared: SharedIpGroup[] }>("/auth/admin/accounts/shared-ips");
}
