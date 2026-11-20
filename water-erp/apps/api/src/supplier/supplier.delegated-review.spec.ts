import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LlmService } from '../local-ai/llm.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationService } from '../verification/verification.service';
import { SupplierService } from './supplier.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * admin 禁代审（2026-11-20 用户裁定，推翻 2026-10-08 A 方案的 admin 分支）：
 * admin 只审终审级；唯一例外=未归属公司（companyId=null）孤儿件归平台 admin 兜底。
 * 本 spec 锁定：
 * 1) myPendingReviewCount：admin 待办 = ADMIN 级 OR 孤儿件（companyId=null）
 * 2) list()：admin 查 reviewStage=ADMIN 时同口径展开（ORM + raw completeness 两路径），
 *    结果中 LEADER/STAFF 级项（=孤儿）带 delegatedReview 标记（前端亮「待我审」）
 * 3) assertStageApprover：admin 对有归属公司的 STAFF/LEADER 级一律 403（无论该公司有无在编），
 *    对 companyId=null 孤儿件放行
 * 4) resolveStageApprovers：不再上浮 admin；在编探测排除冻结账号
 */
describe('SupplierService — admin 禁代审（终审+孤儿兜底）', () => {
  let service: SupplierService;
  let prisma: any;

  const ACTOR_ADMIN = { sub: 'admin-1', role: 'admin', username: 'Swhi-CGZX-admin' };
  const ACTOR_LEADER = { sub: 'leader-1', role: 'leader', username: 'Swhi-CGZX-01' };
  const ORPHAN_OR = [
    { reviewStage: 'ADMIN' },
    { companyId: null },
  ];

  beforeEach(async () => {
    prisma = {
      supplier: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      supplierChangeRecord: { count: jest.fn().mockResolvedValue(0) },
      supplierCompanyLink: { count: jest.fn().mockResolvedValue(0) },
      passwordResetRequest: { count: jest.fn().mockResolvedValue(0) },
      supplierEvaluation: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
      user: { count: jest.fn().mockResolvedValue(0), findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}) } },
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: {} },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: {} },
      ],
    }).compile();
    service = module.get(SupplierService);
  });

  it('myPendingReviewCount：admin 待办 = ADMIN 级 OR 孤儿件（companyId=null），joins 仅 ADMIN 级', async () => {
    await service.myPendingReviewCount(ACTOR_ADMIN as any);
    const where = prisma.supplier.count.mock.calls[0][0].where;
    expect(where.reviewStage).toBeUndefined();
    expect(where.AND?.[0]?.OR).toEqual(ORPHAN_OR);
    expect(prisma.supplierCompanyLink.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ reviewStage: 'ADMIN' }),
    }));
  });

  it('list()：admin 查 reviewStage=ADMIN 走 ORM 路径时展开为 ADMIN OR 孤儿，LEADER/STAFF 项（=孤儿）带 delegatedReview', async () => {
    prisma.supplier.findMany.mockResolvedValue([
      { id: 's1', reviewStage: 'ADMIN', status: 'PENDING' },
      { id: 's2', reviewStage: 'LEADER', status: 'PENDING' },
      { id: 's3', reviewStage: 'STAFF', status: 'PENDING' },
    ]);
    const res = await service.list({ reviewStage: 'ADMIN', actor: ACTOR_ADMIN as any, sort: 'createdAt' });

    const where = prisma.supplier.count.mock.calls[0][0].where;
    expect(where.reviewStage).toBeUndefined();
    expect(where.AND?.[0]?.OR).toEqual(ORPHAN_OR);
    expect(where.__orphanExpand).toBeUndefined(); // 内部标记不得泄入 Prisma 参数
    expect(res.items.find((i: any) => i.id === 's1').delegatedReview).toBeUndefined();
    expect(res.items.find((i: any) => i.id === 's2').delegatedReview).toBe(true);
    expect(res.items.find((i: any) => i.id === 's3').delegatedReview).toBe(true);
  });

  it('list()：completeness 默认路径（raw SQL）生成「ADMIN OR companyId IS NULL」孤儿条件（不再有 NOT EXISTS 在编探测）', async () => {
    await service.list({ reviewStage: 'ADMIN', actor: ACTOR_ADMIN as any }); // sort 缺省 completeness
    expect(prisma.$queryRaw).toHaveBeenCalled();
    const sql = JSON.stringify(prisma.$queryRaw.mock.calls[0][1]);
    expect(sql).toContain(`= 'ADMIN' OR s.`);
    expect(sql).toContain(`IS NULL`);
    expect(sql).not.toContain(`NOT EXISTS`);
  });

  it('list()：非 admin 查 reviewStage 不展开（严格单级标量）', async () => {
    await service.list({ reviewStage: 'LEADER', actor: ACTOR_LEADER as any, sort: 'createdAt' });
    const where = prisma.supplier.count.mock.calls[0][0].where;
    expect(where.reviewStage).toBe('LEADER');
    expect(where.AND).toBeUndefined();
  });

  // ── assertStageApprover：admin 禁代审边界 ──

  const assertStage = (stage: string, reviewer: any, companyId: string | null) =>
    (service as any).assertStageApprover(stage, reviewer, companyId);

  it('STAFF 级：公司无 staff 无 leader → admin 仍 403（禁代初审，须建 staff/leader 账号）', async () => {
    prisma.user.count.mockResolvedValue(0);
    await expect(assertStage('STAFF', { id: 'admin-1', role: 'admin', companyId: null }, 'co-x'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('LEADER 级：公司无 leader → admin 仍 403（禁代复审）', async () => {
    await expect(assertStage('LEADER', { id: 'admin-1', role: 'admin', companyId: null }, 'co-x'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('孤儿件（companyId=null）：admin 任意级放行（平台兜底）', async () => {
    await expect(assertStage('STAFF', { id: 'admin-1', role: 'admin', companyId: null }, null))
      .resolves.toBeUndefined();
    await expect(assertStage('LEADER', { id: 'admin-1', role: 'admin', companyId: null }, null))
      .resolves.toBeUndefined();
  });

  it('ADMIN 级：admin 照常放行', async () => {
    await expect(assertStage('ADMIN', { id: 'admin-1', role: 'admin', companyId: null }, 'co-x'))
      .resolves.toBeUndefined();
  });

  it('STAFF 级：公司无 staff → 同公司 leader 代初审放行（代审保留），且在编探测排除冻结账号', async () => {
    prisma.user.count.mockResolvedValue(0);
    await expect(assertStage('STAFF', { id: 'leader-1', role: 'leader', companyId: 'co-x' }, 'co-x'))
      .resolves.toBeUndefined();
    // 稳健性（2026-11-20）：唯一 staff 被冻结不算在编——探测 where 须带 isFrozen:false
    expect(prisma.user.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ role: 'staff', isFrozen: false }),
    }));
  });

  it('resolveStageApprovers：STAFF 级止于 leader（不再上浮 admin）；companyId=null → admin 兜底', async () => {
    const resolve = (stage: string, companyId: string | null) =>
      (service as any).resolveStageApprovers(stage, companyId);
    // co-x：无 staff、有 leader；co-y：无 staff 无 leader
    prisma.user.findMany.mockImplementation(({ where }: any) => {
      if (where.role === 'admin') return Promise.resolve([{ id: 'admin-9' }]);
      if (where.companyId === 'co-y') return Promise.resolve([]);
      return Promise.resolve(where.role === 'leader' ? [{ id: 'leader-9' }] : []);
    });
    await expect(resolve('STAFF', 'co-x')).resolves.toEqual(['leader-9']); // 无 staff → leader 代初审，止于此
    await expect(resolve('STAFF', 'co-y')).resolves.toEqual([]);          // 无 staff 无 leader → 空（原上浮 admin，2026-11-20 废）
    await expect(resolve('LEADER', 'co-y')).resolves.toEqual([]);         // 无 leader → 空（原上浮 admin）
    await expect(resolve('STAFF', null)).resolves.toEqual(['admin-9']);   // 孤儿 → 平台 admin 兜底
  });
});

describe('SupplierService.approve — 孤儿件（companyId=null）admin 兜底全链路', () => {
  let service: SupplierService;
  let prisma: any;
  let notificationService: any;

  const SUPPLIER = {
    id: 'sup-1', userId: 'sup-user-1', name: '未归属公司供应商',
    status: 'PENDING', reviewStage: 'STAFF', companyId: null,
  };

  beforeEach(async () => {
    notificationService = {
      create: jest.fn().mockResolvedValue(undefined),
      resolveActionable: jest.fn().mockResolvedValue(undefined),
    };
    prisma = {
      supplier: {
        // approve() 首查（include user）与 recordApproval→buildApprovalSnapshot 二查共用
        findUnique: jest.fn().mockResolvedValue({
          ...SUPPLIER,
          user: { id: 'sup-user-1', username: 'u', displayName: 'd', email: null },
          contacts: [], qualifications: [], bankAccounts: [], performances: [],
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }), // 乐观锁推进成功
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'admin-1', role: 'admin', companyId: null }), // admin 审批人
        count: jest.fn().mockResolvedValue(0), // 在编探测（孤儿件 companyId=null 恒无在编）
        findMany: jest.fn().mockResolvedValue([{ id: 'admin-9' }]), // 下一级收件人回退平台 admin
      },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
      fileAsset: { findMany: jest.fn().mockResolvedValue([]) },
      supplierApprovalRecord: { create: jest.fn().mockResolvedValue(undefined) },
      // Task 3 驳回数据最小化：reject() 末尾 purgeRejectedSupplier 走 $transaction 清洗——
      // 事务回调直通外层 mock，补齐清洗用到的子表 deleteMany / supplier.update / user.update / 审批快照 findMany
      $transaction: jest.fn(async (fn: any) => fn({
        ...prisma,
        supplier: { ...prisma.supplier, update: jest.fn().mockResolvedValue({}) },
        supplierContact: { deleteMany: jest.fn().mockResolvedValue({}) },
        supplierQualification: { deleteMany: jest.fn().mockResolvedValue({}) },
        supplierBankAccount: { deleteMany: jest.fn().mockResolvedValue({}) },
        supplierPerformance: { deleteMany: jest.fn().mockResolvedValue({}) },
        supplierClassificationLink: { deleteMany: jest.fn().mockResolvedValue({}) },
        user: { ...prisma.user, update: jest.fn().mockResolvedValue({}) },
        supplierApprovalRecord: { ...prisma.supplierApprovalRecord, findMany: jest.fn().mockResolvedValue([]) },
      })),
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn(), filter: jest.fn().mockReturnValue({}) } },
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: notificationService },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: {} },
      ],
    }).compile();
    service = module.get(SupplierService);
  });

  it('孤儿件（companyId=null）：admin 可初审通过，推进至 LEADER 且留痕 stage=STAFF', async () => {
    const res = await service.approve('sup-1', 'admin-1', '证照齐全，平台管理员兜底初审');
    expect(res).toEqual({ success: true, stage: 'LEADER' });
    // 乐观锁推进：仅升级 reviewStage，不落终态
    expect(prisma.supplier.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sup-1', status: { in: ['PENDING', 'RETURNED'] }, reviewStage: 'STAFF' },
      data: { reviewStage: 'LEADER', returnReason: null },
    }));
    // 不可变留痕：动作 APPROVED、发生级 STAFF（展示侧据此亮「代初审」徽标）
    expect(prisma.supplierApprovalRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        supplierId: 'sup-1', action: 'APPROVED', stage: 'STAFF',
        reviewerUserId: 'admin-1', reason: '证照齐全，平台管理员兜底初审',
      }),
    }));
    // 下一级（LEADER）待办：孤儿件无公司可路由 → 平台 admin（companyId=null 兜底分支）
    expect(notificationService.create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SUPPLIER_PENDING', title: '供应商注册待复审',
    }));
  });

  it('同场景：驳回同样可达（此前驳回与通过同级断言一并堵死）', async () => {
    await service.reject('sup-1', '材料不实', 'admin-1');
    expect(prisma.supplier.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'REJECTED', rejectReason: '材料不实' },
    }));
    expect(prisma.supplierApprovalRecord.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'REJECTED', stage: 'STAFF', reviewerUserId: 'admin-1' }),
    }));
  });

  it('有归属公司但无办公账号（companyId 非空）：admin 初审 403——禁代审（推翻 2026-10-09 方案 A）', async () => {
    prisma.supplier.findUnique.mockResolvedValue({
      ...SUPPLIER, companyId: 'co-none',
      user: { id: 'sup-user-1', username: 'u', displayName: 'd', email: null },
      contacts: [], qualifications: [], bankAccounts: [], performances: [],
    });
    await expect(service.approve('sup-1', 'admin-1', '证照齐全')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.supplier.updateMany).not.toHaveBeenCalled();
    expect(prisma.supplierApprovalRecord.create).not.toHaveBeenCalled();
  });
});

