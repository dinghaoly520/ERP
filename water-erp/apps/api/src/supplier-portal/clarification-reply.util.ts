// apps/api/src/supplier-portal/clarification-reply.util.ts
import { createHash } from 'crypto';
import { canonicalJson } from '@water-erp/ukey';

export interface ClarificationReplyAttachmentRef {
  /** FileAsset id */
  fileAssetId: string;
  /** FileAsset.sha256（hex）——附件指纹进签名域，防替换 */
  sha256: string;
}

export interface ClarificationReplyPayloadInput {
  clarificationId: string;
  projectId: string;
  supplierId: string;
  reply: string;
  attachments: ClarificationReplyAttachmentRef[];
  certSn: string;
}

/**
 * A-143 澄清答复 canonical 载荷——供应商 U盾签名与服务端验签的唯一权威串（spec §3.3）。
 * attachments 强制按 fileAssetId 字典序排序：客户端任意上传顺序得到同一 canonical。
 * 蓝图 = receiptSignature（supplier-portal.service.ts canonicalReceiptPayload）。
 */
export function buildClarificationReplyCanonical(input: ClarificationReplyPayloadInput): string {
  const sorted = [...input.attachments].sort((a, b) =>
    a.fileAssetId < b.fileAssetId ? -1 : a.fileAssetId > b.fileAssetId ? 1 : 0,
  );
  return canonicalJson({
    v: 1,
    clarificationId: input.clarificationId,
    projectId: input.projectId,
    supplierId: input.supplierId,
    reply: input.reply,
    attachments: sorted.map((a) => ({ fileAssetId: a.fileAssetId, sha256: a.sha256 })),
    certSn: input.certSn,
  });
}

/* ── dual-v3（Task8，附录 §5.C）：canonical v2——reply 全文出签（摘要），附件排序+去重 ── */

export interface ClarificationReplyV2Input {
  clarificationId: string;
  projectId: string;
  supplierId: string;
  reply: string;
  attachments: ClarificationReplyAttachmentRef[];
  /** 澄清修订号——BidClarification 无版本列，恒 0 占位（答复唯一性由 TOCTOU 条件写承担） */
  replyRevision: number;
}

export function buildClarificationReplyCanonicalV2(input: ClarificationReplyV2Input): string {
  // 排序+去重：同 id 重复附件归一为一条（乱序/重复输入得到同一 canonical）
  const dedup = new Map<string, string>();
  for (const a of input.attachments) dedup.set(a.fileAssetId, a.sha256);
  const sorted = [...dedup.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([fileAssetId, sha256]) => ({ fileAssetId, sha256 }));
  return canonicalJson({
    version: 2,
    purpose: 'clarification-reply',
    clarificationId: input.clarificationId,
    projectId: input.projectId,
    supplierId: input.supplierId,
    revision: input.replyRevision,
    replySha256: createHash('sha256').update(input.reply, 'utf8').digest('hex'),
    attachments: sorted,
  });
}
