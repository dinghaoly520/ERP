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
 * 缓存键由登录人 scope 派生（admin=选择器参数；非 admin=本人公司、传参忽略）——
 * 非 admin 同样吃本公司缓存（不因越权收紧而每次重生成），且键不来自客户端。
 */
describe('AiService 仪表盘分析缓存', () => {
  let service: AiService;
  let prisma: any;
  const FP = 'r7@2026-11-10T00:00:00.000Z|p3@-|s2@-';
  const RESULT = { overview: '总评', highlights: ['亮点'], concerns: [], suggestions: [] };
  const ADMIN = { sub: 'u-admin', role: 'admin', username: 'a' } as never;
  const STAFF = { sub: 'u-staff', role: 'staff', username: 's' } as never;

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
    const companyScope = {
      resolveScope: jest.fn(async (user: any, req?: string) => {
        if (user?.role === 'admin') {
          const ids = (req ?? '').split(',').map((s) => s.trim()).filter((s) => s && s !== 'all');
          return ids.length ? { all: false, companyIds: ids } : { all: true };
        }
        return { all: false, companyIds: ['own-co'] }; // 非 admin：强制本人公司、传参忽略
      }),
    };
    service = new AiService(
      prisma as unknown as PrismaService,
      {} as SupplierSelectionAiService,
      llm ?? {} as LlmService,
      {} as NotificationService,
      {} as ConfigService,
      companyScope as unknown as CompanyScopeService,
    );
    return prisma;
  };

  const cacheRow = (key: string, fingerprint = FP) => ({
    key,
    row: { key, value: JSON.stringify({ fingerprint, result: RESULT, generatedAt: '2026-11-10T01:00:00Z' }) },
  });

  it('键随 scope 派生：admin 多选排序稳定、all=全库、区间追加段', async () => {
    makeService();
    await service.getDashboardAnalysisCache(ADMIN, 'b-id,a-id');
    expect(prisma.systemConfig.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'dash-ai-analysis:a-id,b-id' } }));
    await service.getDashboardAnalysisCache(ADMIN, 'all');
    expect(prisma.systemConfig.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'dash-ai-analysis:all' } }));
    await service.getDashboardAnalysisCache(ADMIN, '', '2026-08-01', '2026-08-31');
    expect(prisma.systemConfig.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'dash-ai-analysis:all:2026-08-01~2026-08-31' } }));
  });

  it('非 admin：传他公司参数被忽略 → 键=本人公司（隔离且仍可命中本公司缓存）', async () => {
    makeService(cacheRow('dash-ai-analysis:own-co'));
    const r = await service.getDashboardAnalysisCache(STAFF, 'co-evil,co-evil2');
    expect(prisma.systemConfig.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'dash-ai-analysis:own-co' } }));
    expect(r.hit).toBe(true);
    if (r.hit) expect(r.result).toEqual(RESULT);
  });

  it('指纹一致 → 命中返回缓存报告（不触 LLM）', async () => {
    makeService(cacheRow('dash-ai-analysis:all'));
    const r = await service.getDashboardAnalysisCache(ADMIN, 'all');
    expect(r.hit).toBe(true);
    if (r.hit) expect(r.generatedAt).toBe('2026-11-10T01:00:00Z');
  });

  it('数据有更新（指纹漂移）→ miss；缓存损坏 → 按 miss 不抛错', async () => {
    makeService(cacheRow('dash-ai-analysis:all', 'r6@old|p3@-|s2@-'));
    await expect(service.getDashboardAnalysisCache(ADMIN, 'all')).resolves.toMatchObject({ hit: false });
    makeService({ key: 'dash-ai-analysis:all', row: { key: 'dash-ai-analysis:all', value: '{broken' } });
    await expect(service.getDashboardAnalysisCache(ADMIN, 'all')).resolves.toMatchObject({ hit: false });
  });

  it('生成成功 → 按 scope 键落存（admin 多选）；非 admin 落本公司键（污染键不出现）', async () => {
    const llm = { chatJson: jest.fn().mockResolvedValue({ overview: '新总评', highlights: ['新亮点'], concerns: [], suggestions: [] }) };
    makeService(null, llm);
    await service.analyzeDashboard({ companyId: 'a-id,b-id' }, ADMIN);
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'dash-ai-analysis:a-id,b-id' },
      create: expect.objectContaining({ key: 'dash-ai-analysis:a-id,b-id' }),
    }));
    expect(JSON.parse((prisma.systemConfig.upsert as jest.Mock).mock.calls[0][0].update.value).fingerprint).toBe(FP);

    makeService(null, llm);
    const r = await service.analyzeDashboard({ companyId: 'co-evil' }, STAFF);
    expect(r.overview).toBe('新总评');
    expect(prisma.systemConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key: 'dash-ai-analysis:own-co' },
    }));
  });

  it('LLM 失败兜底不落缓存；无登录上下文不落缓存', async () => {
    const llm = { chatJson: jest.fn().mockRejectedValue(new Error('llm down')) };
    makeService(null, llm);
    const r = await service.analyzeDashboard({ companyId: 'all' }, ADMIN);
    expect(r.overview).toBe('AI 分析暂不可用');
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
    await service.analyzeDashboard({ companyId: 'all' }, undefined);
    expect(prisma.systemConfig.upsert).not.toHaveBeenCalled();
  });
});
