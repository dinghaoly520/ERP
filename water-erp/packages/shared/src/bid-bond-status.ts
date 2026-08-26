/** 投标保证金核对状态（主持人开标时人工核对录入，固定枚举，禁止自由文本）。 */
export const BOND_STATUS = {
  PAID: '已缴纳',
  GUARANTEE: '保函有效',
  UNPAID: '未缴纳',
  ABNORMAL: '异常',
  /** 项目不要求保证金（bondRequired=false）时的默认档——「不适用」非不合格，仅表示免缴。 */
  NA: '不适用',
  /** C4（GB/T 43711 7.5.4.4）：签署/归档后按约定及时退还（BidProject.bondReturnedAt 置时）。 */
  RETURNED: '已退还',
  /** C4：7.5.3.3 情形（弄虚作假/串通/拒签/不交履约担保）→ 不予退还，必填理由并记监督日志。 */
  NOT_REFUNDED: '不予退还',
} as const;

export type BondStatusValue = (typeof BOND_STATUS)[keyof typeof BOND_STATUS];

/** 前端下拉选项（顺序即展示顺序）。 */
export const BOND_STATUS_OPTIONS: BondStatusValue[] = [
  BOND_STATUS.PAID,
  BOND_STATUS.GUARANTEE,
  BOND_STATUS.UNPAID,
  BOND_STATUS.ABNORMAL,
  BOND_STATUS.RETURNED,
  BOND_STATUS.NOT_REFUNDED,
  BOND_STATUS.NA,
];

// 注意：「不适用」不入 QUALIFIED；isBondQualified 闸门仅在 bondRequired 时求值（bid.service），语义安全。
const QUALIFIED_STATUSES: ReadonlySet<string> = new Set([BOND_STATUS.PAID, BOND_STATUS.GUARANTEE]);

/** 保证金是否达标（已缴纳或保函有效）。空值/未核对/异常 → false。 */
export function isBondQualified(status: string | null | undefined): boolean {
  return !!status && QUALIFIED_STATUSES.has(status);
}
