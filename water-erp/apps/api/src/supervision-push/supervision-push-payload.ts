// apps/api/src/supervision-push/supervision-push-payload.ts
import * as crypto from 'crypto';
import { canonicalJson } from '@water-erp/ukey';

export const SUPERVISION_PAYLOAD_TYPES = [
  'EVALUATION_REPORT',
  'OPENING_RECORD',
  'EXPERT_CREDIT',
  'EXPERT_PERFORMANCE',
] as const;

export type SupervisionPayloadType = (typeof SUPERVISION_PAYLOAD_TYPES)[number];

export interface SupervisionAttachmentRef {
  name: string;
  category: string;
  fileAssetId: string;
  sha256: string;
}

export interface SupervisionPushEnvelope {
  packageType: 'SUPERVISION_PUSH';
  packageVersion: 1;
  payloadType: SupervisionPayloadType;
  platformCode: string;
  generatedAt: string;
  project: { id: string; projectCode: string; name: string; procurementMethod: string };
  body: Record<string, unknown>;
  attachments: SupervisionAttachmentRef[];
}

export interface PushEnvelopeInput {
  payloadType: SupervisionPayloadType;
  platformCode: string;
  generatedAt: string;
  project: SupervisionPushEnvelope['project'];
  body: Record<string, unknown>;
  attachments: SupervisionAttachmentRef[];
}

/** A-153：监督推送信封（spec §4.5）——4 类载荷一次定型的适配层核心结构 */
export function buildPushEnvelope(input: PushEnvelopeInput): SupervisionPushEnvelope {
  return {
    packageType: 'SUPERVISION_PUSH',
    packageVersion: 1,
    payloadType: input.payloadType,
    platformCode: input.platformCode,
    generatedAt: input.generatedAt,
    project: input.project,
    body: input.body,
    attachments: [...input.attachments].sort((a, b) => (a.fileAssetId < b.fileAssetId ? -1 : 1)),
  };
}

/**
 * 指纹 = sha256(canonicalJson(envelope))——与既有文件包 fingerprint 同一实现。
 * canonicalJson 复用 @water-erp/ukey（前后端唯一规范化实现）；哈希用 node:crypto 同步计算——
 * ukey 的 sha256Hex 是 crypto.subtle 异步版（既有调用均 await），而本契约（spec/Task 8 signFingerprint）
 * 要求同步 string，digest 值与 sha256Hex 完全一致（同一 SHA-256、同一 UTF-8 字节）。
 */
export function envelopeFingerprint(envelope: SupervisionPushEnvelope): string {
  return crypto.createHash('sha256').update(canonicalJson(envelope)).digest('hex');
}
