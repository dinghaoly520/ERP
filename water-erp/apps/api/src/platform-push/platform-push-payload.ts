// apps/api/src/platform-push/platform-push-payload.ts
// 对接专项 Phase 1（doc §三/§四）：中间信封 + 载荷指纹——序列化收敛在 service（五通道共享
// 同一中间信封；省平台规约发布后仅 sc_province 通道在信封外加加密/签名层，不改本结构）。
import * as crypto from 'crypto';
import { canonicalJson } from '@water-erp/ukey';
import { AnnouncementType } from '@prisma/client';

/** 383号文信息范围十类（doc §三映射表；plan 暂无公告体——Phase 2 公告 metadata 扩展键承载） */
export const PUSH_ITEM_TYPES = [
  'plan', 'bid_notice', 'clarify', 'failed_bid', 'pre_win', 'win',
  'contract', 'fulfillment', 'penalty', 'prequal',
] as const;
export type PushItemType = (typeof PUSH_ITEM_TYPES)[number];

export const PUSH_CHANNELS = ['offline', 'mock', 'sc_province', 'ceb_national', 'mwr_water'] as const;
export type PushChannelCode = (typeof PUSH_CHANNELS)[number];

/** AnnouncementType → itemType 映射（POLICY/PLATFORM 非交易信息不推；不在表内的类型不进清单） */
export const ANNOUNCEMENT_TYPE_TO_ITEM_TYPE: Partial<Record<AnnouncementType, PushItemType>> = {
  BID_NOTICE: 'bid_notice',
  ADDENDUM: 'clarify',
  CLARIFY_NOTICE: 'clarify',
  FAILED_BID_NOTICE: 'failed_bid',
  PRE_WIN_NOTICE: 'pre_win',
  WIN_NOTICE: 'win',
  WIN_BID_NOTICE: 'win',
  CONTRACT_NOTICE: 'contract',
  PERFORMANCE_NOTICE: 'fulfillment',
  PREQUAL_NOTICE: 'prequal',
};

/** 待推范围内公告类型（供 findMany in 查询） */
export const PUSHABLE_ANNOUNCEMENT_TYPES = Object.keys(ANNOUNCEMENT_TYPE_TO_ITEM_TYPE) as AnnouncementType[];

/** 中间信封（schema='sc-v2-preview'：预览与推送同一份确定性产物，hash 锚定它） */
export interface PlatformPushEnvelope {
  itemType: PushItemType;
  schema: 'sc-v2-preview';
  projectCode: string | null;
  gbProcureCode: string | null;
  title: string;
  publishedAt: string | null;
  fields: Record<string, unknown>;
  masked: string[];
}

/** 脱敏选项（doc §七-3：限价/合同金额——预览与推送同源同规则） */
export interface PushMaskOptions {
  ceilingPrice?: boolean;
  contractAmount?: boolean;
}

/**
 * 载荷指纹 = sha256(canonicalJson(envelope))——与 supervision-push envelopeFingerprint 同一实现：
 * canonicalJson 复用 @water-erp/ukey 前后端唯一规范化实现，node:crypto 同步计算（digest 与
 * ukey 异步 sha256Hex 完全一致）。信封不含易变字段（无时间戳），preview/dispatch 同 DB 状态必同值。
 */
export function payloadFingerprint(envelope: PlatformPushEnvelope): string {
  return crypto.createHash('sha256').update(canonicalJson(envelope)).digest('hex');
}
