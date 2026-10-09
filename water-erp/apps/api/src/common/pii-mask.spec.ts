import {
  maskIdNumber,
  maskPhone,
  maskEmail,
  maskBankAccount,
  maskLicenseNo,
  maskContact,
} from './pii-mask';

describe('pii-mask（出口脱敏规则）', () => {
  describe('maskIdNumber（前4后4，保长度）', () => {
    it('18 位身份证 → 5110**********123X', () => {
      expect(maskIdNumber('51102319900101123X')).toBe('5110**********123X');
    });
    it('15 位老身份证 → 前4后4', () => {
      expect(maskIdNumber('511023900101123')).toBe('5110*******1123');
    });
    it('过短（≤8）全 *，保长度', () => {
      expect(maskIdNumber('12345678')).toBe('********');
      expect(maskIdNumber('123')).toBe('***');
    });
    it('null/空串原样返回', () => {
      expect(maskIdNumber(null)).toBeNull();
      expect(maskIdNumber('')).toBe('');
    });
  });

  describe('maskPhone（138****5678）', () => {
    it('11 位手机号', () => {
      expect(maskPhone('13812345678')).toBe('138****5678');
    });
    it('座机/短号全 *（保长度，不泄露中段）', () => {
      expect(maskPhone('02886123456')).toBe('028****3456');
    });
    it('null 原样返回', () => {
      expect(maskPhone(null)).toBeNull();
    });
  });

  describe('maskEmail（本地首字符 + *** + 域名保留）', () => {
    it('常规邮箱', () => {
      expect(maskEmail('zhangsan@example.com')).toBe('z***@example.com');
    });
    it('本地部分单字符', () => {
      expect(maskEmail('a@example.com')).toBe('a***@example.com');
    });
    it('无 @ 的值按通用规则回退（前1后1）', () => {
      expect(maskEmail('not-an-email')).toBe('n**********l');
    });
    it('null 原样返回', () => {
      expect(maskEmail(null)).toBeNull();
    });
  });

  describe('maskBankAccount（前4后4，保长度）', () => {
    it('19 位卡号', () => {
      expect(maskBankAccount('6222020200112233445')).toBe('6222***********3445');
    });
    it('null 原样返回', () => {
      expect(maskBankAccount(null)).toBeNull();
    });
  });

  describe('maskLicenseNo（>8 位前4后4，≤8 位全 *）', () => {
    it('执业资格证号（11 字符 → 中段 3 星）', () => {
      expect(maskLicenseNo('川A123456789')).toBe('川A12***6789');
    });
    it('短证号全 *', () => {
      expect(maskLicenseNo('A1234567')).toBe('********');
    });
  });

  describe('maskContact（按字段名路由的统一入口）', () => {
    it('idNumber/idCard/legalPersonIdCard → 身份证规则', () => {
      expect(maskContact('idNumber', '51102319900101123X')).toBe('5110**********123X');
      expect(maskContact('idCard', '51102319900101123X')).toBe('5110**********123X');
      expect(maskContact('legalPersonIdCard', '51102319900101123X')).toBe('5110**********123X');
    });
    it('phone/legalPersonPhone → 手机规则', () => {
      expect(maskContact('phone', '13812345678')).toBe('138****5678');
      expect(maskContact('legalPersonPhone', '13812345678')).toBe('138****5678');
    });
    it('accountNo → 银行规则；licenseNo → 证号规则；email → 邮箱规则', () => {
      expect(maskContact('accountNo', '6222020200112233445')).toBe('6222***********3445');
      expect(maskContact('licenseNo', '川A123456789')).toBe('川A12***6789');
      expect(maskContact('email', 'zhangsan@example.com')).toBe('z***@example.com');
    });
    it('未知字段名原样返回（不误伤非敏感字段）', () => {
      expect(maskContact('employer', '四川省水利院')).toBe('四川省水利院');
    });
  });
});
