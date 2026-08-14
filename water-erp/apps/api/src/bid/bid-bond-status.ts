/**
 * 投标保证金核对状态 —— 规范定义已收口到 @water-erp/shared（bid-bond-status.ts，D4a）。
 * 此文件保留为 re-export 包装，兼容既有 import 路径（含 bid-bond-status.spec.ts）。
 */
export {
  BOND_STATUS,
  BOND_STATUS_OPTIONS,
  isBondQualified,
  type BondStatusValue,
} from '@water-erp/shared';
