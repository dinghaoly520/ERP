import { Test } from '@nestjs/testing';
import { LlmService } from '../local-ai/llm.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationService } from '../verification/verification.service';
import { SupplierService } from './supplier.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * 公司隔离 × completeness raw 路径（raw 盲区回归锁）：
 * raw 翻译件是手写 SQL——ORM where 换形后 tsc 不保护翻译件，漏译/错译即静默 no-op
 * （2026-10-15 实录：多选改造后对象直接插参 → PG 报 text = jsonb，供应商库选公司即 500）。
 * 2026-10-16 多公司归属换形：供应商域公司过滤由单值 Supplier.companyId 改为
 * APPROVED SupplierCompanyLink 存在性（supplierCompanyWhere 产 where.companyLinks）——
 * 本 spec 锁定 raw 路径把 companyLinks.some 翻译为 SupplierCompanyLink 的 EXISTS 子查询；
 * 库视图（status=APPROVED 等非审批态）不得再出现旧 s."companyId" 公司过滤（漏译=丢过滤=泄露）。
 * C1 终审修复（2026-10-19）：审批流上下文（reviewStage 给定 / status∈PENDING,RETURNED,REJECTED）
 * 走双谓词（EXISTS APPROVED link OR s."companyId" IN 视野集）——s."companyId" 仅在该双谓词
 * 分支合法出现，用于新注册件（终审落 link 前只有主归属）在审批中心可见（角标/列表口径一致）。
 */
