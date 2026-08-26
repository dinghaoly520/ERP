import { BadRequestException } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';

describe('SupplierService.register — P1-13 注册手机验证前置', () => {
  let service: SupplierService;
  let prisma: any;
  let verification: any;

  const validDto: any = {
    name: '测试公司', creditCode: '91510000MA62K5XX0X', enterpriseType: '有限责任公司',
    legalPerson: '张三', legalPersonIdCard: '510104199001011234', registeredAddress: '成都市',
    businessScope: '水利工程', username: 'testuser', displayName: '张三', password: '12345678',
    registrationPhone: '13800138000', registrationCode: '123456', contacts: [], qualifications: [], bankAccounts: [], tags: [],
  };

  beforeEach(async () => {
    prisma = {
      supplier: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 's1', userId: 'u1' }) },
      user: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'u1' }) },
      $transaction: jest.fn(async (fn: any) => fn({
        ...prisma,
        $queryRaw: jest.fn().mockResolvedValue([{ max: 1 }]),
        user: { ...prisma.user, update: jest.fn().mockResolvedValue({}) },
      })),
    };
    verification = { verifyRegistrationCode: jest.fn().mockResolvedValue({ ok: true }) };
    const { Test } = await import('@nestjs/testing');
    const module = await Test.createTestingModule({
      providers: [
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { sendToRole: jest.fn().mockResolvedValue({}), sendToUser: jest.fn().mockResolvedValue({}) } },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: verification },
      ],
    }).compile();
    service = module.get(SupplierService);
  });

  it('验证码校验失败 → 400 且零创建（register 不执行）', async () => {
    verification.verifyRegistrationCode.mockRejectedValue(
      new BadRequestException({ code: 'CODE_INVALID', error: '验证码错误' }),
    );
    await expect(service.register(validDto)).rejects.toMatchObject({ response: { code: 'CODE_INVALID' } });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.supplier.create).not.toHaveBeenCalled();
  });

  it('验证码校验通过（phone+code 透传）→ 注册继续', async () => {
    prisma.supplier.create.mockResolvedValue({ id: 's1', userId: 'u1' });
    await expect(service.register(validDto)).resolves.toBeTruthy();
    expect(verification.verifyRegistrationCode).toHaveBeenCalledWith('13800138000', '123456');
  });
});
