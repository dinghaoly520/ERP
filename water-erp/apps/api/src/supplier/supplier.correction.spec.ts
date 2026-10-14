import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService } from '../company/company-scope';
import { sealPii, blindIndexPii } from '../common/crypto/sm-field-crypto';

// 旧附件清理是 best-effort MinIO removeObject——桩化防单测真连 MinIO
jest.mock('../upload/minio.client', () => ({
  minioClient: { removeObject: jest.fn() },
  MINIO_BUCKET: 'water-erp-test',
}));

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
  let fileAssetDeleteMany: jest.Mock;
  let unclaimedAssets: any[];
  let ownedAssets: any[]; // 模拟该 user 名下 qualification/general 附件「表」（stale 清理查询的数据源）

  beforeEach(async () => {
    // 内存「表」：findReturnedSupplier 按 name+creditCode+status=RETURNED 精确匹配
    const dbSuppliers: any[] = [returnedSupplier];
    txSupplierUpdate = jest.fn().mockResolvedValue({});
    txContactDeleteMany = jest.fn().mockResolvedValue({});
    txFileAssetClaim = jest.fn().mockResolvedValue({ count: 1 });
    fileAssetDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
    unclaimedAssets = [{ id: 'asset-1' }]; // 默认：asset-1 为本次新上传（未认领）
    ownedAssets = []; // 默认：user 名下无历史附件

    prisma = {
      supplier: {
        // request/verify/draft 按 name+creditCode 双因子匹配；submit 按 creditCode 单因子（公司名可改）
        findFirst: jest.fn(async ({ where }: any) =>
          dbSuppliers.find((s) =>
            (where.name === undefined || s.name === where.name)
            && s.creditCode === where.creditCode
            && s.status === where.status) ?? null),
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
        // collectCorrectionAssetIds（uploaderId=null 查待 claim）与 deleteStaleCorrectionAssets（按 userId+notIn 查旧附件）分流；
        // stale 查询模拟 DB 应用 notIn 过滤——keepIds 漏掉任一保留附件时它会出现在结果里，断言随之变红
        findMany: jest.fn(async ({ where }: any) => {
          if (where?.uploaderId === null) return unclaimedAssets;
          return ownedAssets.filter((a) => !(where?.id?.notIn ?? []).includes(a.id));
        }),
        deleteMany: fileAssetDeleteMany,
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (fn: any) => fn({
        supplierContact: { deleteMany: txContactDeleteMany },
        supplierQualification: { deleteMany: jest.fn().mockResolvedValue({}) },
        supplierBankAccount: { deleteMany: jest.fn().mockResolvedValue({}) },
        supplierPerformance: { deleteMany: jest.fn().mockResolvedValue({}) },
        supplier: { update: txSupplierUpdate, updateMany: prisma.supplier.updateMany }, // 乐观锁认领在事务内
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

  it('draft：token/name/creditCode 任一缺失 → 400 MISSING_CORRECTION_PARAMS（防 hashToken(undefined) crypto 500）', async () => {
    await expect(service.getCorrectionDraft('', '', ''))
      .rejects.toMatchObject({ response: { code: 'MISSING_CORRECTION_PARAMS' } });
    // 守卫先于一切副作用：不触会话校验、不查库
    expect(verification.assertRegistrationSession).not.toHaveBeenCalled();
    expect(prisma.supplier.findFirst).not.toHaveBeenCalled();
  });

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

    // 乐观锁（事务内）：仅 RETURNED 可补正，认领即置 PENDING（reviewStage 保留回到退回级）
    expect(prisma.supplier.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 's1', status: 'RETURNED' },
      data: expect.objectContaining({ status: 'PENDING', legalPersonIdCardIdx: blindIndexPii('510104199001011234') }),
    }));

    // 一次性补正 token 消费——须在事务成功之后（失败不烧 token）
    expect(verification.consumeRegistrationSession).toHaveBeenCalledWith('corr-token-1');
    expect(verification.consumeRegistrationSession.mock.invocationCallOrder[0])
      .toBeGreaterThan(prisma.$transaction.mock.invocationCallOrder[0]);

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

  it('submit：状态乐观锁失败（他人已处理）→ 400 CONFLICT 自事务内抛出，token 不烧、旧附件清理不跑', async () => {
    prisma.supplier.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.submitCorrection(submitDto))
      .rejects.toMatchObject({ response: { code: 'CONFLICT' } });

    // 认领在事务内：CONFLICT 即事务中止——token 未消费、子表未重建、旧附件清理查询未发生
    expect(verification.consumeRegistrationSession).not.toHaveBeenCalled();
    expect(txSupplierUpdate).not.toHaveBeenCalled();
    expect(txContactDeleteMany).not.toHaveBeenCalled();
    expect(fileAssetDeleteMany).not.toHaveBeenCalled();
    const staleQuery = (prisma.fileAsset.findMany as jest.Mock).mock.calls.find(([a]: any[]) => a.where?.uploaderId === 'u1');
    expect(staleQuery).toBeUndefined();
  });

  it('submit（评审修复2）：事务失败（附件被竞态占用）→ 整体中止，token 未烧可原样重试', async () => {
    unclaimedAssets = [{ id: 'asset-1' }];
    txFileAssetClaim.mockResolvedValueOnce({ count: 0 }); // claim 数量不符 → 事务内 ConflictException

    await expect(service.submitCorrection(submitDto))
      .rejects.toMatchObject({ response: { code: 'REGISTRATION_ASSET_ALREADY_CLAIMED' } });

    // 一次性 token 在事务成功后才消费：失败不烧，供应商状态随事务回滚仍 RETURNED，可原 token 重试
    expect(verification.consumeRegistrationSession).not.toHaveBeenCalled();
    // 旧附件清理（事务后步骤）不执行
    expect(fileAssetDeleteMany).not.toHaveBeenCalled();
  });

  it('submit（评审修复1）：保留已认领旧附件 + 新增未认领附件 → keepIds 含两者，旧附件不在清理集合', async () => {
    // 场景：register 提交即 claim——asset-1 为原申请已认领旧附件（uploaderId=u1，保留引用）；
    // asset-2 为补正时新上传的未认领附件；asset-stale 为被替换下架的真旧附件
    unclaimedAssets = [{ id: 'asset-2' }];
    ownedAssets = [
      { id: 'asset-1', key: 'reg/asset-1', sealedPath: null },
      { id: 'asset-stale', key: 'reg/asset-stale', sealedPath: null },
    ];

    await service.submitCorrection({
      ...submitDto,
      qualifications: [
        { type: '营业执照', name: '营业执照', fileUrl: '/api/upload/files/asset-1' }, // 保留
        { type: '资质证书', name: '新证书', fileUrl: '/api/upload/files/asset-2' }, // 新增
      ],
    });

    // 事务内只 claim 未认领的新附件（旧附件已有主不重复 claim）
    expect(txFileAssetClaim).toHaveBeenCalledWith({
      where: { id: { in: ['asset-2'] }, uploaderId: null },
      data: { uploaderId: 'u1' },
    });

    // 旧附件清理的保留白名单 = 全部引用（asset-1 + asset-2）——保留的旧附件绝不能进 notIn 反集
    const staleQuery = (prisma.fileAsset.findMany as jest.Mock).mock.calls.find(([a]: any[]) => a.where?.uploaderId === 'u1');
    expect(staleQuery[0]).toMatchObject({
      where: { uploaderId: 'u1', category: { in: ['qualification', 'general'] }, id: { notIn: ['asset-1', 'asset-2'] } },
    });

    // 实际删除仅真被替换的 asset-stale；保留中的 asset-1 不删（防不可逆误删主路径）
    expect(fileAssetDeleteMany).toHaveBeenCalledWith({ where: { id: { in: ['asset-stale'] } } });
  });

  it('submit（评审修复3）：补正中改公司名 → 仅按 creditCode 匹配成功，name/normalizedName 更新落库', async () => {
    const res = await service.submitCorrection({ ...submitDto, name: '测试公司更名后' });

    expect(res).toEqual({ success: true });

    // 匹配 where 只含 creditCode+status（不含 name）——改名后提交不因名字对不上而 CORRECTION_NOT_FOUND
    expect(prisma.supplier.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { creditCode: '91510000MA62K5XX0X', status: 'RETURNED' },
    }));

    // 可改字段 name 随提交更新（同步 normalizedName）
    expect(prisma.supplier.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 's1', status: 'RETURNED' },
      data: expect.objectContaining({ name: '测试公司更名后', normalizedName: '测试公司更名后' }),
    }));
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
    // F3 后 supplierContact.findFirst 有两处调用（先联系人证查重、后手机号查重）——
    // 按 where.phoneIdx 区分，仅手机号查重命中他司（语义不变，仅 mock 适配调用次序）
    prisma.supplierContact.findFirst.mockImplementation(async ({ where }: any) =>
      where?.phoneIdx !== undefined ? { id: 'c-other' } : null);

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

  // ── F2/F3（2026-10-14 最终 review 修复波）──

  it('submit（F2）：补正改归属公司+改名 → 待办发新公司、通知/审计文案用提交名（不回退旧快照）', async () => {
    prisma.company.findUnique.mockImplementation(async ({ where }: any) =>
      where.id === 'c2' ? { id: 'c2', name: '新测试集团' } : { id: 'c1', name: '测试集团' });

    await service.submitCorrection({ ...submitDto, companyId: 'c2', companyName: '新测试集团', name: '测试公司更名后' });

    // 待办收件人按新归属公司解析（resolveStageApprovers 的 where.companyId=companyRef.id，非旧 supplier.companyId）
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: 'staff', isActive: true, companyId: 'c2' },
      select: { id: true },
    });

    // 通知与审计文案用提交名（改名重提后 supplier.name 是旧名快照）
    expect(notification.create).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('测试公司更名后'),
    }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'SUPPLIER_RESUBMITTED', details: expect.objectContaining({ name: '测试公司更名后' }) }),
    }));
  });

  it('submit（F3）：缺营业执照 → 400 REGISTRATION_LICENSE_REQUIRED（零写入）', async () => {
    await expect(service.submitCorrection({
      ...submitDto,
      qualifications: [{ type: '资质证书', name: '安全生产许可证', fileUrl: '/api/upload/files/asset-9' }],
    })).rejects.toMatchObject({ response: { code: 'REGISTRATION_LICENSE_REQUIRED' } });

    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
    expect(verification.consumeRegistrationSession).not.toHaveBeenCalled();
  });

  it('submit（F3）：主联系人数≠1（两名主联系人）→ 400 REGISTRATION_PRIMARY_CONTACT_REQUIRED', async () => {
    await expect(service.submitCorrection({
      ...submitDto,
      contacts: [
        { ...submitDto.contacts[0] },
        { ...submitDto.contacts[0], name: '王五' },
      ],
    })).rejects.toMatchObject({ response: { code: 'REGISTRATION_PRIMARY_CONTACT_REQUIRED' } });

    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
  });

  it('submit（F3）：法定代表人身份证号撞他司 → 400 DUPLICATE_LEGAL_ID_CARD（带本申请自排除）', async () => {
    // 第一次调用=按 creditCode 匹配 RETURNED 申请（命中）；第二次=F3 法人证查重（命中他司）
    prisma.supplier.findFirst
      .mockResolvedValueOnce(returnedSupplier)
      .mockResolvedValueOnce({ id: 's-other' });

    await expect(service.submitCorrection(submitDto))
      .rejects.toMatchObject({ response: { code: 'DUPLICATE_LEGAL_ID_CARD' } });

    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
    expect(verification.consumeRegistrationSession).not.toHaveBeenCalled();
  });
});
