/* =================================================================
   revocation — 证书吊销检查接口（阶段1 占位，阶段2 接四川CA CRL）

   设计意图：绑定/换绑时点的链校验通过后，吊销状态是另一独立维度。
   阶段2 实现形态：CRL 离线文件（经跳板机定期拉取）或厂商 OCSP——
   内网优先 CRL。接口先立，业务侧只依赖抽象。
   ================================================================= */
import { ParsedX509 } from './x509-cert';

export interface RevocationCheckResult {
  revoked: boolean;
  /** 吊销原因/来源说明（审计留痕） */
  reason?: string;
}

export interface RevocationChecker {
  check(cert: ParsedX509): Promise<RevocationCheckResult>;
}

/** 阶段1 空实现：恒不吊销（TRUSTED_CA_DIR 未配 CRL 时的默认行为） */
export class NullRevocationChecker implements RevocationChecker {
  async check(_cert: ParsedX509): Promise<RevocationCheckResult> {
    return { revoked: false };
  }
}
