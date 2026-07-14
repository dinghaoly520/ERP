export interface CatalogItem {
  id: string;
  code: string;
  name: string;
  specification: string;
  category: string;
  group: string;
  unit: string;
  referencePrice: number;
  priceMin: number;
  priceMax: number;
  lastDealPrice: number;
  averagePrice: number;
  supplier: string;
  supplierType: string;
  priceSource: string;
  region: string;
  taxIncluded: boolean;
  freightIncluded: boolean;
  changeRate: number;
  minOrder: string;
  remark: string | null;
  status: string;
  validUntil: string | null;
  updatedAt: string;
  createdAt: string;
}

export type CatalogItemInput = Omit<CatalogItem, 'id' | 'updatedAt' | 'createdAt'>;

export interface CatalogStats {
  total: number;
  active: number;
  inactive: number;
  review: number;
  updatedThisMonth: number;
  pendingApplications: number;
}

export interface ImportResult {
  totalRows: number;
  created: number;
  updated: number;
  failed: number;
  failedRows: Array<{ rowNumber: number; code: string; errors: string[] }>;
}

export interface CatalogAuditLog {
  id: string;
  action: string;
  target: string;
  detail: unknown;
  user?: { username: string; displayName: string };
  createdAt: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    headers: init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || data?.message || '请求失败');
  }
  return res.json() as Promise<T>;
}

export function listCatalogItems(params: Record<string, string | undefined> = {}) {
  const sp = new URLSearchParams();
  sp.set('includeInactive', 'true');
  Object.entries(params).forEach(([key, value]) => {
    if (value && value !== '全部') sp.set(key, value);
  });
  return request<CatalogItem[]>(`/api/catalog?${sp.toString()}`);
}

export function getCatalogStats() {
  return request<CatalogStats>('/api/catalog/admin/stats');
}

export function createCatalogItem(input: CatalogItemInput) {
  return request<CatalogItem>('/api/catalog/admin/items', { method: 'POST', body: JSON.stringify(input) });
}

export function changeCatalogStatus(id: string, status: string, reason?: string) {
  return request<CatalogItem>(`/api/catalog/admin/items/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) });
}

export async function downloadImportTemplate() {
  const res = await fetch('/api/catalog/admin/import-template', { credentials: 'include' });
  if (!res.ok) throw new Error('模板下载失败');
  return res.blob();
}

export function importCatalogFile(file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<ImportResult>('/api/catalog/admin/import', { method: 'POST', body: form });
}

export function listCatalogAuditLogs() {
  return request<CatalogAuditLog[]>('/api/catalog/admin/audit-logs');
}

export function getCatalogItem(id: string) {
  return request<CatalogItem>(`/api/catalog/${id}`);
}

// ── 品类树 ──

export interface CategoryNode {
  id: number; name: string; code: string | null; parentId: number | null;
  sortOrder: number; status: string; isLeaf: boolean; icon: string | null;
  children: CategoryNode[];
  attributeTemplates?: AttributeTemplate[];
}

export interface AttributeTemplate {
  id: number; categoryId: number; name: string; fieldKey: string;
  fieldType: string; required: boolean; options: string[] | null;
  unit: string | null; sortOrder: number;
}

export function getCategoryTree() {
  return request<CategoryNode[]>('/api/catalog/categories/tree');
}

export function createCategory(data: { name: string; code?: string; parentId?: number | null; sortOrder?: number; isLeaf?: boolean; icon?: string }) {
  return request<CategoryNode>('/api/catalog/admin/categories', { method: 'POST', body: JSON.stringify(data) });
}

export function updateCategory(id: number, data: { name?: string; code?: string | null; sortOrder?: number; isLeaf?: boolean; icon?: string | null }) {
  return request<CategoryNode>(`/api/catalog/admin/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function deleteCategory(id: number) {
  return request<{ success: boolean }>(`/api/catalog/admin/categories/${id}`, { method: 'DELETE' });
}

export function toggleCategoryStatus(id: number) {
  return request<CategoryNode>(`/api/catalog/admin/categories/${id}/status`, { method: 'PATCH' });
}

export function createAttributeTemplate(categoryId: number, data: { name: string; fieldKey: string; fieldType: string; required?: boolean; options?: string[]; unit?: string; sortOrder?: number }) {
  return request<AttributeTemplate>(`/api/catalog/admin/categories/${categoryId}/attribute-templates`, { method: 'POST', body: JSON.stringify(data) });
}

export function deleteAttributeTemplate(id: number) {
  return request<{ success: boolean }>(`/api/catalog/admin/attribute-templates/${id}`, { method: 'DELETE' });
}
