import { BadRequestException } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { registrationUploadNamespace } from '../upload/registration-upload';

describe('SupplierService.register — P1-13 注册手机验证前置', () => {
  let service: SupplierService;
  let prisma: any;
  let verification: any;
  let claimAssets: jest.Mock;

  const validDto: any = {
    name: '测试公司', creditCode: '91510000MA62K5XX0X', enterpriseType: '有限责任公司',
    legalPerson: '张三', legalPersonIdCard: '510104199001011234', registeredAddress: '成都市',
    businessScope: '水利工程', username: 'testuser', displayName: '张三', password: '12345678',
    registrationPhone: '13800138000', registrationCode: '123456',
    contacts: [{
      name: '李四', phone: '13800138000', idCard: '510104199202023456', isPrimary: true,
    }],
    qualifications: [{
      type: '营业执照', name: '企业法人营业执照', fileUrl: '/api/upload/files/license-asset',
    }],
    bankAccounts: [], tags: [],
  };

  beforeEach(async () => {
    claimAssets = jest.fn().mockResolvedValue({ count: 1 });
    prisma = {
      supplier: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 's1', userId: 'u1' }) },
      supplierContact: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'u1' }) },
      businessTag: {
        upsert: jest.fn().mockImplementation(({ create }: any) => Promise.resolve({ id: 'tag-1', ...create })),
      },
      fileAsset: { findMany: jest.fn().mockResolvedValue([{ id: 'license-asset', category: 'qualification' }]) },
      $transaction: jest.fn(async (fn: any) => fn({
        ...prisma,
        $queryRaw: jest.fn().mockResolvedValue([{ max: 1 }]),
        user: { ...prisma.user, update: jest.fn().mockResolvedValue({}) },
        fileAsset: { updateMany: claimAssets },
      })),
    };
    verification = {
      assertRegistrationCodeForUpload: jest.fn().mockResolvedValue({ ok: true }),
      verifyRegistrationCode: jest.fn().mockResolvedValue({ ok: true }),
    };
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

  it('自创业务标签通过 upsert 入池，避免并发唯一键冲突', async () => {
    await service.register({ ...validDto, tags: ['水利工程', '泵站设备'] });

    expect(prisma.businessTag.upsert).toHaveBeenCalledWith({
      where: { name: '水利工程' },
      create: {
        name: '水利工程',
        status: 'PENDING',
        source: 'supplier_register',
        createdBySupplierId: 's1',
      },
      update: {},
    });
  });

  it('只认领当前验证手机号命名空间中的匿名注册资产', async () => {
    prisma.fileAsset.findMany.mockResolvedValue([{ id: 'asset-1', category: 'qualification' }]);
    const dto = {
      ...validDto,
      qualifications: [{ type: '营业执照', name: '营业执照', fileUrl: '/api/upload/files/asset-1' }],
    };

    await service.register(dto);

    expect(prisma.fileAsset.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['asset-1'] },
        uploaderId: null,
        category: { in: ['qualification', 'general'] },
        key: { startsWith: `${registrationUploadNamespace('13800138000')}/` },
      },
      select: { id: true, category: true },
    });
    expect(claimAssets).toHaveBeenCalledWith({
      where: { id: { in: ['asset-1'] }, uploaderId: null },
      data: { uploaderId: 'u1' },
    });
  });

  it('拒绝营业执照使用任意外部或伪造 URL', async () => {
    await expect(service.register({
      ...validDto,
      qualifications: [{ type: '营业执照', name: '营业执照', fileUrl: 'https://evil.example/license.pdf' }],
    })).rejects.toMatchObject({ response: { code: 'REGISTRATION_ASSET_URL_INVALID' } });

    expect(verification.verifyRegistrationCode).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('拒绝任意附加材料 URL，即使营业执照主文件真实存在', async () => {
    await expect(service.register({
      ...validDto,
      qualifications: [{
        ...validDto.qualifications[0],
        attachments: [{ name: '伪造附件', url: '/public/forged.pdf' }],
      }],
    })).rejects.toMatchObject({ response: { code: 'REGISTRATION_ASSET_URL_INVALID' } });

    expect(verification.verifyRegistrationCode).not.toHaveBeenCalled();
  });

  it('营业执照必须引用 qualification 分类的真实注册资产', async () => {
    prisma.fileAsset.findMany.mockResolvedValue([{ id: 'license-asset', category: 'general' }]);

    await expect(service.register(validDto))
      .rejects.toMatchObject({ response: { code: 'REGISTRATION_ASSET_INVALID' } });

    expect(verification.verifyRegistrationCode).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('拒绝未提交真实营业执照注册资产的正式注册', async () => {
    await expect(service.register({ ...validDto, qualifications: [] }))
      .rejects.toMatchObject({ response: { code: 'REGISTRATION_LICENSE_REQUIRED' } });

    expect(verification.verifyRegistrationCode).not.toHaveBeenCalled();
    expect(prisma.fileAsset.findMany).not.toHaveBeenCalled();
  });

  it('拒绝没有主要联系人的正式注册', async () => {
    await expect(service.register({ ...validDto, contacts: [] }))
      .rejects.toMatchObject({ response: { code: 'REGISTRATION_PRIMARY_CONTACT_REQUIRED' } });

    expect(verification.verifyRegistrationCode).not.toHaveBeenCalled();
  });

  it('拒绝主要联系人手机号与验证码手机号不一致', async () => {
    await expect(service.register({
      ...validDto,
      contacts: [{ ...validDto.contacts[0], phone: '13900139000' }],
    })).rejects.toMatchObject({ response: { code: 'REGISTRATION_PHONE_CONTACT_MISMATCH' } });

    expect(verification.verifyRegistrationCode).not.toHaveBeenCalled();
  });
});
