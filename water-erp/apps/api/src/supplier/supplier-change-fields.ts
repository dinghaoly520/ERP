/**
 * 供应商资料变更字段白名单
 *
 * 只允许以下字段通过变更申请修改。
 * 禁止修改 status / userId / id / creditCode / normalizedName / classificationId 等敏感字段。
 */

export const SUPPLIER_CHANGE_ALLOWED_FIELDS = [
  'name',
  'enterpriseType',
  'legalPerson',
  'registeredAddress',
  'businessScope',
  'tags',
] as const;

export type SupplierChangeAllowedField =
  (typeof SUPPLIER_CHANGE_ALLOWED_FIELDS)[number];

export function isSupplierChangeAllowedField(
  fieldName: string,
): fieldName is SupplierChangeAllowedField {
  return (SUPPLIER_CHANGE_ALLOWED_FIELDS as readonly string[]).includes(fieldName);
}
