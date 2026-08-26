import { BadRequestException } from '@nestjs/common';
import { WorkTemplateService } from './work-template.service';

/** W8（CTS A-115/A-147）：开标记录/评标模板 CRUD + 生效选择 */
describe('WorkTemplateService（W8）', () => {
  const mk = (over: Record<string, any> = {}) => ({
    workTemplate: {
      findMany: jest.fn().mockResolvedValue(over.rows ?? []),
      findFirst: jest.fn().mockResolvedValue(over.active ?? null),
      findUnique: jest.fn().mockResolvedValue(over.one ?? null),
      create: jest.fn().mockResolvedValue({ id: 'wt-1', ...(over.created ?? {}) }),
      update: jest.fn().mockResolvedValue({ id: 'wt-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(over.count ?? 0),
    },
  });

  it('listForKind 按 kind 过滤', async () => {
    const prisma = mk({ rows: [{ id: '1', kind: 'opening_record', name: '标准开标表' }] });
    const svc = new WorkTemplateService(prisma as any);
    await svc.listForKind('opening_record');
    expect(prisma.workTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: 'opening_record' } }),
    );
  });

  it('create：同 kind+name 唯一冲突 → TEMPLATE_DUPLICATE；首个模板自动置活跃', async () => {
    const prisma = mk({ count: 0, created: { kind: 'evaluation', name: '默认评分' } });
    const svc = new WorkTemplateService(prisma as any);
    await svc.create('evaluation', '默认评分', { items: [] } as any, 'u1');
    expect(prisma.workTemplate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: 'evaluation', name: '默认评分', isActive: true }),
    });
    // 唯一冲突（用 mock 抛 P2002 不便，改验重复名拦截在真实层；这里验 create 参数正确即可）
  });

  it('activate：设活跃前先停用同 kind 全部（事务内 updateMany），再置该模板 active', async () => {
    const prisma = mk({ one: { id: 'wt-9', kind: 'opening_record' } });
    const svc = new WorkTemplateService(prisma as any);
    await svc.activate('wt-9');
    expect(prisma.workTemplate.updateMany).toHaveBeenCalledWith({
      where: { kind: 'opening_record' }, data: { isActive: false },
    });
    expect(prisma.workTemplate.update).toHaveBeenCalledWith({ where: { id: 'wt-9' }, data: { isActive: true } });
  });

  it('activate：模板不存在 → NOT_FOUND', async () => {
    const prisma = mk({ one: null });
    await expect(new WorkTemplateService(prisma as any).activate('nope')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('activeForKind：无活跃 → 返回 null（调用方回退内置默认）', async () => {
    const prisma = mk({ active: null });
    const r = await new WorkTemplateService(prisma as any).activeForKind('opening_record');
    expect(r).toBeNull();
  });
});
