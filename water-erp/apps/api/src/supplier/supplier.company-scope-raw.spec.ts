import { Test } from '@nestjs/testing';
import { LlmService } from '../local-ai/llm.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationService } from '../verification/verification.service';
import { SupplierService } from './supplier.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * 公司隔离 × completeness raw 路径（2026-10-15 事故回归锁）：
 * 2026-10-14 公司选择器多选改造后 CompanyScopeService.filter() 统一返回
 * { companyId: { in: string[] } }（单选也是长度 1 的 in）——listByCompleteness
 * 的 raw 路径若仍按标量插参（s."companyId" = ${where.companyId}），对象参数会被
 * Prisma 序列化为 jsonb，PG 报 operator does not exist: text = jsonb，
 * 供应商库（:3005 /supplier/repository）leader/admin 选公司即 500。
 * 本 spec 锁定 raw 路径对 string 与 { in } 两形状的正确翻译。
 */
describe('SupplierService — 公司隔离 raw 路径形状适配（多选扩展后）', () => {
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
      filter: jest.fn().mockReturnValue({ companyId: { in: ['co-1'] } }),
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

  it('filter() 返回 { in } 形状（多选/单选统一）时翻译为参数化 IN，不得把对象直接插参（jsonb 500）', async () => {
    await service.list({ status: 'APPROVED', actor: ACTOR_LEADER as any }); // sort 缺省 completeness
    expect(prisma.$queryRaw).toHaveBeenCalled();
    const { sql, values } = rawWhereSql();
    expect(sql).toContain('s."companyId" IN (');
    expect(values).toContain('co-1');
    // 对象泄漏即 500 复发：值数组里不允许出现 {in:[...]} 对象本体
    expect(values.some((v) => typeof v === 'object' && v !== null && !Array.isArray(v) && 'in' in (v as any))).toBe(false);
  });

  it('filter() 返回旧 string 形状时仍按等值翻译（向后兼容）', async () => {
    companyScope.filter.mockReturnValue({ companyId: 'co-1' });
    await service.list({ status: 'APPROVED', actor: ACTOR_LEADER as any });
    expect(prisma.$queryRaw).toHaveBeenCalled();
    const { sql, values } = rawWhereSql();
    expect(sql).toContain('s."companyId" = ');
    expect(values).toContain('co-1');
  });

  it('多公司 in 集合全量入参（逗号多选视图）', async () => {
    companyScope.filter.mockReturnValue({ companyId: { in: ['co-1', 'co-2'] } });
    await service.list({ status: 'APPROVED', actor: ACTOR_LEADER as any });
    const { sql, values } = rawWhereSql();
    expect(sql).toContain('s."companyId" IN (');
    expect(values).toEqual(expect.arrayContaining(['co-1', 'co-2']));
  });
});
