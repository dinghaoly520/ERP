import {
  SUPPLIER_CHANGE_ALLOWED_FIELDS,
  SUPPLIER_CHANGE_FIELD_LABELS,
  supplierChangeFieldLabel,
} from './supplier-change-fields';

/**
 * 变更字段中文名归一（2026-10-29 异构环境实录）：图示环境待审列表透出
 * 「变更 2 项资料：legalRepresentative、address」——存量/异构客户端把英文原始
 * 字段键当 fieldLabel 落库直达界面。词表须优先于客户端 label，裸英文标识符
 * 形态的存量 label 不得透出。
 */
describe('supplierChangeFieldLabel（变更字段中文名归一——永不透出裸英文字段键）', () => {
  it('白名单字段：服务端词表优先——即使客户端/存量 label 是英文键本身', () => {
    expect(supplierChangeFieldLabel('legalPerson', 'legalPerson')).toBe('法定代表人');
    expect(supplierChangeFieldLabel('businessScope', 'businessScope')).toBe('经营范围');
    expect(supplierChangeFieldLabel('legalPerson')).toBe('法定代表人');
  });

  it('词表外存量脏行（legalRepresentative/address/contactName 等）：裸英文 label 不透出，落通用兜底', () => {
    expect(supplierChangeFieldLabel('legalRepresentative', 'legalRepresentative')).toBe('资料信息');
    expect(supplierChangeFieldLabel('contactPhone', 'contactPhone')).toBe('资料信息');
    expect(supplierChangeFieldLabel('address')).toBe('资料信息');
  });

  it('词表外字段但 label 为中文 → 保留（服务端自造记录，如临时转正式）', () => {
    expect(supplierChangeFieldLabel('convertToRegular', '临时转正式')).toBe('临时转正式');
  });

  it('词表完备性：白名单每个字段都有中文名（防新增字段漏配回落英文）', () => {
    for (const f of SUPPLIER_CHANGE_ALLOWED_FIELDS) {
      expect(SUPPLIER_CHANGE_FIELD_LABELS[f]).toBeTruthy();
    }
  });
});
