import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService } from '../company/company-scope';
import { sealPii } from '../common/crypto/sm-field-crypto';

describe('SupplierService.revealField（明文揭示 + 审计）', () => {
  let service: SupplierService;
  let prisma: any;

  beforeAll(() => { process.env.FIELD_ENC_SECRET = 'supplier-reveal-spec-secret'; });
  afterAll(() => { delete process.env.FIELD_ENC_SECRET; });

  beforeEach(async () => {
    prisma = {
      supplier: {
        findUnique: jest.fn().mockResolvedValue({
          id: 's1', companyId: 'co-1', userId: 'u1',
          legalPersonIdCard: sealPii('51102319900101123X'),
          legalPersonPhone: sealPii('13812345678'),
        }),
      },
      supplierContact: {
        findFirst: jest.fn().mockResolvedValue({ id: 'c1', supplierId: 's1', idCard: sealPii('510104199202023456'), phone: sealPii('13900000000'), email: sealPii('lisi@example.com') }),
      },
      supplierBankAccount: {
        findFirst: jest.fn().mockResolvedValue({ id: 'b1', supplierId: 's1', accountNo: sealPii('6222020200112233445') }),
      },
      sensitiveAccessLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), assertInScope: jest.fn() } },
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn().mockResolvedValue({}), sendToUser: jest.fn().mockResolvedValue({}) } },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: {} },
      ],
    }).compile();
    service = module.get(SupplierService);
  });

  const actor = { sub: 'staff-9', role: 'staff', displayName: '经办人乙' };

  it('supplier.legalPersonIdCard：返回明文并写审计', async () => {
    const result = await service.revealField('s1', { entity: 'supplier', field: 'legalPersonIdCard' }, actor as any, '10.1.1.1');
    expect(result).toEqual({ entity: 'supplier', targetId: 's1', field: 'legalPersonIdCard', value: '51102319900101123X' });
    expect(prisma.sensitiveAccessLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorUserId: 'staff-9', entity: 'Supplier', targetId: 's1', field: 'legalPersonIdCard', ip: '10.1.1.1' }),
      }),
    );
  });

  it('contact.idCard：按 targetId 取记录并揭示（归属校验 supplierId）', async () => {
    const result = await service.revealField('s1', { entity: 'contact', targetId: 'c1', field: 'idCard' }, actor as any);
    expect(result.value).toBe('510104199202023456');
    expect(prisma.supplierContact.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1', supplierId: 's1' } }),
    );
  });

  it('bankAccount.accountNo：揭示并写审计', async () => {
    const result = await service.revealField('s1', { entity: 'bankAccount', targetId: 'b1', field: 'accountNo' }, actor as any);
    expect(result.value).toBe('6222020200112233445');
    expect(prisma.sensitiveAccessLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ entity: 'SupplierBankAccount', targetId: 'b1', field: 'accountNo' }) }),
    );
  });

  it('子记录不属于该供应商 → 404（防跨企枚举）', async () => {
    prisma.supplierBankAccount.findFirst.mockResolvedValue(null);
    await expect(
      service.revealField('s1', { entity: 'bankAccount', targetId: 'other-bank', field: 'accountNo' }, actor as any),
    ).rejects.toThrow(NotFoundException);
  });

  it('非法 entity/field 组合 → 400 FIELD_NOT_REVEALABLE', async () => {
    await expect(
      service.revealField('s1', { entity: 'supplier', field: 'passwordHash' }, actor as any),
    ).rejects.toMatchObject({ response: { code: 'FIELD_NOT_REVEALABLE' } });
    await expect(
      service.revealField('s1', { entity: 'unknown', field: 'phone' }, actor as any),
    ).rejects.toMatchObject({ response: { code: 'FIELD_NOT_REVEALABLE' } });
    expect(prisma.sensitiveAccessLog.create).not.toHaveBeenCalled();
  });

  it('非 admin 越权他司供应商 → 公司隔离 403（不揭示不审计）', async () => {
    const { CompanyScopeService: Ctx } = await import('../company/company-scope');
    void Ctx;
    const scopeService = (service as any).companyScope as any;
    scopeService.resolveScope.mockResolvedValue({ all: false, companyId: 'co-other' });
    scopeService.assertInScope.mockImplementation(() => { throw new ForbiddenException(); });
    await expect(
      service.revealField('s1', { entity: 'supplier', field: 'legalPersonIdCard' }, actor as any),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.sensitiveAccessLog.create).not.toHaveBeenCalled();
  });
});
