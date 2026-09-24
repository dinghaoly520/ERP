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
