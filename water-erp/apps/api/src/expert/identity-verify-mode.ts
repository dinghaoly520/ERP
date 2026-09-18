// 身份核验模式闸 —— spec: docs/superpowers/specs/2026-09-18-expert-identity-verification-design.md §4.3
// self = 必拍留档照 + 遮挡检测（默认）；host = self 基础上另需主持人核验登记（P3 启用）；off = 应急（留档照可选，摄像头故障场景）
export type IdentityVerifyMode = 'self' | 'host' | 'off';

export const IDENTITY_VERIFY_MODE_ENV = 'EXPERT_IDENTITY_VERIFY';

export function resolveIdentityVerifyMode(env: NodeJS.ProcessEnv = process.env): IdentityVerifyMode {
  const raw = env[IDENTITY_VERIFY_MODE_ENV];
  return raw === 'host' || raw === 'off' ? raw : 'self';
}