/** leader 的 STAFF 代审件（2026-10-09 用户报告）：公司有 leader 无 staff 时 STAFF 级归 leader
 *  代初审——权限（assertStageApprover）/通知（resolveStageApprovers）/角标（myPendingReviewCount
 *  leader 分支已含）均已达成，唯审批中心列表（scopedStage 硬编码 LEADER + list 严格标量）不可见：
 *  角标有待审数、点开列表却空。锁定 list() 的 leader 展开口径。 */
describe('SupplierService.list — leader 查 LEADER 级时带上本公司 STAFF 代审件', () => {
  let service: SupplierService;
  let prisma: any;
  let companyScope: any;

  const ACTOR_LEADER = { sub: 'leader-1', role: 'leader', username: 'Swhi-CGZX-01' };

  beforeEach(async () => {
    companyScope = {
      // leader 公司域注入（2026-10-16 换形：resolveScope 产 scope，supplierCompanyWhere 产 companyLinks）
      resolveScope: jest.fn().mockResolvedValue({ all: false, companyIds: ['co-1'] }),
      filter: jest.fn(), // 供应商域已不走 filter——留空防误用回退
    };
    prisma = {
      supplier: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      supplierEvaluation: { groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]) },
      user: { findUnique: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: companyScope },
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: {} },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: {} },
      ],
    }).compile();
    service = module.get(SupplierService);
  });

  it('本公司无 staff：展开为 LEADER OR STAFF，STAFF 项落 delegatedReview（角标/列表口径对齐）', async () => {
    prisma.user.count.mockResolvedValue(0); // companyHasActiveRole('staff','co-1') = false
    prisma.supplier.findMany.mockResolvedValue([
      { id: 'l1', reviewStage: 'LEADER', status: 'PENDING' },
      { id: 's1', reviewStage: 'STAFF', status: 'PENDING' },
    ]);
    const res = await service.list({ reviewStage: 'LEADER', actor: ACTOR_LEADER as any, sort: 'createdAt' });

    const where = prisma.supplier.count.mock.calls[0][0].where;
    // 公司域注入形状（C1 终审修复 2026-10-19）：reviewStage 给定 → 审批流双谓词
    // （APPROVED link OR 主归属 companyId——新注册件终审前无 link 也可见），落 where.AND[0]
    expect(where.companyLinks).toBeUndefined();
    expect(where.AND?.[0]?.OR).toEqual([
      { companyLinks: { some: { companyId: { in: ['co-1'] }, status: 'APPROVED' } } },
      { companyId: { in: ['co-1'] } },
    ]);
    expect(where.reviewStage).toBeUndefined();
    // 代审展开组追加在 AND[1]（2026-10-09 口径不变，位置随双谓词后移）
    expect(where.AND?.[1]?.OR).toEqual([{ reviewStage: 'LEADER' }, { reviewStage: 'STAFF' }]);
    expect(res.items.find((i: any) => i.id === 'l1').delegatedReview).toBeUndefined(); // 复审是本职
    expect(res.items.find((i: any) => i.id === 's1').delegatedReview).toBe(true);      // 代初审件
  });

  it('本公司有 staff：不展开（严格 LEADER——初审归同公司 staff）；审批流公司域仍为双谓词组', async () => {
    prisma.user.count.mockResolvedValue(1); // 有在编 staff
    await service.list({ reviewStage: 'LEADER', actor: ACTOR_LEADER as any, sort: 'createdAt' });
    const where = prisma.supplier.count.mock.calls[0][0].where;
    expect(where.reviewStage).toBe('LEADER');
    // 无代审展开组——AND 仅剩审批流双谓词组（C1），不再 undefined
    expect(where.AND).toHaveLength(1);
    expect(where.AND?.[0]?.OR).toEqual([
      { companyLinks: { some: { companyId: { in: ['co-1'] }, status: 'APPROVED' } } },
      { companyId: { in: ['co-1'] } },
    ]);
  });

  it('leader 无公司域（公司视野=全部→link 未注入）：不展开——防无归属 leader 拖全库 STAFF 件', async () => {
    companyScope.resolveScope.mockResolvedValue({ all: true }); // 无公司域限定
    await service.list({ reviewStage: 'LEADER', actor: ACTOR_LEADER as any, sort: 'createdAt' });
    const where = prisma.supplier.count.mock.calls[0][0].where;
    expect(where.reviewStage).toBe('LEADER');
    expect(where.AND).toBeUndefined();
  });

  it('completeness 默认路径（raw SQL）翻译为两级 OR 条件', async () => {
    await service.list({ reviewStage: 'LEADER', actor: ACTOR_LEADER as any }); // sort 缺省 completeness
    const sql = JSON.stringify(prisma.$queryRaw.mock.calls[0][1]);
    expect(sql).toContain(`= 'LEADER' OR s.`);
    expect(sql).toContain(`= 'STAFF'`);
  });
});
