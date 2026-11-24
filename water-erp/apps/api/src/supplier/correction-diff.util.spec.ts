import { buildCorrectionDiff } from './correction-diff.util';

const baseSnap = () => ({
  name: '成都测试商贸有限公司', creditCode: '91510100MA00000000', supplierNo: 'SUP-000001',
  enterpriseType: '有限责任公司', legalPerson: '张三', legalPersonIdCard: '5101**********0011', legalPersonPhone: '135****0000',
  registeredAddress: '成都市XX路1号', detailedAddress: null, businessScope: '销售建材',
  logoUrl: null, organizationCode: null, country: '中国', region: '四川', registeredCapital: '100万元',
  industry: '零售业', companyEmail: null, companyWebsite: null, companyProfile: null,
  tags: ['建材物资销售'], establishedDate: '2016-05-30',
  companyId: 'co-1', companyName: '四川水发兴川置业管理有限公司',
  account: { username: 'u1', displayName: '测试', email: null },
  contacts: [{ name: '李四', gender: '男', phone: '139****1111', idCard: '5101**********2222', email: null, position: '经理', isPrimary: true }],
  qualifications: [{ type: '营业执照', name: '营业执照', fileUrl: '/api/upload/files/f1', attachments: [], validFrom: null, validTo: null }],
  bankAccounts: [], performances: [],
});

describe('buildCorrectionDiff（补正变更清单，2026-11-24 spec）', () => {
  it('主档字段变更只列变化项（掩码值直接比对）', () => {
    const n = { ...baseSnap(), registeredCapital: '500万元' } as Record<string, unknown>;
    const sections = buildCorrectionDiff(baseSnap() as Record<string, unknown>, n);
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe('main');
    expect(sections[0].items).toEqual([
      { kind: 'modified', rowLabel: '注册资金（万元）', oldValue: '100万元', newValue: '500万元' },
    ]);
  });

  it('旧快照缺键的字段跳过（存量快照无 companyId/establishedDate/companyProfile）', () => {
    const o = baseSnap() as Record<string, unknown>;
    delete o.companyId; delete o.companyName; delete o.establishedDate; delete o.companyProfile;
    const n = { ...baseSnap(), companyName: '四川水发建设有限公司' } as Record<string, unknown>;
    expect(buildCorrectionDiff(o, n)).toEqual([]);
  });

  it('子表行修改/新增 + 资质证照文件替换标记', () => {
    const o = baseSnap() as Record<string, unknown>;
    const n = { ...baseSnap(),
      contacts: [
        { name: '李四', gender: '男', phone: '138****9999', idCard: '5101**********2222', email: null, position: '经理', isPrimary: true },
        { name: '王五', gender: '女', phone: '137****0000', idCard: null, email: null, position: null, isPrimary: false },
      ],
      qualifications: [{ type: '营业执照', name: '营业执照', fileUrl: '/api/upload/files/f2', attachments: [], validFrom: null, validTo: null }],
    } as Record<string, unknown>;
    const sections = buildCorrectionDiff(o, n);
    const contactsSec = sections.find(s => s.key === 'contacts')!;
    expect(contactsSec.items).toContainEqual({ kind: 'modified', rowLabel: '主要联系人 李四', fieldLabel: '联系电话', oldValue: '139****1111', newValue: '138****9999' });
    expect(contactsSec.items).toContainEqual({ kind: 'added', rowLabel: '联系人 王五' });
    const qualsSec = sections.find(s => s.key === 'qualifications')!;
    expect(qualsSec.items).toEqual([{ kind: 'modified', rowLabel: '营业执照', fieldLabel: '证照原件', fileReplaced: true }]);
  });

  it('银行账户/主体业绩行修改与删除', () => {
    const o = { ...baseSnap(),
      bankAccounts: [{ id: 'b1', accountName: '对公账户', bankName: '工商银行', bankBranch: null, accountNo: '6222************1111', isDefault: true }],
      performances: [{ id: 'p1', projectName: 'X水库维修', clientName: '某水务局', contractAmount: '300万元', signDate: '2025-01-01', description: null, proofFiles: [] }],
    } as Record<string, unknown>;
    const n = { ...baseSnap(),
      bankAccounts: [{ id: 'b2', accountName: '对公账户', bankName: '建设银行', bankBranch: null, accountNo: '6222************1111', isDefault: true }],
      performances: [],
    } as Record<string, unknown>;
    const sections = buildCorrectionDiff(o, n);
    expect(sections.find(s => s.key === 'bankAccounts')!.items).toContainEqual(
      { kind: 'modified', rowLabel: '对公账户（工商银行）', fieldLabel: '开户银行', oldValue: '工商银行', newValue: '建设银行' });
    expect(sections.find(s => s.key === 'performances')!.items).toEqual([{ kind: 'removed', rowLabel: 'X水库维修' }]);
  });

  it('归属公司变更（按 companyId 门槛、展示 companyName）', () => {
    const o = baseSnap() as Record<string, unknown>;
    const n = { ...baseSnap(), companyId: 'co-2', companyName: '四川水发建设有限公司' } as Record<string, unknown>;
    const sections = buildCorrectionDiff(o, n);
    expect(sections[0].items).toContainEqual(
      { kind: 'modified', rowLabel: '归属公司', oldValue: '四川水发兴川置业管理有限公司', newValue: '四川水发建设有限公司' });
  });

  it('tags 多值并列展示', () => {
    const o = baseSnap() as Record<string, unknown>;
    const n = { ...baseSnap(), tags: ['建材物资销售', '工程物资销售'] } as Record<string, unknown>;
    const sections = buildCorrectionDiff(o, n);
    expect(sections[0].items[0]).toMatchObject({ rowLabel: '业务标签', oldValue: '建材物资销售', newValue: '建材物资销售、工程物资销售' });
  });

  it('无变化 → 空数组；任一侧快照缺失 → 空数组', () => {
    expect(buildCorrectionDiff(baseSnap() as Record<string, unknown>, baseSnap() as Record<string, unknown>)).toEqual([]);
    expect(buildCorrectionDiff(null, baseSnap() as Record<string, unknown>)).toEqual([]);
    expect(buildCorrectionDiff(undefined, undefined)).toEqual([]);
  });
});
