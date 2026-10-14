import { BadRequestException } from '@nestjs/common';
import { assertContactPhonesUnique, assertContactsArrayPhonesUnique } from './contact-phone-unique';

/** 联系人手机号唯一性（2026-10-14）：主联系人全局唯一 + 额外联系人供应商内唯一 */
describe('contact-phone-unique', () => {
  const prisma = (over: { user?: any; supplierContact?: any } = {}) => ({
    user: { findFirst: jest.fn().mockResolvedValue(null) },
    supplierContact: { findFirst: jest.fn().mockResolvedValue(null) },
    ...over,
  });

  describe('assertContactsArrayPhonesUnique（注册数组内去重）', () => {
    it('数组内手机号重复 → DUPLICATE_CONTACT_PHONE', () => {
      expect(() => assertContactsArrayPhonesUnique([
        { phone: '13800138000', isPrimary: true },
        { phone: '13800138000', isPrimary: false },
      ])).toThrow(BadRequestException);
    });

    it('主/额外联系人手机号互不相同 → 放行', () => {
      expect(() => assertContactsArrayPhonesUnique([
        { phone: '13800138000', isPrimary: true },
        { phone: '13900139000', isPrimary: false },
      ])).not.toThrow();
    });
  });

  describe('assertContactPhonesUnique（supplier 已存在 DB 查重）', () => {
    it('主联系人 phone 命中其他供应商账号 → DUPLICATE_CONTACT_PHONE', async () => {
      const p = prisma({ user: { findFirst: jest.fn().mockResolvedValue({ id: 'u2', supplier: { id: 's-other' } }) } });
      await expect(assertContactPhonesUnique(p, {
        supplierId: 's1',
        contacts: [{ phone: '13800138000', isPrimary: true }],
      })).rejects.toMatchObject({ response: { code: 'DUPLICATE_CONTACT_PHONE' } });
    });

    it('主联系人 phone 命中其他供应商主联系人 → DUPLICATE_CONTACT_PHONE', async () => {
      const p = prisma({ supplierContact: { findFirst: jest.fn().mockResolvedValue({ id: 'c-other' }) } });
      await expect(assertContactPhonesUnique(p, {
        supplierId: 's1',
        contacts: [{ phone: '13800138000', isPrimary: true }],
      })).rejects.toMatchObject({ response: { code: 'DUPLICATE_CONTACT_PHONE' } });
    });

    it('主联系人 phone = 自己账号（supplier.id 相同）→ 放行', async () => {
      const p = prisma({ user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1', supplier: { id: 's1' } }) } });
      await expect(assertContactPhonesUnique(p, {
        supplierId: 's1',
        contacts: [{ phone: '13800138000', isPrimary: true }],
      })).resolves.toBeUndefined();
    });

    it('额外联系人 phone 同供应商重复 → DUPLICATE_CONTACT_PHONE', async () => {
      const p = prisma({ supplierContact: { findFirst: jest.fn().mockResolvedValue({ id: 'c-dup' }) } });
      await expect(assertContactPhonesUnique(p, {
        supplierId: 's1',
        contacts: [{ phone: '13800138000', isPrimary: false }],
      })).rejects.toMatchObject({ response: { code: 'DUPLICATE_CONTACT_PHONE' } });
    });

    it('额外联系人排除自身 contactId → 放行（findFirst 收到排除条件）', async () => {
      const findFirst = jest.fn().mockResolvedValue(null); // 排除自己后无其他重复
      const p = prisma({ supplierContact: { findFirst } });
      await expect(assertContactPhonesUnique(p, {
        supplierId: 's1',
        contacts: [{ phone: '13800138000', isPrimary: false }],
        excludeContactId: 'c-self',
      })).resolves.toBeUndefined();
      expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ NOT: { id: 'c-self' } }),
      }));
    });
  });
});
