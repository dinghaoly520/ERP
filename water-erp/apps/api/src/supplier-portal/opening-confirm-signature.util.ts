// apps/api/src/supplier-portal/opening-confirm-signature.util.ts
import { canonicalJson } from '@water-erp/ukey';

/** A-114：开标记录确认签名 canonical 输入（全部不可变字段——杜绝验证期漂移）。 */
export interface OpeningConfirmCanonicalInput {
  purpose: 'confirm' | 'resign'; // 首次确认 | 已确认记录补签
  projectId: string;
  supplierId: string;
  bidSupplierId: string | null;
  recordId: string;
  supplierName: string;
  amount: string;
  period: string;
  qualityTarget: string;
  bondStatus: string;
  decryptResult: string;
}

export function buildOpeningConfirmCanonical(input: OpeningConfirmCanonicalInput): string {
  return canonicalJson({
    v: 1,
    purpose: input.purpose,
    projectId: input.projectId,
    supplierId: input.supplierId,
    bidSupplierId: input.bidSupplierId,
    recordId: input.recordId,
    supplierName: input.supplierName,
    openingRecord: {
      amount: input.amount,
      period: input.period,
      qualityTarget: input.qualityTarget,
      bondStatus: input.bondStatus,
      decryptResult: input.decryptResult,
    },
  });
}

/** 主持端/唱标总表视图剥壳：完整签名 → 摘要（本人视图与开标文件包保留完整证据）。 */
export function stripOpeningConfirmSignature(record: { confirmSignature: unknown }) {
  const sig = record.confirmSignature as { algorithm?: string; verifiedAt?: string } | null;
  return sig ? { algorithm: sig.algorithm ?? 'SM2/SM3', verifiedAt: sig.verifiedAt ?? null } : null;
}