describe('SupplierService — 公司隔离 raw 路径 link 存在性翻译（多公司归属换形后）', () => {
  let service: SupplierService;
  let prisma: any;
  let companyScope: { resolveScope: jest.Mock; filter: jest.Mock };

  const ACTOR_LEADER = { sub: 'leader-1', role: 'leader', username: 'Swhi-CGZX-01' };

  beforeEach(async () => {
    prisma = {
      supplier: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) },
      supplierEvaluation: { groupBy: jest.fn().mockResolvedValue([]) },
      user: { count: jest.fn().mockResolvedValue(0), findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    companyScope = {
      resolveScope: jest.fn().mockResolvedValue({ all: false, companyIds: ['co-1'] }),
      filter: jest.fn(), // 供应商域已不走 filter（专家库/公告等域专用）——留空防误用回退
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

  function rawWhereSql(): { sql: string; values: unknown[] } {
    // $queryRaw 为 tagged template：calls[0][1] 是 whereSql（Prisma.Sql）
    const whereSql: any = prisma.$queryRaw.mock.calls[0]?.[1];
    expect(whereSql).toBeDefined();
    return { sql: String(whereSql?.sql ?? ''), values: whereSql?.values ?? [] };
  }

  it('限定公司集翻译为 SupplierCompanyLink EXISTS（APPROVED），逐元素参数化入 IN', async () => {
    await service.list({ status: 'APPROVED', actor: ACTOR_LEADER as any }); // sort 缺省 completeness
    expect(prisma.$queryRaw).toHaveBeenCalled();
    const { sql, values } = rawWhereSql();
    expect(sql).toContain('EXISTS (SELECT 1 FROM "SupplierCompanyLink"');
    expect(sql).toContain('l."supplierId" = s.id');
    expect(sql).toContain(`l."companyId" IN (`);
    // 状态参数化（C1 终审加固）：SQL 内是占位符+枚举 cast 而非 'APPROVED' 字面量，值入参数组
    // （cast 必须显式——参数化的 SupplierLinkStatus 枚举列与 text 无隐式算子，真库 42883）
    expect(sql).toContain('l."status" = ?::"SupplierLinkStatus"');
    expect(values).toContain('co-1');
    expect(values).toContain('APPROVED');
    // 对象泄漏即 500 复发（2026-10-15 病根）：值数组里不允许出现 {in:[...]} 对象本体
    expect(values.some((v) => typeof v === 'object' && v !== null && !Array.isArray(v) && 'in' in (v as any))).toBe(false);
  });

  it('库视图（status=APPROVED）：旧 s."companyId" 标量/IN 公司过滤不得出现（漏译换形=公司过滤静默丢弃）', async () => {
    await service.list({ status: 'APPROVED', actor: ACTOR_LEADER as any });
    const { sql } = rawWhereSql();
    expect(sql).not.toContain('s."companyId"'); // 双谓词分支（审批流）才允许出现——见下方 C1 组
  });

  it('多公司 in 集合全量入参（admin 逗号多选视图）', async () => {
    companyScope.resolveScope.mockResolvedValue({ all: false, companyIds: ['co-1', 'co-2'] });
    await service.list({ status: 'APPROVED', actor: ACTOR_LEADER as any });
    const { sql, values } = rawWhereSql();
    expect(sql).toContain('EXISTS (SELECT 1 FROM "SupplierCompanyLink"');
    expect(values).toEqual(expect.arrayContaining(['co-1', 'co-2']));
  });

  it('全部视野（admin 默认）不注入公司条件——EXISTS 子查询不出现', async () => {
    companyScope.resolveScope.mockResolvedValue({ all: true });
    await service.list({ status: 'APPROVED', actor: { sub: 'admin-1', role: 'admin', username: 'Swhi-CGZX-admin' } as any });
    const { sql } = rawWhereSql();
    expect(sql).not.toContain('SupplierCompanyLink');
  });

  // ── C1 终审修复（2026-10-19）：审批流上下文双谓词——APPROVED link OR 主归属 companyId。
  //    新注册件提交即落 Supplier.companyId，APPROVED link 到 ADMIN 终审才落，单 link 谓词会
  //    「角标有数（myPendingReviewCount 按 companyId 计）、列表却空」。──

  const DUAL_OR = [
    { companyLinks: { some: { companyId: { in: ['co-1'] }, status: 'APPROVED' } } },
    { companyId: { in: ['co-1'] } },
  ];

  it('审批流（status=PENDING）raw 路径：EXISTS APPROVED link OR s."companyId" IN 双谓词同现', async () => {
    await service.list({ status: 'PENDING', actor: ACTOR_LEADER as any }); // sort 缺省 completeness → raw
    const { sql, values } = rawWhereSql();
    expect(sql).toContain('EXISTS (SELECT 1 FROM "SupplierCompanyLink"');
    expect(sql).toContain('l."status" = ?::"SupplierLinkStatus"'); // 状态参数化（占位符+枚举 cast）
    expect(sql).toContain('OR s."companyId" IN (');
    // 两分支各自入参同一公司 id（EXISTS 的 IN + companyId 的 IN）
    expect(values.filter((v) => v === 'co-1')).toHaveLength(2);
    expect(values).toContain('APPROVED'); // link 状态参数值
  });

  it('审批流（reviewStage 给定）raw 路径同款双谓词——审批面板默认排序即 raw 路径', async () => {
    await service.list({ reviewStage: 'STAFF', actor: { sub: 'st-1', role: 'staff', username: 'Swhi-JS-02' } as any });
    const { sql, values } = rawWhereSql();
    expect(sql).toContain('EXISTS (SELECT 1 FROM "SupplierCompanyLink"');
    expect(sql).toContain('OR s."companyId" IN (');
    expect(values.filter((v) => v === 'co-1')).toHaveLength(2);
  });

  it('审批流 ORM 路径（sort=createdAt）：where.AND[0].OR 双谓词形状——companyId=B 无 link 的新注册件可见', async () => {
    await service.list({ status: 'PENDING', sort: 'createdAt', actor: ACTOR_LEADER as any });
    const where = prisma.supplier.count.mock.calls[0][0].where;
    expect(where.companyLinks).toBeUndefined(); // 审批流不再走 link-only 单谓词
    expect(where.status).toBe('PENDING');
    expect(where.AND?.[0]?.OR).toEqual(DUAL_OR);
  });

  it('库视图（exclude:PENDING,RETURNED / 无 status）：仍 link-only 单谓词（库可见性口径不动）', async () => {
    await service.list({ status: 'exclude:PENDING,RETURNED', sort: 'createdAt', actor: ACTOR_LEADER as any });
    const where1 = prisma.supplier.count.mock.calls[0][0].where;
    expect(where1.companyLinks).toEqual({ some: { companyId: { in: ['co-1'] }, status: 'APPROVED' } });
    expect(where1.AND).toBeUndefined();

    await service.list({ sort: 'createdAt', actor: ACTOR_LEADER as any }); // 无 status（默认库视图）
    const where2 = prisma.supplier.count.mock.calls[1][0].where;
    expect(where2.companyLinks).toEqual({ some: { companyId: { in: ['co-1'] }, status: 'APPROVED' } });
    expect(where2.AND).toBeUndefined();
  });

  it('空 in 公司集 → 恒 false 条件（不再静默跳过=丢公司过滤；C1 终审加固项）', async () => {
    companyScope.resolveScope.mockResolvedValue({ all: false, companyIds: [] });
    await service.list({ status: 'APPROVED', actor: ACTOR_LEADER as any });
    const { sql } = rawWhereSql();
    expect(sql).toContain('false');
    expect(sql).not.toContain('SupplierCompanyLink'); // 空集走 false 短路，不生成 EXISTS
  });

  it('getStats：pending/returned 双谓词、库内四态 link-only（C1 角标/列表/统计口径一致）', async () => {
    await service.getStats(ACTOR_LEADER as any);
    const calls = prisma.supplier.count.mock.calls; // Promise.all 顺序：total/pending/approved/disabled/blacklist/returned/temp
    expect(calls[1][0].where).toEqual({ status: 'PENDING', OR: DUAL_OR });
    expect(calls[5][0].where).toEqual({ status: 'RETURNED', OR: DUAL_OR });
    for (const idx of [0, 2, 3, 4, 6]) {
      expect(calls[idx][0].where.companyLinks).toEqual({ some: { companyId: { in: ['co-1'] }, status: 'APPROVED' } });
      expect(calls[idx][0].where.OR).toBeUndefined();
    }
  });
});
