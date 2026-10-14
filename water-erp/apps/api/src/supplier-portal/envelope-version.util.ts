/* =================================================================
   envelope-version.util — 信封版本统一分派（阶段2 Task13）
   读端唯一入口：禁止新代码裸比 envelopeVersion 字符串（未知版本静默
   落旧轨=错轨解密风险）。分派以 submission.envelopeVersion 落列为准。
   ================================================================= */
import { BadRequestException } from '@nestjs/common';

export type EnvelopeTrack = 'legacy' | 'dual-v2' | 'dual-v3';

/** dual-v3 灰度开关：capabilities.allowedEnvelopeVersions 与投递端组装随此开关 */
export function v3Enabled(): boolean {
  return process.env.CA_SUPPLIER_V3_ENABLED === 'true';
}

/** 读端统一分派：未知版本 → 400 ENVELOPE_VERSION_UNKNOWN（显式拒绝，不静默落轨） */
export function resolveEnvelopeVersion(
  sub: { envelopeVersion?: string | null },
): EnvelopeTrack {
  const v = sub?.envelopeVersion;
  if (!v) return 'legacy';
  if (v === 'dual-v2' || v === 'dual-v3') return v;
  throw new BadRequestException({
    error: `未知的信封版本 '${v}'——请升级客户端或联系管理员`,
    code: 'ENVELOPE_VERSION_UNKNOWN',
  });
}
