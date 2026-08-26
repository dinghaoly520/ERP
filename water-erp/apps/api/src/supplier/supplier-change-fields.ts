/**
 * 供应商资料变更字段白名单
 *
 * 只允许以下字段通过变更申请修改。
 * 禁止修改 status / userId / id / creditCode / normalizedName / classificationId 等敏感字段。
 *
 * 聚合字段（bankAccounts / performances）的 newValue 为 JSON 字符串，审批时整体替换子表。
 * 机构代码 = 统一社会信用代码（敏感不可变），不提供变更入口。
 */

export const SUPPLIER_CHANGE_ALLOWED_FIELDS = [
  'name',
  'enterpriseType',
  'legalPerson',
  'registeredAddress',
  'businessScope',
  'tags',
  // ── 注册 2.0 扩展字段 ──
  'logoUrl',
  'country',
  'region',
  'detailedAddress',
  'registeredCapital',
  'industry',
  'legalPersonPhone',
  'companyEmail',
  'companyWebsite',
  // ── 聚合字段（JSON 整体替换）──
  'bankAccounts',
  'performances',
] as const;

export type SupplierChangeAllowedField =
  (typeof SUPPLIER_CHANGE_ALLOWED_FIELDS)[number];

export function isSupplierChangeAllowedField(
  fieldName: string,
): fieldName is SupplierChangeAllowedField {
  return (SUPPLIER_CHANGE_ALLOWED_FIELDS as readonly string[]).includes(fieldName);
}
