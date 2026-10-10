import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/api-fetch';

/**
 * 公司信息管理（2026-10-10）：登录人本公司的开标/监督/采购人维护值。
 * 采购文件编写与公告编写以此预填监督块、采购人联系方式与开标地点。
 */

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
  purchaserContact: string | null;
  purchaserPhone: string | null;
  purchaserEmail: string | null;
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

/** 保存本公司信息（仅提交有值字段；空串服务端归一为 null） */
export function updateMyCompanyInfo(payload: CompanyInfoPayload): Promise<CompanyInfo> {
  return request<CompanyInfo>('/my-info', { method: 'PATCH', body: JSON.stringify(payload) });
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
