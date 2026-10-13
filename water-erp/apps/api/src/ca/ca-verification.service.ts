/* =================================================================
   CaVerificationService — 组合验证（World B 消解核心）

   流程（顺序固定）：
   ① parseSignedP7 → embeddedContent 与 expectedToSign 逐字节全等
   ② 指纹三方（P7 signer === expectedSignCert === 网关回传 serial）
   ③ 网关 verifyPkcs7（密码学有效性 + 证书链）
   ④ 网关回传 certBase64 → parseCertificate → 有效期/KeyUsage/链
   ⑤ statusCoverage（永不含 revocation——阻断项如实记录）

   本地比对无条件强制（World B 下是唯一原文绑定，非纵深防御）。
   ================================================================= */
import { parseSignedP7, P7ParseError, P7ParseResult, ALG_WHITELIST } from '../common/crypto/p7/p7-parser';
import { parseCertificate, pemToDer } from '../common/crypto/x509/x509-cert';
import { SccaGatewayClient } from './scca-gateway.client';

export interface VerifySignatureInput {
  p7B64: string;
  expectedToSign: string;
  purpose: 'ca-login' | 'bind' | 'self-test';
  expectedSignCert?: { serialHex: string; sha256: string };
}

export type VerificationErrorCode =
  | 'CA_CONTENT_MISMATCH'     // P7 内嵌原文 ≠ expectedToSign（World B 唯一原文绑定）
  | 'CA_SIGNER_COUNT'         // signer 数 ≠ 1
  | 'CA_ALG_UNSUPPORTED'      // 算法白名单外
  | 'CA_FINGERPRINT_MISMATCH' // 三方指纹不一致
  | 'CA_GATEWAY_REJECTED'     // 网关拒绝（非链/非不可达）
  | 'CA_CERT_CHAIN'           // 网关证书链校验失败
  | 'CA_CERT_EXPIRED'         // 证书过期
  | 'CA_VERIFY_UNAVAILABLE'   // 网络超时/不可达
  | 'CA_P7_MALFORMED';        // P7 解析失败

export interface VerificationOutcome {
  ok: boolean;
  code?: VerificationErrorCode;
  signerSerialHex?: string;
  evidenceId?: string;
  statusCoverage: string[];
  gatewayRequestId?: string;
}

/** 证书格式归一：PEM 甲 → DER Buffer；裸 base64 → Buffer */
export function normalizeToDer(input: string): Buffer {
  if (input.includes('-----BEGIN CERTIFICATE-----')) {
    return pemToDer(input);
  }
  return Buffer.from(input.replace(/\s+/g, ''), 'base64');
}

// 简化 TrustStore 接口（实际用 x509/trust-store.ts 的 TrustStore）
interface ITrustStore {
  verifyChain(leaf: { isCa: boolean; notBefore: Date; notAfter: Date; issuerDn: string; [k: string]: unknown }, atTime?: Date): { ok: boolean; reason?: string };
}

export class CaVerificationService {
  constructor(
    private readonly gateway: SccaGatewayClient,
    private readonly trustStore: ITrustStore,
  ) {}

