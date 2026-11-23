/** 专家库列表（2026-11-20：GET /expert-admin——:3005 专家库同源） */
import { api } from '../api';

export type ExpertListItem = {
  id: string;
  displayName: string;
  username: string;
  companyId: string | null;
  isActive: boolean;
  expertProfile: {
    id: string;
    specialty: string | null;
    title: string | null;
    employer: string | null;
    phone: string | null;
    entryStatus: string;
    availability: string | null;
    retiredAt: string | null;
  } | null;
  latestEval: { level: string; createdAt: string } | null;
  avgGrade: string | null;
};

export type ExpertListResult = {
  total: number;
  page: number;
  pageSize: number;
  items: ExpertListItem[];
};

/* ── 专家详情（2026-11-23：对齐 :3005 expert/[id]——基本信息/关键节点/评价历史/评审项目四区）── */

/** 履职评价（ExpertLevel 枚举 A–E；evidence=三维评价依据） */
export type ExpertEvaluation = {
  id: string;
  projectId: string | null;
  attendanceGrade: string;
  qualityGrade: string;
  disciplineGrade: string;
  overallGrade: string;
  comment: string | null;
  evidence?: { attendanceGrade?: string; qualityGrade?: string; disciplineGrade?: string } | null;
  reviewReason?: string | null;
  createdAt: string;
  evaluator?: { id: string; displayName: string } | null;
};

/** 违规记录（AuditLog 行：action=EXPERT_VIOLATION_RECORDED，details 带 type/detail/severity） */
export type ExpertViolation = {
  id: string;
  details: { type?: string; detail?: string; severity?: 'warning' | 'danger' } | null;
  createdAt: string;
  user?: { displayName: string } | null;
};

/** 评审项目分配行（BidExpert；管理端默认脱敏） */
export type ExpertAssignment = {
  id: string;
  major: string;
  progress: number;
  signedIn: boolean;
  avoidanceConfirmed: boolean;
  totalScore: number | string;
  isLead: boolean;
  invitationStatus: string;
  project: { id: string; projectCode: string; name: string; stage: string; procurementMethod: string; openTime: string | null };
  scoreRecords: unknown[];
};

/** GET /expert-admin/:id（与 :3005 详情页同源；PII 字段管理端默认掩码） */
export type ExpertDetail = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  /** 专家编号：{公司编码}-{同公司入库序号} */
  expertNo?: string;
  companyId: string | null;
  department: { id: string; name: string } | null;
  createdAt: string;
  isActive: boolean;
  /** 库况四态（正在评标/已被抽取/候补待命/空闲）——池外（已退库/已停用）经 lifecycleLabelOf 优先链判定 */
  busyState?: string;
  expertProfile: {
    specialty: string | null;
    title: string | null;
    qualifications: string | null;
    employer: string | null;
    phone: string | null;
    idNumber: string | null;
    ethnicity: string | null;
    education: string | null;
    licenseNo: string | null;
    availability: string | null;
    entryStatus: string;
    notes: string | null;
    verifiedAt: string | null;
    retiredAt: string | null;
    regionCode: string | null;
    expertLevel: string | null;
    aiEvaluation: string | null;
    aiEvaluatedAt: string | null;
  } | null;
  assignments: ExpertAssignment[];
  /** 最近 20 条（全量走 fetchExpertEvaluations） */
  evaluations?: ExpertEvaluation[];
  statistics: {
    totalProjects: number;
    completedProjects: number;
    signedInProjects: number;
    evalCount: number;
    gradeCounts: Record<string, number>;
  };
  /** 邀请信用摘要（2026-10-21 :3005 口径） */
  invitationSummary?: {
    invited: number;
    confirmed: number;
    declined: number;
    pending: number;
    overrideAfterConfirm: number;
    consecutiveDeclined: number;
    breachEvents: { projectName: string; at: string; reason: string | null; actorName: string | null }[];
  };
};

export async function fetchExpertDetail(id: string): Promise<ExpertDetail> {
  return api.get<ExpertDetail>(`/expert-admin/${id}`);
}

/** 履职评价全量（:3005 评价历史 tab 同源） */
export async function fetchExpertEvaluations(id: string): Promise<ExpertEvaluation[]> {
  return api.get<ExpertEvaluation[]>(`/expert-admin/${id}/evaluations`);
}

/** 违规记录（并入关键节点时间轴，与 :3005 大事记同构） */
export async function fetchExpertViolations(id: string): Promise<ExpertViolation[]> {
  return api.get<ExpertViolation[]>(`/expert-admin/violations?expertId=${encodeURIComponent(id)}`);
}

export async function fetchExpertList(params?: {
  search?: string;
  specialty?: string;
  employer?: string;
  page?: number;
  pageSize?: number;
  companyId?: string;
  statusTab?: string;
}): Promise<ExpertListResult> {
  const q = new URLSearchParams();
  if (params?.search) q.set('search', params.search);
  if (params?.specialty) q.set('specialty', params.specialty);
  if (params?.employer) q.set('employer', params.employer);
  if (params?.page) q.set('page', String(params.page));
  if (params?.pageSize) q.set('pageSize', String(params.pageSize));
  if (params?.companyId && params.companyId !== 'all') q.set('companyId', params.companyId);
  if (params?.statusTab) q.set('statusTab', params.statusTab);
  const qs = q.toString();
  return api.get<ExpertListResult>(`/expert-admin${qs ? `?${qs}` : ''}`);
}
