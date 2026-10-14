/* CaOperation 状态机常量（附录 §2.1） */
// 阶段2.5 T8：投递链新增 PAYLOAD_READY（prepare/signing-payload 冻结载荷后、
// commit 前的稳定态——五提交端点统一按此门+CAS 单次推进）
export const CA_OP_STATUS = {
  PREPARED: 'PREPARED',
  VERIFYING: 'VERIFYING',
  PAYLOAD_READY: 'PAYLOAD_READY',
  COMMITTED: 'COMMITTED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;

export type CaOpStatus = keyof typeof CA_OP_STATUS;

export const CA_OP_PURPOSE = {
  CA_LOGIN: 'ca-login',
  BIND: 'bind',
  REPLACE: 'replace',
  REVOKE: 'revoke',
  SELF_TEST: 'self-test',
} as const;
