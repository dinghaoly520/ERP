import { SupplierService } from './supplier.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { VerificationService } from '../verification/verification.service';
import { LlmService } from '../local-ai/llm.service';
import { CompanyScopeService } from '../company/company-scope';

/**
 * 生命周期时间线去重（2026-11-09）：评价记录（SupplierEvaluation）与审计日志
 * （SUPPLIER_EVALUATION_CREATED）是同事件两次独立写入、createdAt 毫秒级时差，
 * 旧口径按 getTime() 全等配对必然 miss → 同一次评价在时间线上出两条。
 * 现按 ±5s 时间窗就近配对，只出评价表一条（带评价人）；孤儿审计条目兜底展示。
 */
describe('SupplierService.getSupplierTimeline——绩效评价双源去重', () => {
  let service: SupplierService;
  let prisma: any;

  const baseSupplier = {
    id: 's1', name: '测试供应商', status: 'APPROVED',
    createdAt: new Date('2026-06-13T10:57:00Z'), updatedAt: new Date('2026-08-12T07:29:00Z'),
    isTemporary: false, industry: null,
  };

  async function make() {
    prisma = {
      supplier: { findUnique: jest.fn().mockResolvedValue(baseSupplier) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
      supplierEvaluation: { findMany: jest.fn().mockResolvedValue([]) },
      bidSupplier: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const { Test } = await import('@nestjs/testing');
    const module = await Test.createTestingModule({
      providers: [
        { provide: CompanyScopeService, useValue: { resolveScope: jest.fn().mockResolvedValue({ all: true }), filter: jest.fn().mockReturnValue({}), assertInScope: jest.fn(), stampFor: jest.fn().mockResolvedValue({}) } },
        SupplierService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationService, useValue: { create: jest.fn().mockResolvedValue({}), sendToRole: jest.fn(), sendToUser: jest.fn(), resolveActionable: jest.fn().mockResolvedValue({}) } },
        { provide: 'REDIS_CLIENT', useValue: {} },
        { provide: LlmService, useValue: {} },
        { provide: VerificationService, useValue: {} },
      ],
    }).compile();
    service = module.get(SupplierService);
  }

  it('同事件毫秒级时差 → 只出一条评价表格式（等级入 grade 字段供徽章渲染）', async () => {
    await make();
    (prisma.supplierEvaluation.findMany as jest.Mock).mockResolvedValue([
      { finalGrade: 'A', createdAt: new Date('2026-08-12T07:29:00.000Z'), evaluator: { displayName: '陈源远' } },
    ]);
    (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([
      { action: 'SUPPLIER_EVALUATION_CREATED', details: { finalGrade: 'A' }, createdAt: new Date('2026-08-12T07:29:00.300Z'), userId: 'u1', user: { displayName: '陈源远' } },
    ]);
    const r = await service.getSupplierTimeline('s1');
    const evals = r.events.filter(e => e.label === '绩效评价');
    expect(evals).toHaveLength(1);
    expect(evals[0].detail).toBe('评价人：陈源远');
    expect(evals[0].grade).toBe('A');
  });

  it('时间戳完全相等（旧口径）同样只出一条', async () => {
    await make();
    (prisma.supplierEvaluation.findMany as jest.Mock).mockResolvedValue([
      { finalGrade: 'B', createdAt: new Date('2026-03-13T08:00:00.000Z'), evaluator: { displayName: '陈源远' } },
    ]);
    (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([
      { action: 'SUPPLIER_EVALUATION_CREATED', details: { finalGrade: 'B' }, createdAt: new Date('2026-03-13T08:00:00.000Z'), userId: 'u1', user: { displayName: '陈源远' } },
    ]);
    const r = await service.getSupplierTimeline('s1');
    expect(r.events.filter(e => e.label === '绩效评价')).toHaveLength(1);
  });

  it('无审计日志的评价（种子数据）照常展示，不误吞', async () => {
    await make();
    (prisma.supplierEvaluation.findMany as jest.Mock).mockResolvedValue([
      { finalGrade: 'C', createdAt: new Date('2026-07-08T18:00:00Z'), evaluator: { displayName: '陈源远' } },
      { finalGrade: 'E', createdAt: new Date('2026-12-25T16:00:00Z'), evaluator: { displayName: '陈源远' } },
    ]);
    const r = await service.getSupplierTimeline('s1');
    const evals = r.events.filter(e => e.label === '绩效评价');
    expect(evals).toHaveLength(2);
    expect(evals.map(e => e.detail)).toEqual(['评价人：陈源远', '评价人：陈源远']);
    expect(evals.map(e => e.grade)).toEqual(['C', 'E']);
  });

  it('孤儿审计条目（评价已删）兜底展示，防丢事件', async () => {
    await make();
    (prisma.supplierEvaluation.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([
      { action: 'SUPPLIER_EVALUATION_CREATED', details: { finalGrade: 'D' }, createdAt: new Date('2026-09-01T02:00:00Z'), userId: 'u1', user: { displayName: '陈源远' } },
    ]);
    const r = await service.getSupplierTimeline('s1');
    const evals = r.events.filter(e => e.label === '绩效评价');
    expect(evals).toHaveLength(1);
    expect(evals[0].grade).toBe('D');
    expect(evals[0].detail).toBe('评价人：陈源远');
  });

  it('一评至多配一审：窄窗内 1 评价 + 2 审计（其一评价已删）→ 2 条事件不丢', async () => {
    await make();
    (prisma.supplierEvaluation.findMany as jest.Mock).mockResolvedValue([
      { finalGrade: 'A', createdAt: new Date('2026-08-12T07:29:00.000Z'), evaluator: { displayName: '陈源远' } },
    ]);
    (prisma.auditLog.findMany as jest.Mock).mockResolvedValue([
      { action: 'SUPPLIER_EVALUATION_CREATED', details: { finalGrade: 'A' }, createdAt: new Date('2026-08-12T07:29:00.300Z'), userId: 'u1', user: { displayName: '陈源远' } },
      { action: 'SUPPLIER_EVALUATION_CREATED', details: { finalGrade: 'B' }, createdAt: new Date('2026-08-12T07:29:01.000Z'), userId: 'u1', user: { displayName: '陈源远' } },
    ]);
    const r = await service.getSupplierTimeline('s1');
    const evals = r.events.filter(e => e.label === '绩效评价');
    expect(evals).toHaveLength(2); // 评价表 1 条 + 孤儿审计 1 条——旧 forEach 无短路会把两条审计都吞成 1 条
    expect(evals.map(e => e.grade).sort()).toEqual(['A', 'B']);
  });
});
