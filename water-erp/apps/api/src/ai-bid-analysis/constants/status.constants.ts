// apps/api/src/ai-bid-analysis/constants/status.constants.ts
// ★ per-item 适配（Phase 3.1）：AiAnalysisTaskStatus（7 值）替代旧 AiBidTaskStatus（11 值）；
//   AiBidderStatus 加 CONCORDANCE_CHECKING；状态机简化为 ERP 流程

/**
 * AI 投标分析任务状态（与 Prisma AiAnalysisTaskStatus 一致）
 * ERP 流程：PENDING → TENDER_PROCESSING → ANALYZING → COMPLETED/COMPLETED_WITH_ERRORS
 */
export const AI_BID_TASK_STATUS = {
  PENDING: 'PENDING',
  TENDER_PROCESSING: 'TENDER_PROCESSING',
  ANALYZING: 'ANALYZING',
  COMPLETED: 'COMPLETED',
  COMPLETED_WITH_ERRORS: 'COMPLETED_WITH_ERRORS',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

/**
 * 投标单位处理状态（与 Prisma AiBidderStatus 一致）
 * 加 CONCORDANCE_CHECKING（双源一致性校验，per-item 版新增）
 */
export const AI_BIDDER_STATUS = {
  PENDING: 'PENDING',
  OCR_PROCESSING: 'OCR_PROCESSING',
  OCR_COMPLETED: 'OCR_COMPLETED',
  EXTRACTING: 'EXTRACTING',
  EXTRACTED: 'EXTRACTED',
  CONCORDANCE_CHECKING: 'CONCORDANCE_CHECKING',
  SCORING: 'SCORING',
  SCORED: 'SCORED',
  DEVIATION_ANALYZING: 'DEVIATION_ANALYZING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

export const AI_BID_TASK_STATUS_LABELS: Record<string, string> = {
  PENDING: '待处理',
  TENDER_PROCESSING: '招标文件处理中',
  ANALYZING: '分析中',
  COMPLETED: '已完成',
  COMPLETED_WITH_ERRORS: '完成（含错误）',
  FAILED: '失败',
  CANCELLED: '已取消',
};

export const AI_BID_TASK_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  TENDER_PROCESSING: 'bg-blue-100 text-blue-700',
  ANALYZING: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-green-100 text-green-700',
  COMPLETED_WITH_ERRORS: 'bg-amber-100 text-amber-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

export const AI_BIDDER_STATUS_LABELS: Record<string, string> = {
  PENDING: '待处理',
  OCR_PROCESSING: 'OCR识别中',
  OCR_COMPLETED: 'OCR完成',
  EXTRACTING: '信息提取中',
  EXTRACTED: '提取完成',
  CONCORDANCE_CHECKING: '一致性校验中',
  SCORING: '评分中',
  SCORED: '评分完成',
  DEVIATION_ANALYZING: '偏差分析中',
  COMPLETED: '已完成',
  FAILED: '失败',
};

export const AI_BIDDER_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  OCR_PROCESSING: 'bg-blue-100 text-blue-700',
  OCR_COMPLETED: 'bg-cyan-100 text-cyan-700',
  EXTRACTING: 'bg-indigo-100 text-indigo-700',
  EXTRACTED: 'bg-purple-100 text-purple-700',
  CONCORDANCE_CHECKING: 'bg-teal-100 text-teal-700',
  SCORING: 'bg-yellow-100 text-yellow-700',
  SCORED: 'bg-orange-100 text-orange-700',
  DEVIATION_ANALYZING: 'bg-pink-100 text-pink-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
};

/**
 * 允许启动分析的任务状态
 * ERP：招标文件处理完成（TENDER_PROCESSING）后可启动分析
 */
export const ALLOWED_START_ANALYSIS_STATUSES = [
  AI_BID_TASK_STATUS.TENDER_PROCESSING,
] as const;

/**
 * 任务状态转换规则（ERP 简化流程）
 */
export const TASK_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: [AI_BID_TASK_STATUS.TENDER_PROCESSING, AI_BID_TASK_STATUS.FAILED, AI_BID_TASK_STATUS.CANCELLED],
  TENDER_PROCESSING: [AI_BID_TASK_STATUS.ANALYZING, AI_BID_TASK_STATUS.FAILED],
  ANALYZING: [AI_BID_TASK_STATUS.COMPLETED, AI_BID_TASK_STATUS.COMPLETED_WITH_ERRORS, AI_BID_TASK_STATUS.FAILED, AI_BID_TASK_STATUS.CANCELLED],
  COMPLETED: [],
  COMPLETED_WITH_ERRORS: [AI_BID_TASK_STATUS.ANALYZING],
  FAILED: [AI_BID_TASK_STATUS.PENDING],
  CANCELLED: [],
};

/**
 * 投标单位进度百分比映射
 */
export const BIDDER_PROGRESS_MAP: Record<string, number> = {
  PENDING: 0,
  OCR_PROCESSING: 20,
  OCR_COMPLETED: 25,
  EXTRACTING: 40,
  EXTRACTED: 45,
  CONCORDANCE_CHECKING: 50,
  SCORING: 60,
  SCORED: 80,
  DEVIATION_ANALYZING: 90,
  COMPLETED: 100,
  FAILED: 0,
};
