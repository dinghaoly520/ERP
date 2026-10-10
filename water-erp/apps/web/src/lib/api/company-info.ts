import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/api-fetch';

/**
 * 公司信息管理（2026-10-10）：登录人本公司的开标/监督/采购人维护值。
 * 采购文件编写与公告编写以此预填监督块、采购人联系方式与开标地点。
 */

/** 采购人条目（2026-10-10 多人版）：多条信息、单默认——编写时「联系人」按钮选择 */
export type CompanyPurchaserEntry = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CompanyInfo = {
  id: string;
  name: string;
  shortName: string | null;
  code: string | null;
  bidOpeningAddress: string | null;
  supervisionDept: string | null;
  supervisionAddress: string | null;
  supervisionContact: string | null;
  supervisionPhone: string | null;
  purchaserAddress: string | null;
  /** @deprecated 多人版改用 purchasers（保留为存量兜底，公司信息管理页不再维护） */
  purchaserContact: string | null;
  purchaserPhone: string | null;
  purchaserEmail: string | null;
  /** 多人版采购人条目（默认在前；无人维护时为空数组） */
  purchasers: CompanyPurchaserEntry[];
};

export type CompanyInfoPayload = Partial<Omit<CompanyInfo, 'id' | 'code'>>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(`/api/companies${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Portal': 'web', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `请求失败（${res.status}）`);
  return body as T;
}

/** 本公司信息（按登录人 companyId 解析；未归属公司报错） */
export function fetchMyCompanyInfo(): Promise<CompanyInfo> {
  return request<CompanyInfo>('/my-info');
}

/** 保存本公司信息（仅提交有值字段；空串服务端归一为 null）；成功后作废会话级缓存 */
export async function updateMyCompanyInfo(payload: CompanyInfoPayload): Promise<CompanyInfo> {
  const saved = await request<CompanyInfo>('/my-info', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
  invalidateCompanyInfoCache();
  return saved;
}

/**
 * 公司信息会话级单例（2026-10-10 联动）：采购文件/公告的编写、预览多处取用
 * （预填监督块与采购人联系方式、开标地点兜底），共享一个 Promise 防重复请求。
 * 失败（未归属公司/网络）返回 null，调用方按平台默认值回退，不阻断编写。
 */
let companyInfoPromise: Promise<CompanyInfo | null> | null = null;

export function getCompanyInfoOnce(): Promise<CompanyInfo | null> {
  companyInfoPromise ??= fetchMyCompanyInfo().catch(() => null);
  return companyInfoPromise;
}

/** 保存成功后作废单例——同会话的预填/预览（编写对话框、预览文档）下次取到新值 */
function invalidateCompanyInfoCache() {
  companyInfoPromise = null;
}

/** 组件内取本公司维护信息（null=未取到，渲染层按模板默认值回退） */
export function useCompanyInfo(): CompanyInfo | null {
  const [info, setInfo] = useState<CompanyInfo | null>(null);
  useEffect(() => {
    let alive = true;
    void getCompanyInfoOnce().then((d) => {
      if (alive) setInfo(d);
    });
    return () => {
      alive = false;
    };
  }, []);
  return info;
}

// ── 采购人条目（2026-10-10 多人版）：leader 在公司信息管理维护，编写时选择 ──

export async function createPurchaser(body: {
  name: string;
  phone?: string | null;
  email?: string | null;
  isDefault?: boolean;
}): Promise<CompanyPurchaserEntry> {
  const created = await request<CompanyPurchaserEntry>('/my-info/purchasers', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  invalidateCompanyInfoCache();
  return created;
}

void 0;
export async function updatePurchaser(
  id: string,
  body: { name?: string; phone?: string | null; email?: string | null; isDefault?: boolean },
): Promise<CompanyPurchaserEntry> {
  const updated = await request<CompanyPurchaserEntry>(`/my-info/purchasers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  invalidateCompanyInfoCache();
  return updated;
}

export async function deletePurchaser(id: string): Promise<{ id: string }> {
  const removed = await request<{ id: string }>(`/my-info/purchasers/${id}`, { method: 'DELETE' });
  invalidateCompanyInfoCache();
  return removed;
}

/** 预填取数口径：默认条目优先（服务端排序已保证默认在前），无条目回退旧单值字段，再无则 null（不预填） */
export function pickDefaultPurchaser(
  ci: CompanyInfo | null | undefined,
): { name: string; phone: string; email: string } | null {
  if (!ci) return null;
  const entry = ci.purchasers?.find((p) => p.isDefault) ?? ci.purchasers?.[0];
  if (entry) return { name: entry.name, phone: entry.phone ?? '', email: entry.email ?? '' };
  if (ci.purchaserContact) {
    return { name: ci.purchaserContact, phone: ci.purchaserPhone ?? '', email: ci.purchaserEmail ?? '' };
  }
  return null;
}
