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

const dtoPayload = {
  invitationCode: 'ABCDEFGH',
  name: '四川示例水利设备有限公司',
  creditCode: '91510100MA6ABCDEFG',
  legalPerson: '张三',
  legalPersonIdCard: '51010419900101123X',
  displayName: '李四',
  password: 'supplier2026',
  phone: '13800138000',
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
      user: {
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
      },
      $transaction: jest.fn((callback) => callback(tx)),
    };

    const module = await Test.createTestingModule({
      providers: [
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: NotificationService,
          useValue: { sendToRole: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: {} },
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

  it('rejects tags that collapse below two unique values', async () => {
    await expect(service.registerTemporary({
      ...dtoPayload,
      tags: ['水利工程', ' 水利工程 '],
    } as RegisterTemporarySupplierDto)).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
