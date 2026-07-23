/**
 * 开评标实时事件 — 类型化的事件名与载荷。
 *
 * 被 API gateway（发射端）、bid-portal（host/admin/supervisor 接收端）、
 * expert-portal（专家接收端，仅聚合在场）三方共享。
 *
 * 铁律：分数（score）永不出现在事件载荷中。事件只携带*活动里程碑*，
 * 不携带*评审内容*（招标投标法 · 专家独立评审）。
 */

// ── 事件名常量 ──
export const BID_EVENT = {
  DECRYPT_STATUS: 'decrypt:status',
  SUBMISSION_OPENED: 'submission:opened',
  OPENING_STARTED: 'opening:started',
  STAGE_CHANGE: 'stage:change',
  EVALUATION_STARTED: 'evaluation:started',
  EXPERT_PRESENCE: 'expert:presence',
  EXPERT_PRESENCE_AGGREGATE: 'expert:presence:aggregate',
  CLARIFICATION_CREATED: 'clarification:created',
  CLARIFICATION_REPLIED: 'clarification:replied',
  SUPERVISION_LOG: 'supervision:log',
  ANOMALY_DETECTED: 'anomaly:detected',
  PRESENCE_HEARTBEAT: 'presence:heartbeat',
  BID_VALIDITY_CHANGE: 'bid:validity:change',
  HALL_MESSAGE_NEW: 'hall:message:new',
  HALL_PRESENCE_UPDATE: 'hall:presence:update',
  HALL_CHECKIN: 'hall:checkin',
  HALL_EXCHANGE_CONTROL: 'hall:exchange:control',
  OPENING_CONFIRMED: 'opening:confirmed',
  OPENING_DISPUTED: 'opening:disputed',
  OPENING_DISPUTE_RESOLVED: 'opening:dispute:resolved',
} as const;

// ── 载荷类型 ──
export interface DecryptStatusPayload {
  supplierId: string;
  supplierName: string;
  decryptStatus: 'PENDING' | 'RUNNING' | 'SUCCESS' | 'DANGER';
  timestamp: number;
}

export interface SubmissionOpenedPayload {
  projectId: string;
  timestamp: number;
}

export interface OpeningStartedPayload {
  projectId: string;
  host: string;
  supervisor: string;
  timestamp: number;
}

export interface StageChangePayload {
  projectId: string;
  from: string;
  to: string;
  actor: string;
}

export interface EvaluationStartedPayload {
  projectId: string;
  timestamp: number;
}

export interface ExpertPresencePayload {
  expertId: string;
  expertName: string;
  milestone: 'signed_in' | 'avoidance_confirmed' | 'scoring_activity' | 'report_confirmed';
  supplierName?: string;
  progressPercent: number;
  timestamp: number;
}

export interface ExpertPresenceAggregatePayload {
  projectId: string;
  signedInCount: number;
  totalExperts: number;
  avoidanceConfirmedCount: number;
  reportConfirmedCount: number;
  averageProgressPercent: number;
  timestamp: number;
}

export interface ClarificationCreatedPayload {
  id: string;
  issuer: string;
  issuerRole: string;
  supplierName: string;
  questionPreview: string;
  timestamp: number;
}

export interface ClarificationRepliedPayload {
  id: string;
  replier: string;
  replyPreview: string;
  timestamp: number;
}

export interface SupervisionLogPayload {
  role: string;
  action: string;
  target: string;
  result: string;
  riskFlag: string;
  time: number;
}

export interface AnomalyDetectedPayload {
  type: string;
  supplierId?: string;
  supplierName?: string;
  detail: string;
  severity: 'warning' | 'danger';
  timestamp: number;
}

export interface BidValidityChangePayload {
  supplierId: string;
  failCount: number;
  totalCount: number;
  status: 'invalid' | 'revoked';
  timestamp: number;
}

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

// ── 开标大厅（迭代一：实时文字地基）──

export type OpeningHallRoomType = 'PUBLIC' | 'PRIVATE';
export type OpeningHallSenderRole = 'HOST' | 'SUPPLIER' | 'SYSTEM';

export interface HallMessagePayload {
  id: string;
  projectId: string;
  roomType: OpeningHallRoomType;
  supplierId: string | null;   // PRIVATE 时为 Supplier.id；PUBLIC 为 null
  supplierName: string | null;
  senderId: string;
  senderRole: OpeningHallSenderRole;
  senderName: string;
  content: string;
  createdAt: string;           // ISO
  timestamp: number;
}

export interface HallPresenceUpdatePayload {
  projectId: string;
  onlineSuppliers: Array<{ supplierId: string; supplierName: string; checkInAt: string | null }>;
  onlineCount: number;
  timestamp: number;
}

export interface HallCheckinPayload {
  projectId: string;
  supplierId: string;
  supplierName: string;
  checkInAt: string;
  timestamp: number;
}

export interface HallExchangeControlPayload {
  projectId: string;
  control: 'OPEN' | 'MUTED' | 'CLOSED';
  by: string;
  timestamp: number;
}

export interface OpeningConfirmedPayload {
  projectId: string;
  supplierId: string;
  supplierName: string;
  timestamp: number;
}

export interface OpeningDisputedPayload {
  projectId: string;
  supplierId: string;
  supplierName: string;
  reason: string;
  timestamp: number;
}

export interface OpeningDisputeResolvedPayload {
  projectId: string;
  supplierId: string;
  supplierName: string;
  recordId: string;
  confirm: boolean;
  result: string;
  timestamp: number;
}
