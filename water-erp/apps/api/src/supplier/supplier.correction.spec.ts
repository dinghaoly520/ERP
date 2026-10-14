import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService } from '../company/company-scope';
import { sealPii, blindIndexPii } from '../common/crypto/sm-field-crypto';

// PII 是真实国密函数（dev 有固定回退钥）——测试内用真实 sealPii 构造密封值，
// openPii 才能往返解封（伪造密文会在 openFieldSm 抛错）。
const PHONE = '13800138000';
const SEALED_PHONE = sealPii(PHONE) as string;

const returnedSupplier = {
  id: 's1',
  userId: 'u1',
  name: '测试公司',
  creditCode: '91510000MA62K5XX0X',
  status: 'RETURNED',
  returnReason: '营业执照模糊，请补传',
  reviewStage: 'STAFF',
  companyId: 'c1',
  contacts: [{ phone: SEALED_PHONE, isPrimary: true }],
};

const fullSupplier = {
  ...returnedSupplier,
  enterpriseType: '有限责任公司',
  legalPerson: '张三',
  legalPersonIdCard: sealPii('510104199001011234'),
  legalPersonPhone: sealPii('13912345678'),
  registeredAddress: '成都市',
  detailedAddress: '高新区',
  businessScope: '水利工程',
  logoUrl: null,
  country: null,
  region: '四川',
  registeredCapital: '1000万',
  industry: '水利',
  establishedDate: new Date('2020-01-01T00:00:00Z'),
  companyProfile: '简介',
  companyEmail: 'test@example.com',
  companyWebsite: null,
  companyId: 'c1',
  companyName: '测试集团',
  tags: ['水利工程'],
  contacts: [{
    name: '李四', gender: '男', phone: SEALED_PHONE,
    idCard: sealPii('510104199202023456'), email: null, position: '经理', isPrimary: true,
  }],
  qualifications: [{
    type: '营业执照', name: '营业执照', fileUrl: '/api/upload/files/asset-1',
    attachments: [], validFrom: null, validTo: null,
  }],
  bankAccounts: [{
    accountName: '测试公司', bankName: '工商银行', bankBranch: null,
    accountNo: sealPii('6222021234567890'), isDefault: true,
  }],
  performances: [{
    projectName: '某水库工程', clientName: null, contractAmount: null,
    signDate: null, description: null, proofFiles: [],
  }],
};

const submitDto: any = {
  token: 'corr-token-1',
  name: '测试公司',
  creditCode: '91510000MA62K5XX0X',
  enterpriseType: '有限责任公司',
  legalPerson: '张三',
  legalPersonIdCard: '510104199001011234',
  legalPersonPhone: '13912345678',
  registeredAddress: '成都市新都区',
  businessScope: '水利工程',
  detailedAddress: '高新区天府大道 1 号',
  companyName: '测试集团',
  contacts: [{
    name: '李四', gender: '男', phone: PHONE, idCard: '510104199202023456', isPrimary: true, position: '经理',
  }],
  qualifications: [{ type: '营业执照', name: '营业执照', fileUrl: '/api/upload/files/asset-1' }],
  bankAccounts: [],
  performances: [],
  tags: ['水利工程', '建筑安装'],
};

