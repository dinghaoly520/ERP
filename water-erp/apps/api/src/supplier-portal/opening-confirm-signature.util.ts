// apps/api/src/supplier-portal/opening-confirm-signature.util.ts
import { createHash } from 'crypto';
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

/* ── dual-v3（Task7，附录 §5.C）：canonical v2——不含金额明文，记录内容经快照哈希钉死 ── */

/**
 * 完整记录快照（入哈希，不入 canonical）：唱标业务内容全量 + amountUnit
 * （万元/元单位歧义钉死——2026-09-14 铁律的签名侧落地）。
 */
export interface OpeningRecordSnapshot {
  supplierName: string;
  amount: string;
  amountUnit: string | null;
  period: string;
  qualityTarget: string;
  bondStatus: string;
  decryptResult: string;
  customFields: unknown;
}

/** 快照哈希：sha256(canonicalJson(快照))——键序无关，金额单位隐式歧义在此消解 */
export function computeOpeningRecordHash(snapshot: OpeningRecordSnapshot): string {
  return createHash('sha256').update(canonicalJson(snapshot), 'utf8').digest('hex');
}

/** v2 canonical 输入：版本锚点集合（submission/revision 与会话/记录标识）+ 快照哈希 */
export interface OpeningConfirmCanonicalV2Input {
  purpose: 'confirm' | 'resign';
  recordId: string;
  /** 记录修订号——BidOpeningRecord 无版本列，恒 0 占位（内容完整性由 openingRecordHash 承担） */
  recordRevision: number;
  submissionId: string | null;
  /** SupplierBidSubmission.revision（Task0 列，旧轨/缺行=0） */
  revision: number;
  openingSessionId: string | null;
  /** 会话修订号——BidOpeningSession 无版本列，恒 0 占位 */
  sessionRevision: number;
  openingRecordHash: string;
}

export function buildOpeningConfirmCanonicalV2(input: OpeningConfirmCanonicalV2Input): string {
  return canonicalJson({
    version: 2,
    purpose: input.purpose,
    recordId: input.recordId,
    recordRevision: input.recordRevision,
    submissionId: input.submissionId,
    revision: input.revision,
    openingSessionId: input.openingSessionId,
    sessionRevision: input.sessionRevision,
    openingRecordHash: input.openingRecordHash,
  });
}

/** 主持端/唱标总表视图剥壳：完整签名 → 摘要（本人视图与开标文件包保留完整证据）。 */
export function stripOpeningConfirmSignature(record: { confirmSignature: unknown }) {
  const sig = record.confirmSignature as { algorithm?: string; verifiedAt?: string; certSn?: string } | null;
  return sig ? { algorithm: sig.algorithm ?? 'SM2/SM3', verifiedAt: sig.verifiedAt ?? null, certSn: sig.certSn ?? null } : null;
}
