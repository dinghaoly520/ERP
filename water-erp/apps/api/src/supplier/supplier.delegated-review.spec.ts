import { Test } from '@nestjs/testing';
import { LlmService } from '../local-ai/llm.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationService } from '../verification/verification.service';
import { SupplierService } from './supplier.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * admin 代复审可见性（2026-10-08 A 方案）：
 * assertStageApprover 本就放行「归属公司无在编 leader 时 admin 代复审」（防待办悬空兜底），
 * 但角标/审批中心列表口径此前只算 reviewStage=ADMIN——admin「能审却看不见」。
 * 本 spec 锁定三处对齐：
 * 1) myPendingReviewCount：admin 待办 = ADMIN 级 OR（LEADER 级且公司无在编 leader）
 * 2) list()：admin 查 reviewStage=ADMIN 时展开同口径（ORM + raw completeness 两路径）
 * 3) 展开结果中的 LEADER 级项带 delegatedReview 标记（前端据此亮「待我审」）
 */
describe('SupplierService — admin 代复审可见性（A 方案）', () => {
  let service: SupplierService;
  let prisma: any;

  const ACTOR_ADMIN = { sub: 'admin-1', role: 'admin', username: 'Swhi-CGZX-admin' };
  const ACTOR_LEADER = { sub: 'leader-1', role: 'leader', username: 'Swhi-CGZX-01' };
  const DELEGATED_OR = [
    { reviewStage: 'ADMIN' },
    { reviewStage: 'LEADER', company: { users: { none: { role: 'leader', isActive: true } } } },
  ];

  beforeEach(async () => {
    prisma = {
      supplier: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      supplierChangeRecord: { count: jest.fn().mockResolvedValue(0) },
      supplierEvaluation: { groupBy: jest.fn().mockResolvedValue([]) },
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

  it('myPendingReviewCount：admin 待办展开为 ADMIN 级 OR（LEADER 级且公司无在编 leader）', async () => {
    await service.myPendingReviewCount(ACTOR_ADMIN as any);
    const where = prisma.supplier.count.mock.calls[0][0].where;
    expect(where.reviewStage).toBeUndefined(); // 不再是单级标量（旧口径漏计代审件）
    expect(where.AND?.[0]?.OR).toEqual(DELEGATED_OR);
  });

  it('list()：admin 查 reviewStage=ADMIN 走 ORM 路径时展开，且 LEADER 级项带 delegatedReview 标记', async () => {
    prisma.supplier.findMany.mockResolvedValue([
      { id: 's1', reviewStage: 'ADMIN', status: 'PENDING' },
      { id: 's2', reviewStage: 'LEADER', status: 'PENDING' },
    ]);
    const res = await service.list({ reviewStage: 'ADMIN', actor: ACTOR_ADMIN as any, sort: 'createdAt' });

    const where = prisma.supplier.count.mock.calls[0][0].where;
    expect(where.reviewStage).toBeUndefined();
    expect(where.AND?.[0]?.OR).toEqual(DELEGATED_OR);
    expect(where.__delegatedExpand).toBeUndefined(); // 内部标记不得泄入 Prisma 参数
    expect(res.items.find((i: any) => i.id === 's1').delegatedReview).toBeUndefined();
    expect(res.items.find((i: any) => i.id === 's2').delegatedReview).toBe(true);
  });

  it('list()：completeness 默认路径（raw SQL）生成同口径 NOT EXISTS 代审条件', async () => {
    await service.list({ reviewStage: 'ADMIN', actor: ACTOR_ADMIN as any }); // sort 缺省 completeness
    expect(prisma.$queryRaw).toHaveBeenCalled();
    // $queryRaw 为 tagged template：mock 的 calls[0][1] 是 whereSql（Prisma.Sql，含全部条件文本）
    // JSON 序列化会转义双引号，断言取不含引号的片段
    const sql = JSON.stringify(prisma.$queryRaw.mock.calls[0][1]);
    expect(sql).toContain(`= 'ADMIN' OR (s.`);
    expect(sql).toContain(`NOT EXISTS (SELECT 1 FROM `);
    expect(sql).toContain(`= 'leader' AND u.`);
  });

  it('list()：非 admin 查 reviewStage 不展开（严格单级标量）', async () => {
    await service.list({ reviewStage: 'LEADER', actor: ACTOR_LEADER as any, sort: 'createdAt' });
    const where = prisma.supplier.count.mock.calls[0][0].where;
    expect(where.reviewStage).toBe('LEADER');
    expect(where.AND).toBeUndefined();
  });
});