describe('SupplierService 补正回填（request/verify/draft/submit）', () => {
  let service: SupplierService;
  let prisma: any;
  let verification: any;
  let notification: any;
  let txSupplierUpdate: jest.Mock;
  let txContactDeleteMany: jest.Mock;
  let txFileAssetClaim: jest.Mock;

  beforeEach(async () => {
    // 内存「表」：findReturnedSupplier 按 name+creditCode+status=RETURNED 精确匹配
    const dbSuppliers: any[] = [returnedSupplier];
    txSupplierUpdate = jest.fn().mockResolvedValue({});
    txContactDeleteMany = jest.fn().mockResolvedValue({});
    txFileAssetClaim = jest.fn().mockResolvedValue({ count: 1 });

    prisma = {
      supplier: {
        findFirst: jest.fn(async ({ where }: any) =>
          dbSuppliers.find((s) => s.name === where.name && s.creditCode === where.creditCode && s.status === where.status) ?? null),
        findUnique: jest.fn(async ({ where }: any) => (where.id === fullSupplier.id ? fullSupplier : null)),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
      },
      company: {
        findUnique: jest.fn().mockResolvedValue({ id: 'c1', name: '测试集团' }),
        upsert: jest.fn().mockResolvedValue({ id: 'c1', name: '测试集团' }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([{ id: 'staff-1' }]),
      },
      supplierContact: { findFirst: jest.fn().mockResolvedValue(null) },
      fileAsset: {
        // collectCorrectionAssetIds（uploaderId=null 待 claim）与 deleteStaleCorrectionAssets（按 userId 查旧附件）两次调用分流
        findMany: jest.fn(async ({ where }: any) => (where?.uploaderId === null ? [{ id: 'asset-1' }] : [])),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (fn: any) => fn({
        supplierContact: { deleteMany: txContactDeleteMany },
        supplierQualification: { deleteMany: jest.fn().mockResolvedValue({}) },
        supplierBankAccount: { deleteMany: jest.fn().mockResolvedValue({}) },
        supplierPerformance: { deleteMany: jest.fn().mockResolvedValue({}) },
        supplier: { update: txSupplierUpdate },
        fileAsset: { updateMany: txFileAssetClaim },
      })),
    };
    verification = {
      sendRegistrationCode: jest.fn().mockResolvedValue({ maskedPhone: '138****8000' }),
      verifyAndStartRegistrationSession: jest.fn().mockResolvedValue({ token: 'corr-token-1', expiresIn: 1800 }),
      assertRegistrationSession: jest.fn().mockResolvedValue({ phone: PHONE }),
      consumeRegistrationSession: jest.fn().mockResolvedValue({ ok: true }),
    };
    notification = {
      create: jest.fn().mockResolvedValue({}),
      sendToRole: jest.fn(),
      sendToUser: jest.fn(),
      resolveActionable: jest.fn().mockResolvedValue({}),
    };
    const { Test } = await import('@nestjs/testing');
    const module = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}), assertInScope: jest.fn(), stampFor: jest.fn().mockResolvedValue({}) } },
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notification },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: verification },
      ],
    }).compile();
    service = module.get(SupplierService);
  });

  // ── requestCorrection ──

  it('request：命中 RETURNED → 向主联系人手机发码并回掩码', async () => {
    const res = await service.requestCorrection('测试公司', '91510000MA62K5XX0X', '1.2.3.4');

    expect(verification.sendRegistrationCode).toHaveBeenCalledWith(PHONE, '1.2.3.4', 'supplier_registration');
    expect(res).toEqual({ maskedPhone: '138****8000' });
  });

  it('request：未命中 → 同形响应 maskedPhone=null，不发码（防枚举）', async () => {
    const res = await service.requestCorrection('不存在的公司', '91510000MA62K5XX0X', '1.2.3.4');

    expect(res).toEqual({ maskedPhone: null });
    expect(verification.sendRegistrationCode).not.toHaveBeenCalled();
  });

  it('request：命中但无主联系人（contacts 空）→ maskedPhone=null，不发码', async () => {
    prisma.supplier.findFirst.mockResolvedValueOnce({ ...returnedSupplier, contacts: [] });

    const res = await service.requestCorrection('测试公司', '91510000MA62K5XX0X', '1.2.3.4');

    expect(res).toEqual({ maskedPhone: null });
    expect(verification.sendRegistrationCode).not.toHaveBeenCalled();
  });

  // ── verifyCorrection ──

  it('verify：校验码通过 → 返回一次性补正 token（验证码发到主联系人手机）', async () => {
    const res = await service.verifyCorrection('测试公司', '91510000MA62K5XX0X', '123456');

    expect(verification.verifyAndStartRegistrationSession).toHaveBeenCalledWith(PHONE, '123456');
    expect(res).toEqual({ correctionToken: 'corr-token-1', expiresIn: 1800 });
  });

  it('verify：未找到 RETURNED 申请 → 400 CORRECTION_NOT_FOUND', async () => {
    await expect(service.verifyCorrection('不存在的公司', '91510000MA62K5XX0X', '123456'))
      .rejects.toMatchObject({ response: { code: 'CORRECTION_NOT_FOUND' } });
    expect(verification.verifyAndStartRegistrationSession).not.toHaveBeenCalled();
  });

  // ── getCorrectionDraft ──

  it('draft：token 手机==主联系人手机 → 返回解封字段 + 退回原因/当前级', async () => {
    const draft = await service.getCorrectionDraft('corr-token-1', '测试公司', '91510000MA62K5XX0X');

    expect(verification.assertRegistrationSession).toHaveBeenCalledWith('corr-token-1');
    expect(draft.name).toBe('测试公司');
    expect(draft.creditCode).toBe('91510000MA62K5XX0X');
    // PII 解封（真实国密往返）
    expect(draft.legalPersonIdCard).toBe('510104199001011234');
    expect(draft.legalPersonPhone).toBe('13912345678');
    expect(draft.contacts[0].phone).toBe(PHONE);
    expect(draft.contacts[0].idCard).toBe('510104199202023456');
    expect(draft.bankAccounts[0].accountNo).toBe('6222021234567890');
    expect(draft.establishedDate).toBe('2020-01-01');
    expect(draft.qualifications[0]).toMatchObject({ type: '营业执照', fileUrl: '/api/upload/files/asset-1' });
    expect(draft.returnReason).toBe('营业执照模糊，请补传');
    expect(draft.reviewStage).toBe('STAFF');
  });

  it('draft：token 手机与主联系人手机不一致 → 400 CORRECTION_PHONE_MISMATCH', async () => {
    verification.assertRegistrationSession.mockResolvedValue({ phone: '13999999999' });

    await expect(service.getCorrectionDraft('corr-token-1', '测试公司', '91510000MA62K5XX0X'))
      .rejects.toMatchObject({ response: { code: 'CORRECTION_PHONE_MISMATCH' } });
    expect(prisma.supplier.findUnique).not.toHaveBeenCalled();
  });

  it('draft：未找到 RETURNED 申请 → 400 CORRECTION_NOT_FOUND', async () => {
    await expect(service.getCorrectionDraft('corr-token-1', '不存在的公司', '91510000MA62K5XX0X'))
      .rejects.toMatchObject({ response: { code: 'CORRECTION_NOT_FOUND' } });
  });

  // ── submitCorrection ──

  it('submit：happy path——乐观锁认领 RETURNED→PENDING、子表重建（含 phoneIdx）、消费会话、通知+审计', async () => {
    const res = await service.submitCorrection(submitDto);

    expect(res).toEqual({ success: true });

    // 乐观锁：仅 RETURNED 可补正，认领即置 PENDING（reviewStage 保留回到退回级）
    expect(prisma.supplier.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 's1', status: 'RETURNED' },
      data: expect.objectContaining({ status: 'PENDING', legalPersonIdCardIdx: blindIndexPii('510104199001011234') }),
    }));

    // 一次性补正 token 消费
    expect(verification.consumeRegistrationSession).toHaveBeenCalledWith('corr-token-1');

    // 子表删旧重建；联系人写密封 phone + phoneIdx 盲索引（2026-10-14 唯一性口径）
    expect(txContactDeleteMany).toHaveBeenCalledWith({ where: { supplierId: 's1' } });
    const contactsCreate = txSupplierUpdate.mock.calls[0][0].data.contacts.create;
    expect(contactsCreate[0]).toMatchObject({
      name: '李四',
      phoneIdx: blindIndexPii(PHONE),
      idCardIdx: blindIndexPii('510104199202023456'),
      isPrimary: true,
    });
    expect(String(contactsCreate[0].phone).startsWith('sm1:')).toBe(true); // 密封落库，非明文

    // 新附件 claim 到该申请 user
    expect(txFileAssetClaim).toHaveBeenCalledWith({
      where: { id: { in: ['asset-1'] }, uploaderId: null },
      data: { uploaderId: 'u1' },
    });

    // 回到退回级（STAFF）审批人收待办 + 审计留痕
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ userId: 'u1', action: 'SUPPLIER_RESUBMITTED', resourceId: 's1' }),
    }));
  });

  it('submit：通知发往退回级审批人（STAFF 级待办，link 带供应商 id）', async () => {
    await service.submitCorrection(submitDto);

    expect(notification.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'staff-1',
      type: 'SUPPLIER_PENDING',
      link: '/supplier/approval?supplierId=s1',
    }));
  });

  it('submit：非 RETURNED（如同名同码 PENDING）→ 400 CORRECTION_NOT_FOUND，零写入', async () => {
    // 库里只有一条同名同码但状态 PENDING 的记录——findReturnedSupplier 的 status=RETURNED 过滤不命中
    prisma.supplier.findFirst.mockImplementation(async ({ where }: any) =>
      where.status === 'RETURNED' ? null : { id: 's-pending', status: where.status });

    await expect(service.submitCorrection(submitDto))
      .rejects.toMatchObject({ response: { code: 'CORRECTION_NOT_FOUND' } });

    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
    expect(verification.consumeRegistrationSession).not.toHaveBeenCalled();
  });

  it('submit：状态乐观锁失败（他人已处理）→ 400 CONFLICT，会话不消费、事务不进', async () => {
    prisma.supplier.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.submitCorrection(submitDto))
      .rejects.toMatchObject({ response: { code: 'CONFLICT' } });

    expect(verification.consumeRegistrationSession).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('submit：token 手机与主联系人手机不一致 → 400 CORRECTION_PHONE_MISMATCH', async () => {
    verification.assertRegistrationSession.mockResolvedValue({ phone: '13999999999' });

    await expect(service.submitCorrection(submitDto))
      .rejects.toMatchObject({ response: { code: 'CORRECTION_PHONE_MISMATCH' } });

    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('submit：contacts 数组内手机号重复 → 400 DUPLICATE_CONTACT_PHONE（零写入）', async () => {
    await expect(service.submitCorrection({
      ...submitDto,
      contacts: [
        { ...submitDto.contacts[0] },
        { ...submitDto.contacts[0], isPrimary: false, name: '王五' },
      ],
    })).rejects.toMatchObject({ response: { code: 'DUPLICATE_CONTACT_PHONE' } });

    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('submit：主联系人手机号被其他账号（User.phoneIdx）占用 → 400 DUPLICATE_PHONE', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'u-other' });

    await expect(service.submitCorrection(submitDto))
      .rejects.toMatchObject({ response: { code: 'DUPLICATE_PHONE' } });

    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('submit：主联系人手机号已是其他供应商主联系人 → 400 DUPLICATE_CONTACT_PHONE', async () => {
    prisma.supplierContact.findFirst.mockResolvedValueOnce({ id: 'c-other' });

    await expect(service.submitCorrection(submitDto))
      .rejects.toMatchObject({ response: { code: 'DUPLICATE_CONTACT_PHONE' } });

    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('submit：附件 URL 不符合注册上传命名空间 → 400 REGISTRATION_ASSET_URL_INVALID', async () => {
    await expect(service.submitCorrection({
      ...submitDto,
      qualifications: [{ type: '营业执照', name: '营业执照', fileUrl: 'https://evil.example/license.pdf' }],
    })).rejects.toMatchObject({ response: { code: 'REGISTRATION_ASSET_URL_INVALID' } });

    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });
});
