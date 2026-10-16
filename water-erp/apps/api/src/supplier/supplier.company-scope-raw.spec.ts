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
 * 本 spec 锁定 raw 路径把 companyLinks.some 翻译为 SupplierCompanyLink 的 EXISTS 子查询，
 * 且旧 s."companyId" 标量/IN 公司过滤不得再出现（漏译=公司过滤丢弃=跨视野泄露）。
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
    expect(sql).toContain(`l."status" = 'APPROVED'`);
    expect(values).toContain('co-1');
    // 对象泄漏即 500 复发（2026-10-15 病根）：值数组里不允许出现 {in:[...]} 对象本体
    expect(values.some((v) => typeof v === 'object' && v !== null && !Array.isArray(v) && 'in' in (v as any))).toBe(false);
  });

  it('旧 s."companyId" 标量/IN 公司过滤不得再出现（漏译换形=公司过滤静默丢弃）', async () => {
    await service.list({ status: 'APPROVED', actor: ACTOR_LEADER as any });
    const { sql } = rawWhereSql();
    expect(sql).not.toContain('s."companyId"');
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
});
