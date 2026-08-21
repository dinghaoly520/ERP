export type EnvelopeRole = 'technical' | 'business' | 'coverLetter' | 'bond';
export interface SealedFields { price: string; deliveryPeriod: string; qualityCommitment: string; }
export interface EnvelopeFileEntry { sha256: string; kself: string; kadmin: string; }
export interface DualEnvelope {
  version: 'dual-v2';
  certSn: string;
  adminCertId: string;
  files: Partial<Record<EnvelopeRole, EnvelopeFileEntry>>;
  /** F+nonce 的供应商层密封件（spec v5）：cipher=SM4(canonicalJson({fields,nonce}))，kself=SM2_Enc(供应商公钥, DEK_F) */
  sealedFields: { cipher: string; kself: string; fieldsSha256: string };
  fieldsCommit: string;
}
export interface CertInfo { certSn: string; certDn: string; publicKey: string; alg: 'SM2'; }
export interface UKeyAdapter {
  name: string;
  listCertificates(): Promise<CertInfo[]>;
  sign(certSn: string, msg: string): Promise<string>;
  /** SM2 解密（私钥在介质内），输入输出均 hex */
  decrypt(certSn: string, cipherHex: string): Promise<string>;
}
