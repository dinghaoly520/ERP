export interface CatalogItem {
  id: string;
  code: string;
  name: string;
  specification: string;
  category: string;
  categoryPath?: string;
  /** 品类树节点 id（后端按品类维度返回；录入/筛选时使用） */
  categoryId?: number | null;
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
  resourceType: string;
  details: unknown;
  user?: { username: string; displayName: string };
  createdAt: string;
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const initHeaders = (init?.headers as Record<string, string>) || {};
  const headers: Record<string, string> = { 'X-Portal': 'web', ...initHeaders };
  if (init?.body && !(init.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { credentials: 'include', headers, body: init?.body, method: init?.method, signal: init?.signal });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || data?.message || '请求失败');
  }
  return res.json() as Promise<T>;
}

export function listCatalogItems(params: Record<string, string | number | undefined> = {}) {
  const sp = new URLSearchParams();
  sp.set('includeInactive', 'true');
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '全部') sp.set(key, String(value));
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

export function updateCatalogItem(id: string, input: Partial<CatalogItemInput>) {
  return request<CatalogItem>(`/api/catalog/admin/items/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** 导出采购目录 Excel（返回 Blob，由调用方触发下载） */
export async function exportCatalog(params: Record<string, string | undefined> = {}) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v) sp.set(k, v); });
  const res = await fetch(`/api/catalog/export${sp.toString() ? '?' + sp.toString() : ''}`, { credentials: 'include', headers: { 'X-Portal': 'web' } });
  if (!res.ok) throw new Error('目录导出失败');
  return res.blob();
}

export async function downloadImportTemplate() {
  // 与 exportCatalog 一致：裸 fetch 必须带 X-Portal 头，否则后端按缺省门户解析会话
  const res = await fetch('/api/catalog/admin/import-template', { credentials: 'include', headers: { 'X-Portal': 'web' } });
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

export interface PricePoint { recordedAt: string; price: number; note: string | null; }
export function getPriceHistory(itemId: string) {
  return request<PricePoint[]>(`/api/catalog/${itemId}/history`);
}

// ── 品类树 ──

export interface CategoryNode {
  id: number; name: string; code: string | null; parentId: number | null;
  sortOrder: number; status: string; isLeaf: boolean; icon: string | null;
  centralizedLevel?: string | null; centralizedThreshold?: number | null;
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

export function createCategory(data: { name: string; code?: string; parentId?: number | null; sortOrder?: number; isLeaf?: boolean; icon?: string; centralizedLevel?: string; centralizedThreshold?: number | null }) {
  return request<CategoryNode>('/api/catalog/admin/categories', { method: 'POST', body: JSON.stringify(data) });
}

export function updateCategory(id: number, data: { name?: string; code?: string | null; sortOrder?: number; isLeaf?: boolean; icon?: string | null; centralizedLevel?: string | null; centralizedThreshold?: number | null }) {
  return request<CategoryNode>(`/api/catalog/admin/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
}

/** B2（4.1.3.2）：需求归集视图 */
export interface DemandAggRow {
  category: string;
  count: number;
  totalBudget: number;
  centralizedLevel: string | null;
  centralizedThreshold: number | null;
  suggestCentralized: boolean;
  recent: Array<{ projectCode: string | null; title: string; budget: number | null; department: string | null }>;
}

export function getDemandAggregation() {
  return request<DemandAggRow[]>('/api/catalog/admin/demand-aggregation');
}

export function deleteCategory(id: number) {
  return request<{ success: boolean }>(`/api/catalog/admin/categories/${id}`, { method: 'DELETE' });
}

export function toggleCategoryStatus(id: number) {
  return request<CategoryNode>(`/api/catalog/admin/categories/${id}/status`, { method: 'PATCH' });
}

/** 移动品类节点（更换父节点 / 排序）；后端已防成环 */
export function moveCategory(id: number, data: { newSortOrder: number; newParentId?: number | null }) {
  return request<CategoryNode>(`/api/catalog/admin/categories/${id}/sort`, { method: 'PATCH', body: JSON.stringify(data) });
}

export function createAttributeTemplate(categoryId: number, data: { name: string; fieldKey: string; fieldType: string; required?: boolean; options?: string[]; unit?: string; sortOrder?: number }) {
  return request<AttributeTemplate>(`/api/catalog/admin/categories/${categoryId}/attribute-templates`, { method: 'POST', body: JSON.stringify(data) });
}

export function deleteAttributeTemplate(id: number) {
  return request<{ success: boolean }>(`/api/catalog/admin/attribute-templates/${id}`, { method: 'DELETE' });
}

export function setItemAttributes(itemId: string, attributes: { templateId: number; value: string }[]) {
  return request<CatalogItem>(`/api/catalog/admin/items/${itemId}/attributes`, { method: 'PATCH', body: JSON.stringify({ attributes }) });
}

// ── 价格预警 ──

export interface AlertRule { id: number; name: string; alertType: string; threshold: number; enabled: boolean; category?: { id: number; name: string } | null; notifyRoles?: string[] | null; }
export interface AlertRecord { id: number; message: string; alertType: string; triggerValue: number; isRead: boolean; isResolved: boolean; createdAt: string; catalogItem?: { code: string; name: string } | null; rule?: { name: string } | null; }

export function listAlertRules() { return request<AlertRule[]>('/api/catalog/admin/alert-rules'); }
export function createAlertRule(data: any) { return request<AlertRule>('/api/catalog/admin/alert-rules', { method: 'POST', body: JSON.stringify(data) }); }
export function updateAlertRule(id: number, data: any) { return request<AlertRule>(`/api/catalog/admin/alert-rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) }); }
export function deleteAlertRule(id: number) { return request<{ success: boolean }>(`/api/catalog/admin/alert-rules/${id}`, { method: 'DELETE' }); }
export function toggleAlertRule(id: number) { return request<AlertRule>(`/api/catalog/admin/alert-rules/${id}/toggle`, { method: 'PATCH' }); }
export function listAlerts(params?: Record<string, string>) { const sp = new URLSearchParams(params); return request<AlertRecord[]>(`/api/catalog/admin/alerts?${sp.toString()}`); }
export function markAlertRead(id: number) { return request<AlertRecord>(`/api/catalog/admin/alerts/${id}/read`, { method: 'PATCH' }); }
export function markAlertResolved(id: number) { return request<AlertRecord>(`/api/catalog/admin/alerts/${id}/resolve`, { method: 'PATCH' }); }

// ── 目录版本 ──

export interface CatalogVersionData { id: number; name: string; version: string; effectiveAt: string; status: string; description?: string | null; createdAt: string; user?: { username: string; displayName: string } }
export interface VersionDiff { versionA: string; versionB: string; added: any[]; removed: any[]; priceChanges: any[] }

export function listVersions() { return request<CatalogVersionData[]>('/api/catalog/admin/versions'); }
export function createVersion(data: { name: string; version: string; effectiveAt: string; description?: string }) { return request<CatalogVersionData>('/api/catalog/admin/versions', { method: 'POST', body: JSON.stringify(data) }); }
export function changeVersionStatus(id: number, status: string) { return request<CatalogVersionData>(`/api/catalog/admin/versions/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); }
export function compareVersions(a: number, b: number) { return request<VersionDiff>(`/api/catalog/admin/versions/compare?a=${a}&b=${b}`); }

// ── 供应商维度 ──

export interface SupplierCoverage { supplier: string; categoryCount: number; categories: string[] }
export interface SupplierPriceItem { supplier: string; items: { code: string; name: string; price: number }[]; avgPrice: number }

export function getSupplierCoverage() { return request<SupplierCoverage[]>('/api/catalog/admin/supplier-coverage'); }
export function getSupplierPriceComparison(categoryId?: number) { return request<SupplierPriceItem[]>(`/api/catalog/admin/supplier-price-comparison${categoryId ? `?categoryId=${categoryId}` : ''}`); }

// ── 仪表盘 / 搜索 / 订阅 ──

export interface CatalogDashboardStats {
  total: number; active: number; priceSurge: number; expiring: number;
  healthScore: number; categoryGapCount: number; categoryCount: number;
  [key: string]: number;
}
export function getDashboardStats() {
  return request<CatalogDashboardStats>('/api/catalog/admin/dashboard-stats');
}
export function logSearch(keyword: string) {
  return request<{ success: boolean }>('/api/catalog/admin/search-log', { method: 'POST', body: JSON.stringify({ keyword }) });
}
export function toggleSubscribe(itemId: string) {
  return request<{ subscribed: boolean }>(`/api/catalog/${itemId}/subscribe`, { method: 'POST' });
}
export interface PricePrediction { opportunity: string | null; predictions: { price: number }[] }
export async function getPricePrediction(itemId: string): Promise<PricePrediction | null> {
  // 预测为可选能力：失败/无数据时静默返回 null（ TrendsTab 容错 ）
  return request<PricePrediction>(`/api/catalog/${itemId}/prediction`).catch(() => null);
}

// ── 价格申请（审批）──

export type ApplicationType = 'NEW_ITEM' | 'JOIN_EXISTING' | 'PRICE_ADJUST' | 'UPDATE_QUOTE';
export type ApplicationStatus = 'PENDING' | 'COUNTERED' | 'APPROVED' | 'REJECTED' | 'RETURNED' | 'WITHDRAWN';
export interface CatalogApplication {
  id: string; type: ApplicationType; status: ApplicationStatus;
  quotedPrice: number | string | null; counterPrice: number | string | null;
  deliveryPeriod?: string | null; region?: string | null; proposedName?: string | null;
  supplier?: { id?: string; name: string; userId?: string; status?: string } | null;
  catalogItem?: { id?: string; code?: string; name: string; specification?: string; category?: string; group?: string; unit?: string } | null;
  // ── 独立审批页（price-alerts）扩展字段 ──
  supplierId?: string; catalogItemId?: string | null;
  proposedSpec?: string | null; proposedCategory?: string | null;
  proposedGroup?: string | null; proposedUnit?: string | null;
  minOrder?: string | null; taxIncluded?: boolean; freightIncluded?: boolean;
  counterNote?: string | null; qualificationNote?: string | null;
  reviewedBy?: string | null; reviewedAt?: string | null;
  rejectReason?: string | null; reviewerNote?: string | null;
  approvedReferencePrice?: number | null;
  approvedPriceMin?: number | null; approvedPriceMax?: number | null;
  approvedValidUntil?: string | null;
  createdAt?: string; updatedAt?: string;
}
export function listApplications(statusOrParams?: string | { status?: string; type?: string }) {
  const sp = new URLSearchParams();
  if (typeof statusOrParams === 'string') {
    if (statusOrParams && statusOrParams !== '全部') sp.set('status', statusOrParams);
  } else if (statusOrParams) {
    if (statusOrParams.status && statusOrParams.status !== '全部') sp.set('status', statusOrParams.status);
    if (statusOrParams.type && statusOrParams.type !== '全部') sp.set('type', statusOrParams.type);
  }
  return request<CatalogApplication[]>(`/api/catalog/applications${sp.toString() ? '?' + sp.toString() : ''}`);
}
export function reviewCatalogApplication(id: string, body: {
  action: 'approve' | 'reject' | 'return' | 'counter';
  reason?: string; counterPrice?: number; counterNote?: string;
  referencePrice?: number; priceMin?: number; priceMax?: number;
  validUntil?: string; code?: string; categoryId?: number;
}) {
  return request<CatalogApplication>(`/api/catalog/applications/${id}/review`, { method: 'POST', body: JSON.stringify(body) });
}

// ── 比价雷达 / 搜索洞察 ──

export interface RadarItem {
  id: string; code: string; name: string;
  referencePrice: number; supplier: string; isLowest: boolean; isOutlier: boolean;
}
export interface PriceRadarData {
  minPrice: number | null; avgPrice: number | null; stdDeviation?: number | null;
  outliers: RadarItem[]; items: RadarItem[];
}
export function getPriceRadar(categoryId?: number) {
  return request<PriceRadarData>(`/api/catalog/admin/price-radar${categoryId ? `?categoryId=${categoryId}` : ''}`);
}
export interface SearchInsights {
  gapKeywords: { keyword: string; count: number }[];
  topSearches: { keyword: string; count: number }[];
}
export function getSearchInsights() {
  return request<SearchInsights>('/api/catalog/admin/search-insights');
}

// ── AI 辅助（分类识别 / 价格研判）──

export interface AiClassifyAttribute { templateId: number; fieldKey: string; value: string }
export interface AiClassifyResult {
  categoryId: number | null;
  categoryName: string | null;
  /** 0~1，≥0.6 视为可自动采纳（与后端默认阈值对齐） */
  confidence: number;
  reason: string | null;
  attributes: AiClassifyAttribute[];
  /** false 表示 LLM/数据缺失的降级返回，前端应提示手动填写 */
  backedByData: boolean;
}
export function aiClassifyCatalogItem(input: { name: string; specification?: string; categoryIdHint?: number }) {
  return request<AiClassifyResult>('/api/catalog/admin/items/ai-classify', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      specification: input.specification || undefined,
      categoryIdHint: input.categoryIdHint ?? undefined,
    }),
  });
}

export interface AiPriceAnalysisDetail {
  abnormal: boolean;
  severity: 'low' | 'medium' | 'high';
  reasons: string[];
  suggestion: string | null;
  confidence: number;
}
export interface AiPriceAnalysisResult {
  analysis: AiPriceAnalysisDetail | null;
  backedByData: boolean;
}
export function getAiPriceAnalysis(itemId: string) {
  return request<AiPriceAnalysisResult>(`/api/catalog/admin/items/${itemId}/ai-price-analysis`);
}
