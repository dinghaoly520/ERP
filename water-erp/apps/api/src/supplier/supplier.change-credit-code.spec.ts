import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * 统一社会信用代码变更（2026-11-10 用户裁定放开，推翻 supplier-change-fields 旧注「敏感不可变」）：
 * - createChangeRequest（:3005 代提入口）四闸：18 位格式 / 同值 / 全库查重 / 登录名占用
 * - approveChange：creditCode+organizationCode+user.username 三处一致落库；审批时点再校验（不信任提交时点）
 * - approveConvertToRegular：转正修正信用代码时同步登录名与冗余列（存量缺口顺带修）
 */
const OLD_CODE = '91510000MA62K5XX0X';
const NEW_CODE = '91510000MA62K5YY1Y';

const supplierFixture = {
  id: 'sup-1',
  userId: 'user-1',
  name: '测试供应商',
  status: 'APPROVED',
  companyId: null,
  creditCode: OLD_CODE,
  organizationCode: OLD_CODE,
};

describe('SupplierService 统一社会信用代码变更', () => {
  let service: SupplierService;
  let prisma: any;
  let notification: any;

  beforeEach(async () => {
    prisma = {
      supplier: {
        findUnique: jest.fn().mockResolvedValue(supplierFixture),
        findFirst: jest.fn().mockResolvedValue(null), // 默认：新代码无占用
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null), // 默认：登录名无占用
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      supplierChangeRecord: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null), // 默认：无同字段 PENDING
        create: jest.fn().mockResolvedValue({ id: 'chg-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      supplierQualification: { create: jest.fn().mockResolvedValue({}) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    notification = {
      create: jest.fn().mockResolvedValue({}),
      resolveActionableBySupplierName: jest.fn().mockResolvedValue({}),
    };
    const { Test } = await import('@nestjs/testing');
    const module = await Test.createTestingModule({
      providers: [
        {
          provide: CompanyScopeService,
          useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}), assertInScope: jest.fn(), stampFor: jest.fn().mockResolvedValue({}) },
        },
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notification },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: {} },
      ],
    }).compile();
    service = module.get(SupplierService);
  });

  // ── createChangeRequest（:3005 代提入口）四闸 ──

  it('信用代码格式非法（非 18 位大写）→ INVALID_CREDIT_CODE', async () => {
    await expect(
      service.createChangeRequest('sup-1', 'user-1', { fieldName: 'creditCode', fieldLabel: '统一社会信用代码', newValue: '123', reason: '写错了' }),
    ).rejects.toMatchObject({ response: { code: 'INVALID_CREDIT_CODE' } });
    expect(prisma.supplierChangeRecord.create).not.toHaveBeenCalled();
  });

  it('新代码与当前值相同 → NO_CHANGE（后端兜底，前端 dirty 已拦）', async () => {
    await expect(
      service.createChangeRequest('sup-1', 'user-1', { fieldName: 'creditCode', fieldLabel: '统一社会信用代码', newValue: OLD_CODE, reason: 'x' }),
    ).rejects.toMatchObject({ response: { code: 'NO_CHANGE' } });
  });

  it('新代码已被其他供应商占用 → DUPLICATE_CREDIT_CODE', async () => {
    prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-other' });
    await expect(
      service.createChangeRequest('sup-1', 'user-1', { fieldName: 'creditCode', fieldLabel: '统一社会信用代码', newValue: NEW_CODE, reason: 'x' }),
    ).rejects.toMatchObject({ response: { code: 'DUPLICATE_CREDIT_CODE' } });
  });

  it('新代码已被其他账号占用为登录名 → DUPLICATE_USERNAME（username=信用代码口径，审批时才炸则不可收拾）', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'user-other' });
    await expect(
      service.createChangeRequest('sup-1', 'user-1', { fieldName: 'creditCode', fieldLabel: '统一社会信用代码', newValue: NEW_CODE, reason: 'x' }),
    ).rejects.toMatchObject({ response: { code: 'DUPLICATE_USERNAME' } });
  });

  it('合法新代码 → 落变更记录，fieldLabel 服务端词表归一为「统一社会信用代码」', async () => {
    await service.createChangeRequest('sup-1', 'user-1', { fieldName: 'creditCode', fieldLabel: 'creditCode', newValue: NEW_CODE, reason: '三证合一换新码' });
    expect(prisma.supplierChangeRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        supplierId: 'sup-1',
        fieldName: 'creditCode',
        fieldLabel: '统一社会信用代码',
        oldValue: OLD_CODE,
        newValue: NEW_CODE,
        status: 'PENDING',
      }),
    });
  });

  // ── approveChange（审批落库三处一致 + 审批时点再校验） ──

  const pendingCreditChange = () => ({
    id: 'chg-1',
    supplierId: 'sup-1',
    fieldName: 'creditCode',
    fieldLabel: '统一社会信用代码',
    oldValue: OLD_CODE,
    newValue: NEW_CODE,
    reason: '三证合一换新码',
    status: 'PENDING',
  });

  it('审批通过 → supplier.update 同落 creditCode+organizationCode，user.username 同步为新代码', async () => {
    prisma.supplierChangeRecord.findUnique.mockResolvedValue(pendingCreditChange());
    await service.approveChange('chg-1', 'reviewer-1');
    expect(prisma.supplier.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sup-1' },
        data: expect.objectContaining({ creditCode: NEW_CODE, organizationCode: NEW_CODE }),
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' }, data: { username: NEW_CODE } }),
    );
  });

  it('审批通过 → 站内通知供应商登录账号已变更为新代码', async () => {
    prisma.supplierChangeRecord.findUnique.mockResolvedValue(pendingCreditChange());
    await service.approveChange('chg-1', 'reviewer-1');
    expect(notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', type: 'SUPPLIER_CHANGE_APPROVED' }),
    );
  });

  it('审批时点新代码已被他司占用（提交后状态漂移）→ DUPLICATE_CREDIT_CODE 且不落库', async () => {
    prisma.supplierChangeRecord.findUnique.mockResolvedValue(pendingCreditChange());
    prisma.supplier.findFirst.mockResolvedValue({ id: 'sup-other' });
    await expect(service.approveChange('chg-1', 'reviewer-1')).rejects.toMatchObject({
      response: { code: 'DUPLICATE_CREDIT_CODE' },
    });
    expect(prisma.supplier.update).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('审批时点格式非法（存量脏记录）→ INVALID_CREDIT_CODE（不信任历史提交）', async () => {
    prisma.supplierChangeRecord.findUnique.mockResolvedValue({ ...pendingCreditChange(), newValue: '坏数据' });
    await expect(service.approveChange('chg-1', 'reviewer-1')).rejects.toMatchObject({
      response: { code: 'INVALID_CREDIT_CODE' },
    });
  });

  // ── approveConvertToRegular（转正修正信用代码 → 登录名/冗余列联动，存量缺口 2026-11-10 补） ──

  it('转正修正信用代码 → 同步 user.username 与 organizationCode（与 approveChange 同口径）', async () => {
    const payload = {
      enterpriseType: '有限责任公司',
      legalPerson: '张三',
      registeredAddress: '成都市',
      businessScope: '水利工程',
      creditCode: NEW_CODE,
      legalPersonIdCard: '510104199001011234',
      legalIdFileUrl: 'https://minio.test/legal-id.pdf',
      contacts: [],
      qualifications: [],
      tags: [],
    };
    prisma.supplierChangeRecord.findUnique.mockResolvedValue({
      id: 'chg-2',
      supplierId: 'sup-1',
      fieldName: 'convertToRegular',
      newValue: JSON.stringify(payload),
      status: 'PENDING',
    });
    await service.approveChange('chg-2', 'reviewer-1');
    expect(prisma.supplier.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sup-1' },
        data: expect.objectContaining({ creditCode: NEW_CODE, organizationCode: NEW_CODE, isTemporary: false }),
      }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' }, data: { username: NEW_CODE } }),
    );
  });
});
