// apps/api/src/supplier-portal/clarification-reply.util.ts
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
