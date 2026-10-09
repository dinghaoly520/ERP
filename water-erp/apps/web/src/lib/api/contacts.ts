import { apiFetch } from './api-fetch';
import { toApiError } from '@water-erp/client';
export type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** 归属公司（2026-10-09 联系人公司隔离）：列表按当前账号公司过滤 */
  companyId?: string | null;
  companyName?: string | null;
  createdAt: string;
  updatedAt: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api';

export async function fetchContacts(): Promise<Contact[]> {
  const response = await apiFetch(`${API_BASE}/contacts`, {
    credentials: 'include',
  });

  if (!response.ok) {
    throw await toApiError(response, '获取联系人列表失败');
  }

  return response.json();
}

export async function createContact(data: {
  name: string;
  email?: string;
  phone?: string;
}): Promise<Contact> {
  const response = await apiFetch(`${API_BASE}/contacts`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw await toApiError(response, '创建联系人失败');
  }

  return response.json();
}

export async function updateContact(
  id: string,
  data: { name?: string; email?: string; phone?: string },
): Promise<Contact> {
  const response = await apiFetch(`${API_BASE}/contacts/${id}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw await toApiError(response, '更新联系人失败');
  }

  return response.json();
}

export async function deleteContact(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE}/contacts/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) {
    throw await toApiError(response, '删除联系人失败');
  }
}

export async function findContactByName(name: string): Promise<Contact | null> {
  const response = await apiFetch(`${API_BASE}/contacts/by-name?name=${encodeURIComponent(name)}`, {
    credentials: 'include',
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}
