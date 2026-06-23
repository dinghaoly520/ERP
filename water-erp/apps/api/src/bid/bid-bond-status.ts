/** 投标保证金核对状态（主持人开标时人工核对录入，固定枚举，禁止自由文本）。 */
export const BOND_STATUS = {
  PAID: '已缴纳',
  GUARANTEE: '保函有效',
  UNPAID: '未缴纳',
  ABNORMAL: '异常',
} as const;

export type BondStatusValue = (typeof BOND_STATUS)[keyof typeof BOND_STATUS];

/** 前端下拉选项（顺序即展示顺序）。 */
export const BOND_STATUS_OPTIONS: BondStatusValue[] = [
  BOND_STATUS.PAID,
  BOND_STATUS.GUARANTEE,
  BOND_STATUS.UNPAID,
  BOND_STATUS.ABNORMAL,
];

const QUALIFIED_STATUSES: ReadonlySet<string> = new Set([BOND_STATUS.PAID, BOND_STATUS.GUARANTEE]);

/** 保证金是否达标（已缴纳或保函有效）。空值/未核对/异常 → false。 */
export function isBondQualified(status: string | null | undefined): boolean {
  return !!status && QUALIFIED_STATUSES.has(status);
}
