// apps/api/src/expert/expert-esign.util.ts
import { canonicalJson } from '@water-erp/ukey';

/**
 * A-152：评标报告电子签名 canonical 输入（全部不可变字段，与开标确认签名同范式）。
 * - purpose 固定 'report_esign'（验证期语义锚点，杜绝跨场景串签）
 * - packetSha256/packetGeneratedAt 绑入签字包指纹：签字包重生成即换载荷，旧签名自动失效
 */
export interface ExpertEsignCanonicalInput {
  purpose: 'report_esign';
  projectId: string;
  bidExpertId: string;
  userId: string;
  expertName: string;
  packetSha256: string;
  packetGeneratedAt: string; // ISO
}

/** BidExpert.esignature 的落库形状（完整证据：payload+签名值+证书指纹） */
export interface ExpertEsignatureRecord {
  v: 1;
  payload: string;
  signature: string;
  algorithm: 'SM2/SM3';
  certSn: string;
  verifiedAt: string; // ISO
}

export function buildExpertEsignCanonical(input: ExpertEsignCanonicalInput): string {
  return canonicalJson({
    v: 1,
    purpose: input.purpose,
    projectId: input.projectId,
    bidExpertId: input.bidExpertId,
    userId: input.userId,
    expertName: input.expertName,
    packetSha256: input.packetSha256,
    packetGeneratedAt: input.packetGeneratedAt,
  });
}

/** 剥壳摘要（回流包 / 本人视图用；完整证据留 DB 的 BidExpert.esignature） */
export function stripExpertEsignature(
  esignature: unknown,
): { algorithm: string; certSn: string | null; verifiedAt: string | null } | null {
  const sig = esignature as Partial<ExpertEsignatureRecord> | null | undefined;
  if (!esignature || typeof esignature !== 'object') return null;
  return {
    algorithm: sig?.algorithm ?? 'SM2/SM3',
    certSn: sig?.certSn ?? null,
    verifiedAt: sig?.verifiedAt ?? null,
  };
}
