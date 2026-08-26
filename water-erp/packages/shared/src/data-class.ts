/**
 * A2（GB/T 43711 表 B.1/B.3）：交易数据集公开范围与功能属性分类。
 */

export const DATA_CLASS_LABELS = {
  public_mandatory: '应公开',
  public_voluntary: '宜公开',
  public_conditional: '可公开',
  confidential: '应保密',
} as const;

export type DataClassValue = keyof typeof DATA_CLASS_LABELS;

export const DATA_DOMAIN_LABELS = {
  trade: '交易过程数据',
  supervision: '监管数据',
  rights: '权益保护数据',
} as const;

export type DataDomainValue = keyof typeof DATA_DOMAIN_LABELS;

/** 公开门户可见级别（B.1：仅"应公开/宜公开"对外） */
export const PUBLIC_VISIBLE_CLASSES: DataClassValue[] = ['public_mandatory', 'public_voluntary'];

/** 表 B.1：公告类型 → 默认公开范围 */
export const ANNOUNCEMENT_TYPE_DATA_CLASS: Record<string, DataClassValue> = {
  BID_NOTICE: 'public_mandatory',
  ADDENDUM: 'public_mandatory',
  PREQUAL_NOTICE: 'public_mandatory',
  PRE_WIN_NOTICE: 'public_mandatory',
  WIN_NOTICE: 'public_mandatory',
  CONTRACT_NOTICE: 'public_mandatory',
  PERFORMANCE_NOTICE: 'public_mandatory',
  POLICY: 'public_voluntary',
  PLATFORM: 'public_voluntary',
};

/** 表 B.1：文件类目 → 默认分级与归属域 */
export const FILE_CATEGORY_DATA_CLASS: Record<string, { dataClass: DataClassValue; dataDomain: DataDomainValue }> = {
  bid_document: { dataClass: 'public_conditional', dataDomain: 'trade' }, // 采购文件：可公开
  bid_document_encrypted: { dataClass: 'confidential', dataDomain: 'rights' }, // 加密递交件：应保密（权益）
  bid_inner_ciphertext: { dataClass: 'confidential', dataDomain: 'rights' },
  bid_decrypted: { dataClass: 'confidential', dataDomain: 'rights' },
  announcement: { dataClass: 'public_mandatory', dataDomain: 'trade' },
  contract_document: { dataClass: 'confidential', dataDomain: 'trade' },
  prequal_document: { dataClass: 'confidential', dataDomain: 'trade' },
  framework_document: { dataClass: 'confidential', dataDomain: 'trade' },
  project_attachment: { dataClass: 'confidential', dataDomain: 'trade' },
  tender_document: { dataClass: 'confidential', dataDomain: 'trade' },
};

export function fileCategoryDefaults(category?: string | null) {
  return FILE_CATEGORY_DATA_CLASS[category ?? ''] ?? { dataClass: 'confidential' as DataClassValue, dataDomain: 'trade' as DataDomainValue };
}
