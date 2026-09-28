/* =================================================================
   chain-verifier — SM2/X.509 证书链验证（叶子 → 中间 → 信任根）

   职责边界：只做路径构建与密码学/结构校验（签名、时间窗、CA 标志、深度），
   不做吊销检查（RevocationChecker 接口留给阶段2 接 CRL）。
   错误码语义：
   - NO_PATH_TO_TRUSTED_ROOT：按 DN 找不到可验签的签发者（含错根/无锚）
   - BAD_SIGNATURE：DN 匹配但签名验证失败（篡改场景——区别于无路径）
   - NOT_CA：签发者证书非 CA（BasicConstraints cA=false）
   - EXPIRED / NOT_YET_VALID：链上任一证书超出 atTime 时间窗
   ================================================================= */
import { ParsedX509, verifyCertSignature } from './x509-cert';

/** 含叶子与根在内的最大链长（叶子 + 最多 3 级签发者——国密 CA 层级惯例足够） */
export const MAX_CHAIN_DEPTH = 4;

export type ChainVerifyCode =
  | 'CHAIN_OK'
  | 'NO_PATH_TO_TRUSTED_ROOT'
  | 'BAD_SIGNATURE'
  | 'NOT_CA'
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'DEPTH_EXCEEDED';

export interface ChainVerifyResult {
  ok: boolean;
  code: ChainVerifyCode;
  /** 完整链（叶子→…→根）；失败时为已构建部分 */
  chain: ParsedX509[];
  message?: string;
}

const fail = (code: ChainVerifyCode, chain: ParsedX509[], message: string): ChainVerifyResult => ({
  ok: false,
  code,
  chain,
  message,
});

/**
 * 验证 leaf 到 candidates 中某个自签 CA（信任锚）的完整链。
 * @param atTime 时间窗基准时刻（默认 now）——测试注入用
 */
export function verifyChain(leaf: ParsedX509, candidates: ParsedX509[], atTime: Date = new Date()): ChainVerifyResult {
  const chain: ParsedX509[] = [leaf];
  const used = new Set<string>([leaf.serialHex + '|' + leaf.subjectDn]);

  let current = leaf;
  while (true) {
    if (current.notBefore.getTime() > atTime.getTime()) {
      return fail('NOT_YET_VALID', chain, `证书尚未生效（notBefore=${current.notBefore.toISOString()}）：${current.subjectDn}`);
    }
    if (current.notAfter.getTime() < atTime.getTime()) {
      return fail('EXPIRED', chain, `证书已过期（notAfter=${current.notAfter.toISOString()}）：${current.subjectDn}`);
    }

    // 自签信任锚：到达即成功（自签签名在入选锚时已验）
    const anchor = candidates.find((c) => c === current);
    if (anchor && current.issuerDn === current.subjectDn) {
      if (!verifyCertSignature(current, current)) {
        return fail('BAD_SIGNATURE', chain, `信任根自签签名无效：${current.subjectDn}`);
      }
      return { ok: true, code: 'CHAIN_OK', chain };
    }

    if (chain.length >= MAX_CHAIN_DEPTH) {
      return fail('DEPTH_EXCEEDED', chain, `链深度超过上限 ${MAX_CHAIN_DEPTH}`);
    }

    // 找签发者：DN 匹配优先，再验签；记录「DN 匹配但验签失败」以区分篡改
    const dnMatches = candidates.filter((c) => c.subjectDn === current.issuerDn && !used.has(c.serialHex + '|' + c.subjectDn));
    const issuer = dnMatches.find((c) => verifyCertSignature(current, c));
    if (!issuer) {
      if (dnMatches.length > 0) {
        return fail('BAD_SIGNATURE', chain, `签发者 DN 匹配但签名验证失败：${current.issuerDn}`);
      }
      return fail('NO_PATH_TO_TRUSTED_ROOT', chain, `找不到可验证的签发者：${current.issuerDn}`);
    }
    if (!issuer.isCa) {
      return fail('NOT_CA', chain, `签发者证书非 CA：${issuer.subjectDn}`);
    }

    chain.push(issuer);
    used.add(issuer.serialHex + '|' + issuer.subjectDn);
    current = issuer;
  }
}
