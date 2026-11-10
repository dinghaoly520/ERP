import { AiService } from './ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupplierSelectionAiService } from './supplier-selection-ai.service';
import { LlmService } from '../local-ai/llm.service';
import { NotificationService } from '../notification/notification.service';
import { ConfigService } from '@nestjs/config';
import { CompanyScopeService } from '../company/company-scope';

/**
 * 仪表盘 AI 分析服务端缓存（2026-11-10 用户裁定：每公司视野存最新一份，数据指纹
 * 未变即时提取不重生成）。存储=SystemConfig；指纹=轮次/PMI/供应商链接聚合。
 */
describe('AiService 仪表盘分析缓存', () => {
  let service: AiService;
  let prisma: any;
  const FP = 'r7@2026-11-10T00:00:00.000Z|p3@-|s2@-';
  const RESULT = { overview: '总评', highlights: ['亮点'], concerns: [], suggestions: ['建议'] };

  const makeService = (stored: unknown = null, llm?: any) => {
    prisma = {
      procurementRound: { aggregate: jest.fn().mockResolvedValue({ _count: 7, _max: { updatedAt: new Date('2026-11-10T00:00:00Z') } }) },
      projectManagementItem: { aggregate: jest.fn().mockResolvedValue({ _count: 3, _max: { updatedAt: null } }) },
      supplierCompanyLink: { aggregate: jest.fn().mockResolvedValue({ _count: 2, _max: { updatedAt: null } }) },
      systemConfig: {
        findUnique: jest.fn(async (args: any) => (typeof stored === 'object' && stored && (stored as any).key === args.where.key ? (stored as any).row : null)),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    service = new AiService(
      prisma as unknown as PrismaService,
      {} as SupplierSelectionAiService,
      llm ?? {} as LlmService,
      {} as NotificationService,
      {} as ConfigService,
      {} as CompanyScopeService,
    );
    return prisma;
  };

  const cacheRow = (fingerprint: string) => ({
    key: 'dash-ai-analysis:all',
    row: { key: 'dash-ai-analysis:all', value: JSON.stringify({ fingerprint, result: RESULT, generatedAt: '2026-11-10T01:00:00Z' }) },
  });

  it('键归一化：多选排序稳定、all/空=全库、日期区间追加段', async () => {
    makeService();
    await service.getDashboardAnalysisCache('b-id,a-id');
    expect(prisma.systemConfig.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'dash-ai-analysis:a-id,b-id' } }));
    await service.getDashboardAnalysisCache('all');
    expect(prisma.systemConfig.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'dash-ai-analysis:all' } }));
    await service.getDashboardAnalysisCache('', '2026-08-01', '2026-08-31');
    expect(prisma.systemConfig.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'dash-ai-analysis:all:2026-08-01~2026-08-31' } }));
  });

  it('指纹过滤归一（回归：all 不得当字面 id 过滤——首版致计数恒 0、缓存永不失效）', async () => {
    makeService();
    await service.getDashboardAnalysisCache('all');
    for (const m of ['procurementRound', 'projectManagementItem', 'supplierCompanyLink']) {
      expect((prisma[m] as any).aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    }
    await service.getDashboardAnalysisCache('co-1,co-2');
    for (const m of ['procurementRound', 'projectManagementItem', 'supplierCompanyLink']) {
      expect((prisma[m] as any).aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { companyId: { in: ['co-1', 'co-2'] } } }));
    }
  });

  it('指纹一致 → 命中返回缓存报告（不触 LLM）', async () => {
    makeService(cacheRow(FP));
    const r = await service.getDashboardAnalysisCache('all');
    expect(r.hit).toBe(true);
    if (r.hit) {
      expect(r.result).toEqual(RESULT);
      expect(r.generatedAt).toBe('2026-11-10T01:00:00Z');
    }
  });

  it('数据有更新（指纹漂移）→ miss，待重新生成', async () => {
    makeService(cacheRow('r6@old|p3@-|s2@-'));
    const r = await service.getDashboardAnalysisCache('all');
    expect(r.hit).toBe(false);
    expect(r.fingerprint).toBe(FP);
  });

  it('缓存损坏（非法 JSON）→ 按 miss 处理不抛错', async () => {
    makeService({ key: 'dash-ai-analysis:all', row: { key: 'dash-ai-analysis:all', value: '{broken' } });
    await expect(service.getDashboardAnalysisCache('all')).resolves.toMatchObject({ hit: false });
  });

  it('生成成功 → 按当前指纹落存（upsert 带归一化键与结果）', async () => {
    const llm = { chatJson: jest.fn().mockResolvedValue({ overview: '新总评', highlights: ['新亮点'], concerns: [], suggestions: [] }) };
    makeService(null, llm);
    const r = await service.analyzeDashboard({ cacheKey: 'a-id,b-id' });
    expect(r.overview).toBe('新总评');
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'dash-ai-analysis:a-id,b-id' },
      create: expect.objectContaining({ key: 'dash-ai-analysis:a-id,b-id' }),
    }));
    const saved = JSON.parse((prisma.systemConfig.upsert as jest.Mock).mock.calls[0][0].update.value);
    expect(saved.fingerprint).toBe(FP);
    expect(saved.result.overview).toBe('新总评');
  });

  it('LLM 失败兜底文案不落缓存；不带 cacheKey 不写缓存', async () => {
    const llm = { chatJson: jest.fn().mockRejectedValue(new Error('llm down')) };
    makeService(null, llm);
    const r = await service.analyzeDashboard({ cacheKey: 'all' });
    expect(r.overview).toBe('AI 分析暂不可用');
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
    await service.analyzeDashboard({});
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });
});
