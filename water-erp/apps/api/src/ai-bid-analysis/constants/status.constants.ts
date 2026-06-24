// apps/api/src/ai-bid-analysis/constants/status.constants.ts

/**
 * AI投标分析任务状态
 * 与 Prisma schema 中的 AiBidTaskStatus enum 保持一致
 */
export const AI_BID_TASK_STATUS = {
  CREATED: 'CREATED',
  TENDER_UPLOADING: 'TENDER_UPLOADING',
  TENDER_PROCESSING: 'TENDER_PROCESSING',
  TENDER_READY: 'TENDER_READY',
  RULES_PREVIEW: 'RULES_PREVIEW',
  BIDDERS_UPLOADING: 'BIDDERS_UPLOADING',
  BIDDERS_PROCESSING: 'BIDDERS_PROCESSING',
  ANALYZING: 'ANALYZING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;

/**
 * 投标单位处理状态
 * 与 Prisma schema 中的 AiBidderStatus enum 保持一致
 */
export const AI_BIDDER_STATUS = {
  PENDING: 'PENDING',
  OCR_PROCESSING: 'OCR_PROCESSING',
  OCR_COMPLETED: 'OCR_COMPLETED',
  EXTRACTING: 'EXTRACTING',
  EXTRACTED: 'EXTRACTED',
  SCORING: 'SCORING',
  SCORED: 'SCORED',
  DEVIATION_ANALYZING: 'DEVIATION_ANALYZING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

/**
 * 任务状态标签（中文）
 */
export const AI_BID_TASK_STATUS_LABELS: Record<string, string> = {
  CREATED: '已创建',
  TENDER_UPLOADING: '招标文件上传中',
  TENDER_PROCESSING: '招标文件处理中',
  TENDER_READY: '招标文件就绪',
  RULES_PREVIEW: '规则预览',
  BIDDERS_UPLOADING: '投标文件上传中',
  BIDDERS_PROCESSING: '投标文件处理中',
  ANALYZING: '分析中',
  COMPLETED: '已完成',
  FAILED: '失败',
  CANCELLED: '已取消',
};

/**
 * 任务状态颜色类名
 */
export const AI_BID_TASK_STATUS_COLORS: Record<string, string> = {
  CREATED: 'bg-gray-100 text-gray-700',
  TENDER_UPLOADING: 'bg-blue-100 text-blue-700',
  TENDER_PROCESSING: 'bg-blue-100 text-blue-700',
  TENDER_READY: 'bg-indigo-100 text-indigo-700',
  RULES_PREVIEW: 'bg-purple-100 text-purple-700',
  BIDDERS_UPLOADING: 'bg-purple-100 text-purple-700',
  BIDDERS_PROCESSING: 'bg-purple-100 text-purple-700',
  ANALYZING: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

/**
 * 投标单位状态标签（中文）
 */
export const AI_BIDDER_STATUS_LABELS: Record<string, string> = {
  PENDING: '待处理',
  OCR_PROCESSING: 'OCR识别中',
  OCR_COMPLETED: 'OCR完成',
  EXTRACTING: '信息提取中',
  EXTRACTED: '提取完成',
  SCORING: '评分中',
  SCORED: '评分完成',
  DEVIATION_ANALYZING: '偏差分析中',
  COMPLETED: '已完成',
  FAILED: '失败',
};

/**
 * 投标单位状态颜色类名
 */
export const AI_BIDDER_STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-700',
  OCR_PROCESSING: 'bg-blue-100 text-blue-700',
  OCR_COMPLETED: 'bg-cyan-100 text-cyan-700',
  EXTRACTING: 'bg-indigo-100 text-indigo-700',
  EXTRACTED: 'bg-purple-100 text-purple-700',
  SCORING: 'bg-yellow-100 text-yellow-700',
  SCORED: 'bg-orange-100 text-orange-700',
  DEVIATION_ANALYZING: 'bg-pink-100 text-pink-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
};

/**
 * 允许启动分析的任务状态
 */
export const ALLOWED_START_ANALYSIS_STATUSES = [
  AI_BID_TASK_STATUS.CREATED,
  AI_BID_TASK_STATUS.TENDER_UPLOADING,
  AI_BID_TASK_STATUS.TENDER_READY,
  AI_BID_TASK_STATUS.BIDDERS_UPLOADING,
] as const;

/**
 * 任务状态转换规则
 */
export const TASK_STATUS_TRANSITIONS: Record<string, string[]> = {
  CREATED: [AI_BID_TASK_STATUS.TENDER_UPLOADING, AI_BID_TASK_STATUS.FAILED],
  TENDER_UPLOADING: [AI_BID_TASK_STATUS.TENDER_PROCESSING, AI_BID_TASK_STATUS.FAILED],
  TENDER_PROCESSING: [AI_BID_TASK_STATUS.TENDER_READY, AI_BID_TASK_STATUS.RULES_PREVIEW, AI_BID_TASK_STATUS.FAILED],
  TENDER_READY: [AI_BID_TASK_STATUS.BIDDERS_UPLOADING, AI_BID_TASK_STATUS.ANALYZING, AI_BID_TASK_STATUS.FAILED],
  RULES_PREVIEW: [AI_BID_TASK_STATUS.BIDDERS_UPLOADING, AI_BID_TASK_STATUS.FAILED],
  BIDDERS_UPLOADING: [AI_BID_TASK_STATUS.ANALYZING, AI_BID_TASK_STATUS.FAILED],
  ANALYZING: [AI_BID_TASK_STATUS.COMPLETED, AI_BID_TASK_STATUS.FAILED, AI_BID_TASK_STATUS.CANCELLED],
  COMPLETED: [],
  FAILED: [AI_BID_TASK_STATUS.CREATED, AI_BID_TASK_STATUS.BIDDERS_UPLOADING],
  CANCELLED: [AI_BID_TASK_STATUS.BIDDERS_UPLOADING],
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
  SCORING: 60,
  SCORED: 80,
  DEVIATION_ANALYZING: 90,
  COMPLETED: 100,
  FAILED: 0,
};
