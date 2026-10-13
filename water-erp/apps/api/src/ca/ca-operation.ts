/* CaOperation 状态机常量（附录 §2.1） */
export const CA_OP_STATUS = {
  PREPARED: 'PREPARED',
  VERIFYING: 'VERIFYING',
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
