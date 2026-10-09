import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LlmService } from '../local-ai/llm.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationService } from '../verification/verification.service';
import { SupplierService } from './supplier.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * admin 代审可见性与权限（2026-10-08 A 方案；2026-10-09 扩 STAFF 级孤儿件）：
 * assertStageApprover 放行「归属公司无在编 leader 时 admin 代复审」+「公司无在编
 * staff 且无在编 leader 时 admin 代初审」，但角标/审批中心列表口径此前只算
 * reviewStage=ADMIN——admin「能审却看不见」（STAFF 孤儿件更是「收得到待办却 403」死锁）。
 * 本 spec 锁定：
 * 1) myPendingReviewCount：admin 待办 = ADMIN 级 OR（LEADER 级且公司无 leader）
 *    OR（STAFF 级且公司无 staff 无 leader）
 * 2) list()：admin 查 reviewStage=ADMIN 时同口径展开（ORM + raw completeness 两路径），
 *    命中的 LEADER/STAFF 级项带 delegatedReview 标记（前端亮「待我审」）
 * 3) assertStageApprover：STAFF 级 admin 代初审仅在「公司完全无办公账号」时放行
 */
describe('SupplierService — admin 代审可见性（A 方案）', () => {
  let service: SupplierService;
  let prisma: any;

  const ACTOR_ADMIN = { sub: 'admin-1', role: 'admin', username: 'Swhi-CGZX-admin' };
  const ACTOR_LEADER = { sub: 'leader-1', role: 'leader', username: 'Swhi-CGZX-01' };
  const DELEGATED_OR = [
    { reviewStage: 'ADMIN' },
    // companyId=null（未归属公司）显式分支：ORM 对 null to-one 关系的 none 不命中，
    // 须与 raw（NOT EXISTS 恒真）/ assertStageApprover（companyHasActiveRole(null)=false 放行）同口径
    { reviewStage: 'LEADER', OR: [{ companyId: null }, { company: { users: { none: { role: 'leader', isActive: true } } } }] },
    // STAFF 孤儿件（2026-10-09）：未归属公司，或公司既无 staff 也无 leader，admin 代初审
    { reviewStage: 'STAFF', OR: [{ companyId: null }, { company: { users: { none: { OR: [{ role: 'staff' }, { role: 'leader' }], isActive: true } } } }] },
  ];

  beforeEach(async () => {
    prisma = {
      supplier: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      supplierChangeRecord: { count: jest.fn().mockResolvedValue(0) },
      supplierEvaluation: { groupBy: jest.fn().mockResolvedValue([]) },
      user: { count: jest.fn().mockResolvedValue(0), findUnique: jest.fn().mockResolvedValue(null) },
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

  it('myPendingReviewCount：admin 待办展开为 ADMIN 级 OR（无 leader 公司的 LEADER 级）OR（无办公账号公司的 STAFF 级）', async () => {
    await service.myPendingReviewCount(ACTOR_ADMIN as any);
    const where = prisma.supplier.count.mock.calls[0][0].where;
    expect(where.reviewStage).toBeUndefined(); // 不再是单级标量（旧口径漏计代审件）
    expect(where.AND?.[0]?.OR).toEqual(DELEGATED_OR);
  });

  it('list()：admin 查 reviewStage=ADMIN 走 ORM 路径时展开，且 LEADER/STAFF 孤儿级项带 delegatedReview 标记', async () => {
    prisma.supplier.findMany.mockResolvedValue([
      { id: 's1', reviewStage: 'ADMIN', status: 'PENDING' },
      { id: 's2', reviewStage: 'LEADER', status: 'PENDING' },
      { id: 's3', reviewStage: 'STAFF', status: 'PENDING' },
    ]);
    const res = await service.list({ reviewStage: 'ADMIN', actor: ACTOR_ADMIN as any, sort: 'createdAt' });

    const where = prisma.supplier.count.mock.calls[0][0].where;
    expect(where.reviewStage).toBeUndefined();
    expect(where.AND?.[0]?.OR).toEqual(DELEGATED_OR);
    expect(where.__delegatedExpand).toBeUndefined(); // 内部标记不得泄入 Prisma 参数
    expect(res.items.find((i: any) => i.id === 's1').delegatedReview).toBeUndefined();
    expect(res.items.find((i: any) => i.id === 's2').delegatedReview).toBe(true);
    expect(res.items.find((i: any) => i.id === 's3').delegatedReview).toBe(true);
  });

  it('list()：completeness 默认路径（raw SQL）生成同口径 NOT EXISTS 代审条件（LEADER/STAFF 孤儿）', async () => {
    await service.list({ reviewStage: 'ADMIN', actor: ACTOR_ADMIN as any }); // sort 缺省 completeness
    expect(prisma.$queryRaw).toHaveBeenCalled();
    // $queryRaw 为 tagged template：mock 的 calls[0][1] 是 whereSql（Prisma.Sql，含全部条件文本）
    // JSON 序列化会转义双引号，断言取不含引号的片段
    const sql = JSON.stringify(prisma.$queryRaw.mock.calls[0][1]);
    expect(sql).toContain(`= 'ADMIN' OR (s.`);
    expect(sql).toContain(`NOT EXISTS (SELECT 1 FROM `);
    expect(sql).toContain(`= 'leader' AND u.`);
    // STAFF 孤儿：无 staff 且无 leader（一条 NOT EXISTS 内 OR 两角色；断言避开 JSON 转义的双引号）
    expect(sql).toContain(`= 'STAFF' AND NOT EXISTS`);
    expect(sql.toLowerCase()).toContain(`= 'staff' or `);
    expect(sql.toLowerCase()).toContain(`= 'leader'))`);
  });

  it('list()：非 admin 查 reviewStage 不展开（严格单级标量）', async () => {
    await service.list({ reviewStage: 'LEADER', actor: ACTOR_LEADER as any, sort: 'createdAt' });
    const where = prisma.supplier.count.mock.calls[0][0].where;
    expect(where.reviewStage).toBe('LEADER');
    expect(where.AND).toBeUndefined();
  });

  // ── assertStageApprover：STAFF 级 admin 代初审的放行边界（2026-10-09 方案 A）──

  const assertStage = (stage: string, reviewer: any, companyId: string | null) =>
    (service as any).assertStageApprover(stage, reviewer, companyId);

  it('STAFF 级：公司无 staff 无 leader → 平台 admin 代初审放行', async () => {
    prisma.user.count.mockResolvedValue(0); // companyHasActiveRole(staff/leader) 均为 false
    await expect(assertStage('STAFF', { id: 'admin-1', role: 'admin', companyId: null }, 'co-x'))
      .resolves.toBeUndefined();
  });

  it('STAFF 级：公司有 staff → admin 不得代初审（初审归同公司 staff）', async () => {
    prisma.user.count.mockImplementation(({ where }: any) =>
      Promise.resolve(where.role === 'staff' ? 1 : 0));
    await expect(assertStage('STAFF', { id: 'admin-1', role: 'admin', companyId: null }, 'co-x'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('STAFF 级：公司无 staff 但有 leader → admin 不得代初审（代初审归同公司 leader）', async () => {
    prisma.user.count.mockImplementation(({ where }: any) =>
      Promise.resolve(where.role === 'leader' ? 1 : 0));
    await expect(assertStage('STAFF', { id: 'admin-1', role: 'admin', companyId: null }, 'co-x'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
