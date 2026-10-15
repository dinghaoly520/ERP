import { BadRequestException } from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { registrationUploadNamespace } from '../upload/registration-upload';
import { CompanyScopeService } from '../company/company-scope';

describe('SupplierService.register — P1-13 注册手机验证前置', () => {
  let service: SupplierService;
  let prisma: any;
  let verification: any;
  let claimAssets: jest.Mock;

  const validDto: any = {
    name: '测试公司', creditCode: '91510000MA62K5XX0X', enterpriseType: '有限责任公司',
    legalPerson: '张三', legalPersonIdCard: '510104199001011234', registeredAddress: '成都市',
    businessScope: '水利工程', username: 'testuser', displayName: '张三', password: '12345678',
    registrationPhone: '13800138000', registrationCode: '123456', companyName: '测试集团',
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
      company: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({ id: 'c1', name: '测试集团' }) }, // 2026-09-17 归档合并：注册按 companyName upsert 建档
      supplierContact: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'u1' }) },
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
      assertRegistrationSession: jest.fn().mockResolvedValue({ phone: '13800138000' }),
      consumeRegistrationSession: jest.fn().mockResolvedValue({ ok: true }),
    };
    const { Test } = await import('@nestjs/testing');
    const module = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}), assertInScope: jest.fn(), stampFor: jest.fn().mockResolvedValue({}) } },
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

  it('registrationToken 轨（2026-10-09）：会话有效且手机号一致 → 注册成功并消费会话，不再碰短信码', async () => {
    await expect(service.register({ ...validDto, registrationToken: 't'.repeat(64) })).resolves.toBeTruthy();

    expect(verification.assertRegistrationSession).toHaveBeenCalledWith('t'.repeat(64));
    expect(verification.consumeRegistrationSession).toHaveBeenCalledTimes(1);
    expect(verification.verifyRegistrationCode).not.toHaveBeenCalled();
    expect(verification.assertRegistrationCodeForUpload).not.toHaveBeenCalled();
  });

  it('registrationToken 轨：会话手机号与注册手机号不一致 → 400 REGISTRATION_PHONE_SESSION_MISMATCH（零创建）', async () => {
    verification.assertRegistrationSession.mockResolvedValue({ phone: '13999999999' });

    await expect(service.register({ ...validDto, registrationToken: 't'.repeat(64) }))
      .rejects.toMatchObject({ response: { code: 'REGISTRATION_PHONE_SESSION_MISMATCH' } });

    expect(verification.consumeRegistrationSession).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
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

  describe('register — REJECTED 壳重开（2026-10-14）', () => {
    // F4：壳分支事务内先乐观锁认领（REJECTED→PENDING）——tx.supplier 需挂 updateMany
    const shellReopenTx = (txUpdate: jest.Mock, claim: jest.Mock = jest.fn().mockResolvedValue({ count: 1 })) =>
      jest.fn(async (fn: any) => fn({
        ...prisma,
        $queryRaw: jest.fn().mockResolvedValue([{ max: 1 }]),
        supplier: { ...prisma.supplier, update: txUpdate, create: jest.fn(), updateMany: claim },
        supplierContact: { deleteMany: jest.fn().mockResolvedValue({}) },
        supplierQualification: { deleteMany: jest.fn().mockResolvedValue({}) },
        supplierBankAccount: { deleteMany: jest.fn().mockResolvedValue({}) },
        supplierPerformance: { deleteMany: jest.fn().mockResolvedValue({}) },
        user: { ...prisma.user, update: jest.fn().mockResolvedValue({ id: 'u1' }) },
        fileAsset: { updateMany: claimAssets },
      }));

    it('信用代码命中 REJECTED 壳 → 复用原行 update（不抛 DUPLICATE_CREDIT_CODE）', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', status: 'REJECTED', supplierNo: 'SUP-000001' });
      // tx 内 update 需要返回含子表的 supplier
      const txUpdate = jest.fn().mockResolvedValue({ id: 's1', userId: 'u1', contacts: [], qualifications: [], bankAccounts: [], performances: [] });
      prisma.$transaction = shellReopenTx(txUpdate);
      await expect(service.register({ ...validDto })).resolves.toBeTruthy();
      expect(txUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({ status: 'PENDING', reviewStage: 'STAFF', rejectReason: null }),
      }));
    });

    it('信用代码命中非 REJECTED（PENDING）→ 仍硬拦截 DUPLICATE_CREDIT_CODE', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', status: 'PENDING', supplierNo: 'SUP-000001' });
      await expect(service.register({ ...validDto }))
        .rejects.toMatchObject({ response: { code: 'DUPLICATE_CREDIT_CODE' } });
    });

    it('壳重开：壳自身残存 User 行持有同用户名 → 放行复用（不抛 DUPLICATE_USERNAME）', async () => {
      // 驳回清洗（purgeRejectedSupplier）保留 username/role，壳的 User 行仍持有同用户名 → username 查重命中壳自身须放行
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', status: 'REJECTED', supplierNo: 'SUP-000001' });
      // user.findFirst 同被 username 查重与 DUPLICATE_PHONE 查重复用——按 where.phoneIdx 区分：手机号查重不命中
      prisma.user.findFirst.mockImplementation(async ({ where }: any) =>
        where?.phoneIdx !== undefined ? null : { id: 'u1', username: '91510000MA62K5XX0X', role: 'supplier' });
      const txUpdate = jest.fn().mockResolvedValue({ id: 's1', userId: 'u1', contacts: [], qualifications: [], bankAccounts: [], performances: [] });
      prisma.$transaction = shellReopenTx(txUpdate);
      await expect(service.register({ ...validDto })).resolves.toBeTruthy();
      expect(txUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({ status: 'PENDING', reviewStage: 'STAFF', rejectReason: null }),
      }));
    });

    it('壳重开（F1 存量兜底）：壳残存法人证/手机号/联系人证盲索引命中壳自身 → 三查重 NOT 自排除后放行', async () => {
      // 存量 REJECTED 壳（驳回清洗功能上线前被驳回、数据未清洗）：legalPersonIdCardIdx/User.phoneIdx/
      // 联系人 idCardIdx 均残存旧值——三查重都会命中壳自身，须 NOT 自排除后放行重开。
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', status: 'REJECTED', supplierNo: 'SUP-000001' });
      // 法人证查重：命中壳自身行；mock 按 NOT 语义——where 排除壳自身后返回 null
      prisma.supplier.findFirst.mockImplementation(async ({ where }: any) => {
        if (where?.legalPersonIdCardIdx === undefined) return null;
        return where.NOT?.id === 's1' ? null : { id: 's1' };
      });
      // user.findFirst：username 查重返壳自身 User（放行）；手机号查重命中壳自身 → NOT 排除后 null
      prisma.user.findFirst.mockImplementation(async ({ where }: any) => {
        if (where?.phoneIdx === undefined) return { id: 'u1', username: '91510000MA62K5XX0X', role: 'supplier' };
        return where.NOT?.id === 'u1' ? null : { id: 'u1' };
      });
      // 联系人证查重：命中壳自身联系人行 → NOT 排除 supplierId 后 null
      prisma.supplierContact.findFirst.mockImplementation(async ({ where }: any) =>
        where.NOT?.supplierId === 's1' ? null : { id: 'c1', supplierId: 's1' });
      const txUpdate = jest.fn().mockResolvedValue({ id: 's1', userId: 'u1', contacts: [], qualifications: [], bankAccounts: [], performances: [] });
      prisma.$transaction = shellReopenTx(txUpdate);

      await expect(service.register({ ...validDto })).resolves.toBeTruthy();

      // 三查重 where 均带壳自排除
      expect(prisma.supplier.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ NOT: { id: 's1' } }),
      }));
      expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ NOT: { id: 'u1' } }),
      }));
      expect(prisma.supplierContact.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ NOT: { supplierId: 's1' } }),
      }));
      expect(txUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({ status: 'PENDING', reviewStage: 'STAFF' }),
      }));
    });

    it('壳重开（F4 TOCTOU）：并发流转（认领 updateMany count=0）→ 400 CONFLICT，零写入', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', status: 'REJECTED', supplierNo: 'SUP-000001' });
      const txUpdate = jest.fn().mockResolvedValue({});
      const txUserUpdate = jest.fn().mockResolvedValue({ id: 'u1' });
      prisma.$transaction = jest.fn(async (fn: any) => fn({
        ...prisma,
        $queryRaw: jest.fn().mockResolvedValue([{ max: 1 }]),
        supplier: { ...prisma.supplier, update: txUpdate, create: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        supplierContact: { deleteMany: jest.fn().mockResolvedValue({}) },
        supplierQualification: { deleteMany: jest.fn().mockResolvedValue({}) },
        supplierBankAccount: { deleteMany: jest.fn().mockResolvedValue({}) },
        supplierPerformance: { deleteMany: jest.fn().mockResolvedValue({}) },
        user: { ...prisma.user, update: txUserUpdate },
        fileAsset: { updateMany: claimAssets },
      }));

      await expect(service.register({ ...validDto }))
        .rejects.toMatchObject({ response: { code: 'CONFLICT' } });

      // 认领即抛（事务中止）：User 覆写/子表重建/壳主档 update 均未发生
      expect(txUserUpdate).not.toHaveBeenCalled();
      expect(txUpdate).not.toHaveBeenCalled();
    });

    it('壳重开：同用户名被其他账号占用（非壳自身 User）→ 仍硬拦截 DUPLICATE_USERNAME', async () => {
      prisma.supplier.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', status: 'REJECTED', supplierNo: 'SUP-000001' });
      prisma.user.findFirst.mockResolvedValue({ id: 'u-other', username: '91510000MA62K5XX0X', role: 'supplier' });
      await expect(service.register({ ...validDto }))
        .rejects.toMatchObject({ response: { code: 'DUPLICATE_USERNAME' } });
    });
  });

  describe('checkDuplicate — 信用代码状态感知', () => {
    it('信用代码命中 REJECTED → creditCode=true 且 creditCodeStatus=REJECTED（可重注册）', async () => {
      prisma.supplier.findFirst.mockResolvedValue({ id: 's-rej', status: 'REJECTED' });
      const res = await service.checkDuplicate({ creditCode: '91510000MA62K5XX0X' });
      expect(res.creditCode).toBe(true);
      expect(res.creditCodeStatus).toBe('REJECTED');
    });

    it('信用代码命中 PENDING → creditCodeStatus=PENDING', async () => {
      prisma.supplier.findFirst.mockResolvedValue({ id: 's-pen', status: 'PENDING' });
      const res = await service.checkDuplicate({ creditCode: '91510000MA62K5XX0X' });
      expect(res.creditCodeStatus).toBe('PENDING');
    });

    it('信用代码未命中 → creditCode=false 且 creditCodeStatus=null', async () => {
      prisma.supplier.findFirst.mockResolvedValue(null);
      const res = await service.checkDuplicate({ creditCode: '91510000MA62K5XX0X' });
      expect(res.creditCode).toBe(false);
      expect(res.creditCodeStatus).toBeNull();
    });
  });
});
