import type { AiBidTaskStatus, AiBidderStatus } from '@/lib/types/ai-bid-analysis';

export const AI_BID_TASK_STARTABLE_STATUSES = [
  'CREATED',
  'TENDER_UPLOADING',
  'TENDER_READY',
  'BIDDERS_UPLOADING',
] as const satisfies readonly AiBidTaskStatus[];

export const AI_BID_TASK_PROCESSING_STATUSES = [
  'ANALYZING',
  'TENDER_PROCESSING',
  'BIDDERS_PROCESSING',
] as const satisfies readonly AiBidTaskStatus[];

export const AI_BID_TASK_SCORING_VISIBLE_STATUSES = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const satisfies readonly AiBidTaskStatus[];

export const AI_BIDDER_PROCESSING_STATUSES = [
  'OCR_PROCESSING',
  'EXTRACTING',
  'SCORING',
  'DEVIATION_ANALYZING',
] as const satisfies readonly AiBidderStatus[];

export const AI_BIDDER_PARSED_STATUSES = [
  'OCR_COMPLETED',
  'EXTRACTING',
  'EXTRACTED',
  'SCORING',
  'SCORED',
  'DEVIATION_ANALYZING',
  'COMPLETED',
] as const satisfies readonly AiBidderStatus[];

export const AI_BIDDER_READY_STATUSES = [
  'OCR_COMPLETED',
  'EXTRACTED',
  'SCORED',
  'COMPLETED',
] as const satisfies readonly AiBidderStatus[];

function includesStatus<T extends string>(statuses: readonly T[], status: T) {
  return statuses.includes(status);
}

export function isAiBidTaskStartableStatus(status: AiBidTaskStatus) {
  return includesStatus(AI_BID_TASK_STARTABLE_STATUSES, status);
}

export function isAiBidTaskProcessingStatus(status: AiBidTaskStatus) {
  return includesStatus(AI_BID_TASK_PROCESSING_STATUSES, status);
}

export function isAiBidTaskScoringVisibleStatus(status: AiBidTaskStatus) {
  return includesStatus(AI_BID_TASK_SCORING_VISIBLE_STATUSES, status);
}

export function isAiBidderProcessingStatus(status: AiBidderStatus) {
  return includesStatus(AI_BIDDER_PROCESSING_STATUSES, status);
}

export function isAiBidderParsedStatus(status: AiBidderStatus) {
  return includesStatus(AI_BIDDER_PARSED_STATUSES, status);
}

export function isAiBidderReadyStatus(status: AiBidderStatus) {
  return includesStatus(AI_BIDDER_READY_STATUSES, status);
}
