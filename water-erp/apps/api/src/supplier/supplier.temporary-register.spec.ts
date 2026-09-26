import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LlmService } from '../local-ai/llm.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationService } from '../verification/verification.service';
import { RegisterTemporarySupplierDto } from './dto/register-temporary-supplier.dto';
import { SupplierService } from './supplier.service';
import { CompanyScopeService } from '../company/company-scope';

const dtoPayload = {
  invitationCode: 'ABCDEFGH',
  name: '四川示例水利设备有限公司',
  creditCode: '91510100MA6ABCDEFG',
  legalPerson: '张三',
  legalPersonIdCard: '51010419900101123X',
  displayName: '李四',
  password: 'supplier2026',
  phone: '13800138000',
  registrationCode: '123456',
  companyName: '四川水发集团',
  tags: ['水利工程', '泵站设备'],
};

describe('RegisterTemporarySupplierDto business tags', () => {
  it.each([
    [undefined, true],
    [[], true],
    [['水利工程'], true],
    [Array.from({ length: 9 }, (_, i) => `标签${i}`), true],
    [['水利工程', '超'.repeat(21)], true],
    [['水利工程', '泵站设备'], false],
  ])('validates %p', async (tags, shouldFail) => {
    const dto = plainToInstance(RegisterTemporarySupplierDto, { ...dtoPayload, tags });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'tags')).toBe(shouldFail);
  });
});

describe('SupplierService.registerTemporary business tags', () => {
  let service: SupplierService;
  let prisma: any;
  let tx: any;

  beforeEach(async () => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ supplier_no: 'SUP-000001' }]),
      user: { findMany: jest.fn().mockResolvedValue([]), 
        create: jest.fn().mockResolvedValue({
          id: 'user-1',
          username: dtoPayload.creditCode,
          passwordHash: 'hash',
        }),
      },
      supplier: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({
          id: 'supplier-1',
          name: data.name,
          creditCode: data.creditCode,
          tags: data.tags,
        })),
      },
      supplierInvitation: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      businessTag: {
        upsert: jest.fn().mockImplementation(({ where, create }) => Promise.resolve(
          where.name === '水利工程'
            ? { id: 'tag-1', name: where.name, source: 'seed', createdBySupplierId: null }
            : { id: 'tag-2', ...create },
        )),
      },
    };
    prisma = {
      company: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({ id: 'c1', name: '四川水发集团' }) }, // 2026-09-17 归档合并：resolveSupplierCompany 按 companyName upsert 建档
      supplierInvitation: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUnique: jest.fn().mockResolvedValue({
          id: 'invite-1',
          code: 'ABCDEFGH',
          status: 'ACTIVE',
          validityDays: 30,
          expiresAt: new Date('2099-01-01T00:00:00.000Z'),
          boundCreditCode: null,
        }),
      },
      supplier: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]), // 2026-09-26 公司审批人解析（resolveCompanyApprovers → admin 回退）
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };

    const module = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}), assertInScope: jest.fn(), stampFor: jest.fn().mockResolvedValue({}) } },
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: NotificationService,
          useValue: { sendToRole: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: { verifyRegistrationCode: jest.fn().mockResolvedValue({ ok: true }) } },
      ],
    }).compile();

    service = module.get(SupplierService);
  });

  it('normalizes and persists custom tags in the invitation transaction', async () => {
    await service.registerTemporary({
      ...dtoPayload,
      tags: [' 水利工程 ', '泵站设备', '水利工程'],
    } as RegisterTemporarySupplierDto);

    expect(tx.supplier.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tags: ['水利工程', '泵站设备'] }),
    }));
    expect(tx.businessTag.upsert).toHaveBeenCalledWith({
      where: { name: '泵站设备' },
      create: {
        name: '泵站设备',
        status: 'PENDING',
        source: 'supplier_register',
        createdBySupplierId: 'supplier-1',
      },
      update: {},
    });
  });

  it('requires companyId at the DTO level (归属公司必选)', async () => {
    const errors = await validate(plainToInstance(RegisterTemporarySupplierDto, dtoPayload));
    expect(errors.some((error) => error.property === 'companyId')).toBe(true);
  });

  it('rejects unknown company id with COMPANY_NOT_FOUND (须正确选择)', async () => {
    // 2026-09-17 语义：companyId 失效时回退 companyName 归一化建档——负例须两者皆缺才拒
    prisma.company = { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() };
    const { companyName, ...noName } = dtoPayload;
    await expect(service.registerTemporary({
      ...noName,
      companyId: 'FAKE-ID',
    } as RegisterTemporarySupplierDto)).rejects.toMatchObject({
      response: { code: 'COMPANY_NOT_FOUND' },
    });
  });

  it('rejects tags that collapse below two unique values', async () => {
    await expect(service.registerTemporary({
      ...dtoPayload,
      tags: ['水利工程', ' 水利工程 '],
    } as RegisterTemporarySupplierDto)).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
