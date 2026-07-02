// 结果状态类型（前端定义，与后端Prisma枚举同步）
export type ResultStatusKey =
  | "AWARDED"
  | "PENDING"
  | "FAILED_REVIEW"
  | "FILE_REVISION_REQUIRED"
  | "INVALID_RESPONSE"
  | "CANCELLED";

// 数据来源类型
export type SourceTypeKey = "MANUAL" | "IMPORTED" | "PROJECT_MANAGEMENT";

// 采购台账项
export type ProcurementRoundItem = {
  id: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  roundNo: number;
  procurementDate: string | null;
  procurementMethod: string;
  departmentId: string | null;
  departmentName: string;
  supplierNames: string[];
  budgetAmount: number | string | null;
  controlAmount: number | string | null;
  awardedSupplierId: string | null;
  awardedSupplierName: string | null;
  awardAmount: number | string | null;
  resultStatus: ResultStatusKey;
  resultStatusLabel: string;
  resultText: string | null;
  sourceType: SourceTypeKey;
  projectManagementId: string | null;
  createdById: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  isRecycled: boolean;
  // Project management extracted info
  initiationDate: string | null;
  expertInfo: string | null;
  biddingUnits: string | null;
  pmAwardedSupplier: string | null;
  contractAmount: number | string | null;
  contractNumber: string | null;
  archivedAt: string | null;
};

// 分页信息
export type PaginationInfo = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

// 列表响应
export type ProcurementsListResponse = {
  data: ProcurementRoundItem[];
  pagination: PaginationInfo;
};

// 筛选状态
export type LedgerFilterState = {
  startDate: string | null;
  endDate: string | null;
  procurementMethod: string | null;
  departmentId: string | null;
  resultStatus: ResultStatusKey | null;
  searchKeyword: string;
  recycleStatus?: "ACTIVE" | "RECYCLED" | "ALL";
};

// 统计汇总
export type LedgerSummary = {
  totalCount: number;
  awardedCount: number;
  pendingCount: number;
  abnormalCount: number;
  totalBudget: number;
  totalBudgetLabel: string;
  totalAward: number;
  totalAwardLabel: string;
  totalSavings: number;
  totalSavingsLabel: string;
};

// 状态配置
export type StatusConfig = {
  key: ResultStatusKey;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: string;
};

// 状态配置映射（颜色按严重程度和原因类型区分）
export const RESULT_STATUS_CONFIG: Record<ResultStatusKey, StatusConfig> = {
  AWARDED: {
    key: "AWARDED",
    label: "已成交",
    color: "rgba(92,181,150,1)",
    bgColor: "rgba(92,181,150,0.12)",
    borderColor: "rgba(92,181,150,0.25)",
    icon: "check",
  },
  PENDING: {
    key: "PENDING",
    label: "待处理",
    color: "rgba(234,188,110,1)",
    bgColor: "rgba(234,188,110,0.12)",
    borderColor: "rgba(234,188,110,0.25)",
    icon: "clock",
  },
  // 资格审查未通过 - 红色（严重：供应商资质问题）
  FAILED_REVIEW: {
    key: "FAILED_REVIEW",
    label: "资格审查未通过",
    color: "rgba(220,90,80,1)",
    bgColor: "rgba(220,90,80,0.12)",
    borderColor: "rgba(220,90,80,0.25)",
    icon: "x",
  },
  // 采购文件需修改 - 紫色/靛蓝（内部问题：可修复的流程缺陷）
  FILE_REVISION_REQUIRED: {
    key: "FILE_REVISION_REQUIRED",
    label: "采购文件需修改",
    color: "rgba(119,129,219,1)",
    bgColor: "rgba(119,129,219,0.12)",
    borderColor: "rgba(119,129,219,0.25)",
    icon: "edit",
  },
  // 未按要求响应 - 橙色（供应商响应问题：格式/密封等）
  INVALID_RESPONSE: {
    key: "INVALID_RESPONSE",
    label: "未按要求响应",
    color: "rgba(230,140,90,1)",
    bgColor: "rgba(230,140,90,0.12)",
    borderColor: "rgba(230,140,90,0.25)",
    icon: "alert",
  },
  // 已取消 - 灰色（流程终止：非异常）
  CANCELLED: {
    key: "CANCELLED",
    label: "已取消",
    color: "rgba(140,140,140,1)",
    bgColor: "rgba(140,140,140,0.12)",
    borderColor: "rgba(140,140,140,0.25)",
    icon: "ban",
  },
};