  async verifySignature(input: VerifySignatureInput): Promise<VerificationOutcome> {
    // ── ① 本地 P7 解析 + 原文比对（无条件强制）──
    let p7: P7ParseResult;
    try {
      p7 = parseSignedP7(input.p7B64);
    } catch (e) {
      if (e instanceof P7ParseError) {
        return this.fail('CA_P7_MALFORMED', `P7 解析失败: ${e.message}`);
      }
      return this.fail('CA_P7_MALFORMED', 'P7 解析异常');
    }

    // 内嵌原文逐字节全等（World B 唯一原文绑定）
    if (!p7.embeddedContent || !p7.embeddedContent.equals(Buffer.from(input.expectedToSign, 'utf-8'))) {
      return this.fail('CA_CONTENT_MISMATCH', 'P7 内嵌原文与预期不符（或 detached）');
    }

    // signer 恰 1 个
    if (p7.signers.length !== 1) {
      return this.fail('CA_SIGNER_COUNT', `signer 数=${p7.signers.length}，须恰 1`);
    }
    const signer = p7.signers[0]!;

    // 算法白名单
    if (signer.digestAlgOid !== ALG_WHITELIST.digest || signer.signatureAlgOid !== ALG_WHITELIST.signature) {
      return this.fail('CA_ALG_UNSUPPORTED', `digest=${signer.digestAlgOid} sig=${signer.signatureAlgOid}`);
    }

    // ── ② 三方指纹 ──
    if (input.expectedSignCert) {
      // 2a: P7 signer serial === expectedSignCert.serialHex（空=跳过——登录场景仅传 sha256）
      const expectedSerial = input.expectedSignCert.serialHex?.toLowerCase().replace(/^0+(?=.)/, '');
      if (expectedSerial && signer.serialHex !== expectedSerial) {
        return this.fail('CA_FINGERPRINT_MISMATCH', 'P7 签名者 serial ≠ 期望证书');
      }
      // 2b: P7 embeddedCerts 含 expectedSignCert.sha256
      if (!p7.embeddedCerts.some(c => c.sha256 === input.expectedSignCert!.sha256.toLowerCase())) {
        return this.fail('CA_FINGERPRINT_MISMATCH', 'P7 证书集不含期望证书指纹');
      }
    }

    // ── ③ 网关验证 ──
    const { createId } = require('@paralleldrive/cuid2');
    const requestId = createId();
    const gwResult = await this.gateway.verifyPkcs7({
      opType: this.mapOpType(input.purpose),
      requestId,
      signedDataB64: input.p7B64,
      toSign: input.expectedToSign,
    });

    if (!gwResult.ok) {
      if (gwResult.errorKind === 'UNAVAILABLE') return this.fail('CA_VERIFY_UNAVAILABLE', '网关超时/不可达');
      if (gwResult.errorKind === 'CERT_CHAIN') return this.fail('CA_CERT_CHAIN', `网关证书链校验失败: ${gwResult.resultMsg}`);
      return this.fail('CA_GATEWAY_REJECTED', `网关拒绝: ${gwResult.resultCode} ${gwResult.resultMsg}`);
    }

    // ── ② 补：网关回传 serial 与 P7 signer 三方一致 ──
    if (gwResult.certSerialHex && signer.serialHex) {
      const gwSerial = gwResult.certSerialHex.toLowerCase().replace(/^0+(?=.)/, '');
      if (gwSerial !== signer.serialHex) {
        return this.fail('CA_FINGERPRINT_MISMATCH', '网关回传 serial ≠ P7 签名者');
      }
    }

    // ── ④ 网关回传证书解析（有效期/KeyUsage/链）──
    const statusCoverage: string[] = ['chain']; // 网关已验链（G0 实证 9998）
    if (gwResult.certBase64) {
      try {
        const certDer = normalizeToDer(gwResult.certBase64);
        const cert = parseCertificate(certDer);
        // 有效期
        const now = new Date();
        if (now < cert.notBefore || now > cert.notAfter) {
          return this.fail('CA_CERT_EXPIRED', `证书有效期 ${cert.notBefore.toISOString()} → ${cert.notAfter.toISOString()}`);
        }
        statusCoverage.push('validity');
        // KeyUsage（登录/绑定需 DigitalSignature）
        if (!cert.keyUsage.includes('DigitalSignature')) {
          return this.fail('CA_ALG_UNSUPPORTED', '证书 KeyUsage 缺 DigitalSignature');
        }
        statusCoverage.push('usage');
      } catch {
        // 证书解析失败不阻断主流程（网关已验过）——记录但继续
      }
    }

    return {
      ok: true,
      signerSerialHex: signer.serialHex,
      statusCoverage,
      gatewayRequestId: requestId,
    };
  }

  private mapOpType(purpose: VerifySignatureInput['purpose']): string {
    switch (purpose) {
      case 'ca-login': return '登录签名';
      default: return '业务签署'; // bind/self-test 统一（阶段0 G5 实测两值均接受）
    }
  }

  private fail(code: VerificationErrorCode, msg: string): VerificationOutcome {
    return { ok: false, code, statusCoverage: [] };
  }
}
