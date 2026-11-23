/** 供应商库（2026-11-19 供应商板块：GET /supplier/list——:3005 供应商库同源；
 *  2026-11-23 扩面：库状态/行业/企业类型/评价四统计 + 详情/时间线/资质/评价/参评项目） */
import { api } from '../api';

export type SupplierStatus = 'PENDING' | 'RETURNED' | 'APPROVED' | 'REJECTED' | 'DISABLED' | 'BLACKLIST';

export type SupplierItem = {
  id: string;
  name: string;
  status: SupplierStatus;
  supplierNo?: string | null;
  shortName?: string | null;
  creditCode?: string | null;
  /** 所属国民经济行业（行业分布同源） */
  industry?: string | null;
  /** 原始企业登记类型（变体多，展示走 normalizeEnterpriseType） */
  enterpriseType?: string | null;
  region?: string | null;
  legalRepresentative?: string | null;
  registeredCapital?: string | null;
  registeredAt?: string | null;
  establishedDate?: string | null;
  isTemporary?: boolean;
  completeness?: number;
  qualificationSummary?: string | null;
  tags?: string[];
  companyId?: string | null;
  companyName?: string | null;
  companies?: Array<{ id: string; name: string; shortName: string | null; status: string }>;
  _count?: { evaluations: number; qualifications: number; contacts: number };
  /** 概览等级（众数）/ 最近一次等级——后端 attachAvgScores 附加 */
  _avgGrade?: string | null;
  _latestEvalLevel?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SupplierListResult = {
  total: number;
  page: number;
  pageSize: number;
  items: SupplierItem[];
};

export async function fetchSupplierLibrary(params?: {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  sort?: 'completeness' | 'createdAt';
  companyId?: string;
}): Promise<SupplierListResult> {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.status) q.set('status', params.status);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  if (params?.sort) q.set('sort', params.sort);
  if (params?.companyId) q.set('companyId', params.companyId);
  const qs = q.toString();
  return api.get<SupplierListResult>(`/supplier/list${qs ? `?${qs}` : ''}`);
}

export const SUPPLIER_STATUS_LABELS: Record<SupplierStatus, string> = {
  PENDING: '待审核',
  RETURNED: '已退回',
  APPROVED: '已入库',
  REJECTED: '已拒绝',
  DISABLED: '已停用',
  BLACKLIST: '黑名单',
};

/* ── 库统计（公司隔离，admin 可逗号多选 ?companyId=）── */

export type SupplierLibraryStats = {
  /** 库内四态总数（在库含临时 / 停用 / 黑名单；审批流转件不计） */
  total: number;
  pending: number;
  approved: number;
  disabled: number;
  blacklist: number;
  returned: number;
  temporaryApproved: number;
};
export async function fetchSupplierLibraryStats(companyId?: string): Promise<SupplierLibraryStats> {
  const q = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
  return api.get<SupplierLibraryStats>(`/supplier/stats${q}`);
}

/** 行业分布（派生自注册「所属国民经济行业」；name=行业名，未填写为「未填写」排尾） */
export type SupplierIndustryBucket = { id: string; name: string; _count: { suppliers: number } };
export async function fetchSupplierIndustries(companyId?: string): Promise<SupplierIndustryBucket[]> {
  const q = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
  return api.get<SupplierIndustryBucket[]>(`/supplier/classifications${q}`);
}

/** 企业类型分布（原始 enterpriseType 分桶——客户端 normalizeEnterpriseType 归并后再排行） */
export async function fetchSupplierEnterpriseTypes(companyId?: string): Promise<{ counts: Record<string, number> }> {
  const q = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
  return api.get<{ counts: Record<string, number> }>(`/supplier/enterprise-type-distribution${q}`);
}

/** 履约评价等级分布（槽位去重口径） */
export type SupplierEvalStats = { levelCounts: Record<string, number>; excellentRatio: number; total: number };
export async function fetchSupplierEvalStats(companyId?: string): Promise<SupplierEvalStats> {
  const q = companyId ? `?companyId=${encodeURIComponent(companyId)}` : '';
  return api.get<SupplierEvalStats>(`/supplier/evaluations/stats${q}`);
}

