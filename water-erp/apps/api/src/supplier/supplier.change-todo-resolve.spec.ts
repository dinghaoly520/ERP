import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * 资料变更审批待办的「办结联动消解」（2026-11-20 用户实录修复）：
 * 同公司两账号都收到变更待办，一人审批后另一人的待办仍挂——根因是创建/消解两侧
 * link 形态脱节：创建侧（supplier-portal 2026-11-03 起）link=/supplier/{id}?tab=changes，
 * 消解侧一直传裸 /supplier?tab=changes（resolveActionableBySupplierName 精确匹配恒落空），
 * 动作侧消解从未生效，全靠每日 sweep 兜底。本组锁定：
 * - createChangeRequest（:3005 代提入口）与门户同型：SUPPLIER_CHANGE_PENDING + 带 id 深链
 *   （原 SUPPLIER_PENDING + /supplier/{id} 是类型/link 双错配死路）
 * - approveChange / approveConvertToRegular / rejectChange 按创建形态精确消解（保留裸形态消存量）
 */
const supplierFixture = {
  id: 'sup-1',
  userId: 'user-1',
  name: '测试供应商',
  status: 'APPROVED',
  companyId: 'co-1',
};

const pendingChange = () => ({
  id: 'chg-1',
  supplierId: 'sup-1',
  fieldName: 'registeredAddress',
  fieldLabel: '注册地址',
  oldValue: '成都市',
  newValue: '绵阳市',
  reason: '搬迁',
  status: 'PENDING',
});

describe('SupplierService 资料变更待办消解', () => {
  let service: SupplierService;
  let prisma: any;
  let notification: any;

  beforeEach(async () => {
    prisma = {
      supplier: {
        findUnique: jest.fn().mockResolvedValue(supplierFixture),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        // resolveCompanyApprovers：同公司 staff/leader 命中（≥1 人，通知断言才成立）
        findMany: jest.fn().mockResolvedValue([{ id: 'st-1' }]),
        update: jest.fn().mockResolvedValue({}),
      },
      supplierChangeRecord: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
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

  it('createChangeRequest：与门户同型——SUPPLIER_CHANGE_PENDING + 带 id 深链（原 SUPPLIER_PENDING 类型错配，审批消解永不命中）', async () => {
    await service.createChangeRequest('sup-1', 'user-1', {
      fieldName: 'registeredAddress', fieldLabel: '注册地址', newValue: '绵阳市', reason: '搬迁',
    });
    // 提交通知为 void fire-and-forget（不阻断提交结果）——冲刷微任务后再断言
    await new Promise((r) => setImmediate(r));
    expect(notification.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'st-1',
      type: 'SUPPLIER_CHANGE_PENDING',
      link: '/supplier/sup-1?tab=changes',
    }));
  });

  it('approveChange：按创建形态精确消解（/supplier/{id}?tab=changes）——他人副本即时办结', async () => {
    prisma.supplierChangeRecord.findUnique.mockResolvedValue(pendingChange());
    await service.approveChange('chg-1', 'reviewer-1');
    expect(notification.resolveActionableBySupplierName).toHaveBeenCalledWith(
      'SUPPLIER_CHANGE_PENDING',
      '/supplier/sup-1?tab=changes',
      '测试供应商',
    );
    // 裸形态保留：消解 2026-11-03 前的存量通知
    expect(notification.resolveActionableBySupplierName).toHaveBeenCalledWith(
      'SUPPLIER_CHANGE_PENDING',
      '/supplier?tab=changes',
      '测试供应商',
    );
  });

  it('rejectChange：同口径消解', async () => {
    prisma.supplierChangeRecord.findUnique.mockResolvedValue(pendingChange());
    await service.rejectChange('chg-1', 'reviewer-1', '资料不符');
    expect(notification.resolveActionableBySupplierName).toHaveBeenCalledWith(
      'SUPPLIER_CHANGE_PENDING',
      '/supplier/sup-1?tab=changes',
      '测试供应商',
    );
  });

  it('approveConvertToRegular：转正（聚合变更）同口径消解', async () => {
    prisma.supplierChangeRecord.findUnique.mockResolvedValue({
      id: 'chg-2',
      supplierId: 'sup-1',
      fieldName: 'convertToRegular',
      newValue: JSON.stringify({
        enterpriseType: '有限责任公司',
        legalPerson: '张三',
        registeredAddress: '成都市',
        businessScope: '水利工程',
        creditCode: '91510000MA62K5XX0X',
        legalPersonIdCard: '510104199001011234',
        legalIdFileUrl: 'https://minio.test/legal-id.pdf',
        contacts: [],
        qualifications: [],
        tags: [],
      }),
      status: 'PENDING',
    });
    await service.approveChange('chg-2', 'reviewer-1');
    expect(notification.resolveActionableBySupplierName).toHaveBeenCalledWith(
      'SUPPLIER_CHANGE_PENDING',
      '/supplier/sup-1?tab=changes',
      '测试供应商',
    );
  });
});
