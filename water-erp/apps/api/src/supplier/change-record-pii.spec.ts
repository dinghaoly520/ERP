import {
  sealChangeValue,
  openChangeValue,
  maskChangeValue,
} from './change-record-pii';
import { openPii, isSealedFieldSm } from '../common/crypto/sm-field-crypto';

describe('change-record-pii（供应商变更申请 PII 密封/拆封/脱敏）', () => {
  beforeEach(() => {
    process.env.FIELD_ENC_SECRET = 'unit-test-field-enc-secret-0123456789abcdef';
  });
  afterEach(() => {
    delete process.env.FIELD_ENC_SECRET;
  });

  describe('简单 PII 字段（legalPersonIdCard / legalPersonPhone）', () => {
    it('密封 → 密文非明文；拆封 → 原文', () => {
      const sealed = sealChangeValue('legalPersonIdCard', '51102319900101123X')!;
      expect(sealed).toMatch(/^sm1:/);
      expect(sealed).not.toContain('511023');
      expect(openChangeValue('legalPersonIdCard', sealed)).toBe('51102319900101123X');
    });

    it('管理端展示：拆封后掩码', () => {
      const sealed = sealChangeValue('legalPersonPhone', '13812345678')!;
      expect(maskChangeValue('legalPersonPhone', sealed)).toBe('138****5678');
      expect(maskChangeValue('legalPersonIdCard', sealChangeValue('legalPersonIdCard', '51102319900101123X'))).toBe(
        '5110**********123X',
      );
    });
  });

  describe('非 PII 字段原样透传', () => {
    it('name/registeredAddress 等不加密不掩码', () => {
      expect(sealChangeValue('name', '四川水发建设有限公司')).toBe('四川水发建设有限公司');
      expect(openChangeValue('registeredAddress', '成都市高新区')).toBe('成都市高新区');
      expect(maskChangeValue('businessScope', '水利水电施工')).toBe('水利水电施工');
      expect(sealChangeValue('name', null)).toBeNull();
    });
  });

  describe('bankAccounts 聚合 JSON：只密封 accountNo', () => {
    it('密封/拆封 roundtrip，其余键不动', () => {
      const json = JSON.stringify([
        { accountName: '四川水发建设有限公司', bankName: '工行成都分行', accountNo: '6222020200112233445', isDefault: true },
      ]);
      const sealed = sealChangeValue('bankAccounts', json)!;
      expect(sealed).not.toContain('6222020200112233445');
      expect(sealed).toContain('工行成都分行'); // 非敏感键明文保留
      const opened = openChangeValue('bankAccounts', sealed)!;
      expect(JSON.parse(opened)[0].accountNo).toBe('6222020200112233445');
    });

    it('管理端展示 accountNo 掩码', () => {
      const sealed = sealChangeValue('bankAccounts', JSON.stringify([
        { accountName: '甲', bankName: '乙', accountNo: '6222020200112233445' },
      ]))!;
      const masked = JSON.parse(maskChangeValue('bankAccounts', sealed)!);
      expect(masked[0].accountNo).toBe('6222***********3445');
    });
  });

  describe('convertToRegular 聚合 JSON：legalPersonIdCard + contacts PII', () => {
    const payload = () => JSON.stringify({
      enterpriseType: '国有企业',
      legalPerson: '张三',
      legalPersonIdCard: '51102319900101123X',
      legalIdFileUrl: 'https://minio/xx',
      contacts: [{ name: '李四', phone: '13812345678', email: 'lisi@example.com', isPrimary: true }],
    });

    it('密封/拆封 roundtrip', () => {
      const sealed = sealChangeValue('convertToRegular', payload())!;
      expect(sealed).not.toContain('51102319900101123X');
      expect(sealed).not.toContain('13812345678');
      const opened = JSON.parse(openChangeValue('convertToRegular', sealed)!);
      expect(opened.legalPersonIdCard).toBe('51102319900101123X');
      expect(opened.contacts[0].phone).toBe('13812345678');
      expect(opened.contacts[0].email).toBe('lisi@example.com');
    });

    it('管理端展示：身份证/手机/邮箱掩码', () => {
      const sealed = sealChangeValue('convertToRegular', payload())!;
      const masked = JSON.parse(maskChangeValue('convertToRegular', sealed)!);
      expect(masked.legalPersonIdCard).toBe('5110**********123X');
      expect(masked.contacts[0].phone).toBe('138****5678');
      expect(masked.contacts[0].email).toBe('l***@example.com');
      expect(masked.legalPerson).toBe('张三'); // 非敏感不动
    });
  });

  describe('健壮性', () => {
    it('JSON 解析失败原样返回（不因脱敏工具炸审批流）', () => {
      expect(openChangeValue('bankAccounts', 'not-json')).toBe('not-json');
      expect(maskChangeValue('convertToRegular', 'not-json')).toBe('not-json');
    });

    it('旧明文值（无 sm1: 前缀）open/mask 原样或直接掩码', () => {
      // openPii 对无前缀值抛错——openChangeValue 须守卫（容错），maskChangeValue 对明文直接掩码
      expect(openChangeValue('legalPersonIdCard', '51102319900101123X')).toBe('51102319900101123X');
      expect(maskChangeValue('legalPersonIdCard', '51102319900101123X')).toBe('5110**********123X');
    });
  });
});