/* ── 供应商详情（对齐 :3005 supplier/[id]：基本信息 / 关键节点 / 资质材料 / 参与情况 / 履约评价）── */

export type SupplierContact = {
  id: string;
  name: string;
  position?: string | null;
  phone?: string | null;
  email?: string | null;
  isPrimary: boolean;
};

export type SupplierQualification = {
  id: string;
  type: string;
  name: string;
  fileUrl?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  status: string;
  createdAt: string;
};

export type SupplierBankAccount = {
  id: string;
  accountName: string;
  bankName: string;
  bankBranch?: string | null;
  accountNo?: string | null;
  isDefault: boolean;
};

export type SupplierPerformance = {
  id: string;
  projectName: string;
  clientName?: string | null;
  contractAmount?: string | null;
  signDate?: string | null;
  description?: string | null;
  proofFiles?: unknown;
};

export type SupplierEvaluation = {
  id: string;
  projectId: string | null;
  completenessGrade: string;
  responsivenessGrade: string;
  cooperationGrade: string;
  complianceGrade: string;
  comprehensiveGrade: string;
  finalGrade: string;
  comment: string | null;
  evidence?: unknown;
  evaluationSource: string;
  reviewReason?: string | null;
  createdAt: string;
  evaluator?: { id: string; displayName: string } | null;
  /** listEvaluations 手工补的项目名 */
  project?: { id: string; name: string; stage: string } | null;
};

/** 参评项目（BidSupplier 分配 + 评标结果对照） */
export type SupplierBidProject = {
  projectId: string;
  project: { id: string; name: string; stage: string; procurementMethod: string; openTime: string | null; deadline: string | null };
  downloadStatus: string;
  submitStatus: string;
  decryptStatus: string;
  confirmStatus: string;
  result: { rank: number | null; recommended: boolean | null; disqualified: boolean | null; bidPrice: number | null; generatedAt: string | null } | null;
};

/** 时间线事件（注册/审核/状态变更/绩效评价/参与项目，升序） */
export type SupplierTimelineEvent = { type: string; label: string; detail: string; at: string; grade?: string | null };

export type SupplierDetail = Omit<SupplierItem, 'legalRepresentative' | 'registeredAt'> & {
  legalPerson: string;
  legalPersonIdCard?: string | null;
  legalPersonPhone?: string | null;
  registeredAddress: string;
  detailedAddress?: string | null;
  businessScope: string;
  logoUrl?: string | null;
  organizationCode?: string | null;
  country?: string | null;
  companyEmail?: string | null;
  companyWebsite?: string | null;
  companyProfile?: string | null;
  temporaryExpiresAt?: string | null;
  user?: { id: string; username: string; displayName: string; email: string | null; role: string; isActive: boolean } | null;
  contacts: SupplierContact[];
  qualifications: SupplierQualification[];
  bankAccounts: SupplierBankAccount[];
  performances: SupplierPerformance[];
  evaluations: SupplierEvaluation[];
};

export async function fetchSupplierDetail(id: string): Promise<SupplierDetail> {
  return api.get<SupplierDetail>(`/supplier/${id}`);
}
export async function fetchSupplierTimeline(id: string): Promise<SupplierTimelineEvent[]> {
  const r = await api.get<{ events: SupplierTimelineEvent[] }>(`/supplier/${id}/timeline`);
  return r.events ?? [];
}
export async function fetchSupplierEvaluations(id: string): Promise<SupplierEvaluation[]> {
  return api.get<SupplierEvaluation[]>(`/supplier/${id}/evaluations`);
}
export async function fetchSupplierBidProjects(id: string): Promise<SupplierBidProject[]> {
  return api.get<SupplierBidProject[]>(`/supplier/${id}/evaluation-projects`);
}
