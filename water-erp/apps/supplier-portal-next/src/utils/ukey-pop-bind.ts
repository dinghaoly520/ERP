/* =================================================================
   ukey-pop-bind — 证书绑定 PoP（Proof of Possession）流程封装

   后端契约（apps/api b43c77e4）：
   - GET  /supplier-portal/profile/cert/challenge → { nonce, expiresIn }
     （Redis 300s TTL 一次性消费）
   - POST /supplier-portal/profile/cert 携带 popNonce + popSignature →
     SignatureService.verify（与盾 /sign 端点同参 {hash:true}，mock/真CA 同构）

   流程：取挑战 → adapter.sign(certSn, nonce)（私钥不出盾）→ 带证明提交。
   任何一步失败上抛（页面层 toast），绑定不提交。
   ================================================================= */

/** 依赖面（最小接口——测试与页面注入，避免耦合具体 api/adapter 实现） */
export interface PopBindApi {
  certBindChallenge(): Promise<{ nonce: string; expiresIn: number }>;
  bindCert(data: Record<string, unknown>): Promise<unknown>;
}

export interface PopBindAdapter {
  sign(certSn: string, msg: string): Promise<string>;
}

export interface PopBindCert {
  certSn: string;
  certDn: string;
  publicKey: string;
  alg?: string;
  notBefore?: string;
  notAfter?: string;
  /** 真盾轨（X.509 DER base64）——@water-erp/ukey CertInfo 加该字段后自动透传 */
  rawCert?: string;
}

/** 绑定证书（带私钥持有证明）。成功返回后端 bindCert 结果。 */
export async function bindCertWithPop(
  api: PopBindApi,
  adapter: PopBindAdapter,
  cert: PopBindCert,
): Promise<unknown> {
  // 1. 取一次性挑战（失败=网络/会话问题，直接上抛）
  const { nonce } = await api.certBindChallenge();
  // 2. 盾内签名（私钥不出盾；盾拔出/会话超时在此暴露）
  const popSignature = await adapter.sign(cert.certSn, nonce);
  // 3. 声明字段 + PoP 证明提交（rawCert 留真盾 adapter 提供 CertInfo.rawCert 后追加）
  return api.bindCert({
    certSn: cert.certSn,
    certDn: cert.certDn,
    publicKey: cert.publicKey,
    alg: cert.alg ?? "SM2",
    ...(cert.notBefore ? { notBefore: cert.notBefore } : {}),
    ...(cert.notAfter ? { expiresAt: cert.notAfter } : {}),
    ...(cert.rawCert ? { rawCert: cert.rawCert } : {}),
    popNonce: nonce,
    popSignature,
  });
}
