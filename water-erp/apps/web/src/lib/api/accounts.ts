import { api } from "@/lib/api";
import type { AuthRole } from "@/lib/api/auth";

export type AdminAccount = {
  id: string;
  username: string;
  displayName: string;
  role: AuthRole;
  company: string | null;
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
